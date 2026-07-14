/**
 * WebSocket server for streaming hot-reload patches to connected clients.
 *
 * This module provides the server-side WebSocket implementation for the hot-reload
 * development pipeline. It broadcasts transpiled patches to all connected runtime
 * wrapper clients when GML source files change.
 */

import { Core } from "@gmloop/core";
import { type WebSocket, WebSocketServer } from "ws";

import type { ServerEndpoint, ServerLifecycle } from "../server/index.js";

const { describeValueForError } = Core;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 17_890;

const describeWebSocketError = Core.getErrorMessage;

function acknowledgementKey(id: string, revision: string): string {
    return `${id}\u0000${revision}`;
}

export interface PatchWebSocketServerOptions {
    host?: string;
    port?: number;
    verbose?: boolean;
    onClientConnect?: (clientId: string, socket: WebSocket) => void;
    onClientDisconnect?: (clientId: string) => void;
    onPatchAcknowledgement?: (clientId: string, acknowledgement: StreamedPatchAcknowledgement) => void;
    prepareInitialMessages?: () => Iterable<unknown>;
}

/** Validated browser-runtime confirmation for one applied patch revision. */
export interface PatchAppliedAcknowledgement {
    type: "patch_ack";
    id: string;
    revision: string;
    status: "applied";
    runtimeVersion?: number;
}

export interface StreamedPatchRevision {
    id: string;
    revision: string;
    sequence: number;
}

export interface StreamedPatchAcknowledgement extends PatchAppliedAcknowledgement {
    sequence: number;
}

export interface PatchBroadcastResult {
    successCount: number;
    failureCount: number;
    totalClients: number;
}

/**
 * Patch broadcasting operations.
 *
 * Provides message distribution and client tracking specific to the
 * WebSocket patch server without coupling to endpoint or lifecycle concerns.
 */
export interface PatchBroadcaster {
    broadcast(patch: unknown): PatchBroadcastResult;
    getClientCount(): number;
    getLastStreamedPatch(): StreamedPatchRevision | null;
}

/**
 * Lifecycle control and endpoint metadata for a running WebSocket server.
 *
 * Keeps lifecycle operations decoupled from broadcasting concerns so callers
 * can depend on the minimal contract they require.
 */
export type PatchWebSocketServerHandle = ServerEndpoint & ServerLifecycle;

/**
 * Composite type representing the running WebSocket server instance.
 *
 * Although the underlying object implements broadcasting, lifecycle, and
 * endpoint metadata, consumers should accept only the portions they need
 * (PatchBroadcaster or PatchWebSocketServerHandle) instead of this full
 * intersection.
 */
export type PatchWebSocketServer = PatchWebSocketServerHandle & PatchBroadcaster;

/**
 * Creates and starts a WebSocket server for patch streaming.
 *
 * @param {object} options - Server configuration options
 * @param {string} [options.host] - Host to bind to
 * @param {number} [options.port] - Port to listen on
 * @param {boolean} [options.verbose] - Enable verbose logging
 * @param {Function} [options.onClientConnect] - Callback when a client connects
 * @param {Function} [options.onClientDisconnect] - Callback when a client disconnects
 * @param {Function} [options.prepareInitialMessages] - Supplier for messages sent to new clients immediately after connecting
 * @returns {Promise<object>} Server controller with broadcast and stop methods
 */
export async function startPatchWebSocketServer({
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    verbose = false,
    onClientConnect,
    onClientDisconnect,
    onPatchAcknowledgement,
    prepareInitialMessages
}: PatchWebSocketServerOptions = {}): Promise<PatchWebSocketServer> {
    const clients = new Set<WebSocket>();
    const clientIds = new Map<WebSocket, string>();
    const pendingAcknowledgements = new Map<WebSocket, Map<string, StreamedPatchRevision>>();
    const streamedPatchById = new Map<string, StreamedPatchRevision>();
    let patchSequence = 0;
    let lastStreamedPatch: StreamedPatchRevision | null = null;

    const wss = new WebSocketServer({
        host,
        port
    });

    await new Promise<void>((resolve, reject) => {
        wss.once("error", reject);
        wss.once("listening", () => {
            wss.off("error", reject);
            resolve();
        });
    });

    const READY_STATE_OPEN = 1;

    function streamedPatchRevisions(payload: unknown): Array<Omit<StreamedPatchRevision, "sequence">> {
        const revisions: Array<Omit<StreamedPatchRevision, "sequence">> = [];
        for (const item of Core.toArray(payload)) {
            if (!Core.isObjectLike(item)) {
                continue;
            }
            const patch = item as Record<string, unknown>;
            if (Core.isNonEmptyString(patch.id) && Core.isNonEmptyString(patch.revision)) {
                revisions.push({ id: patch.id, revision: patch.revision });
            }
        }
        return revisions;
    }

    function recordDeliveredPatches(ws: WebSocket, patches: Array<StreamedPatchRevision>): void {
        const pending = pendingAcknowledgements.get(ws);
        if (!pending) {
            return;
        }
        for (const patch of patches) {
            pending.set(acknowledgementKey(patch.id, patch.revision), patch);
        }
        while (pending.size > 1000) {
            const oldestKey = pending.keys().next().value;
            if (typeof oldestKey !== "string") {
                break;
            }
            pending.delete(oldestKey);
        }
    }

    function identifyStreamedPatches(payload: unknown): Array<StreamedPatchRevision> {
        return streamedPatchRevisions(payload).map((patch) => {
            const current = streamedPatchById.get(patch.id);
            if (current?.revision === patch.revision) {
                return current;
            }
            const streamedPatch = { ...patch, sequence: ++patchSequence };
            streamedPatchById.set(patch.id, streamedPatch);
            return streamedPatch;
        });
    }

    function recordLatestStreamedPatch(patches: Array<StreamedPatchRevision>): void {
        for (const patch of patches) {
            if (!lastStreamedPatch || lastStreamedPatch.sequence < patch.sequence) {
                lastStreamedPatch = patch;
            }
        }
    }

    function sendJsonMessage(ws: WebSocket, payload: unknown, clientId: string): boolean {
        try {
            const message = JSON.stringify(payload);

            if (ws.readyState !== READY_STATE_OPEN) {
                return false;
            }

            ws.send(message);
            return true;
        } catch (error) {
            if (verbose) {
                console.error(`[WebSocket] Failed to send to ${clientId}: ${describeWebSocketError(error)}`);
            }
            return false;
        }
    }

    wss.on("connection", (ws, request) => {
        const clientId = `${request.socket.remoteAddress}:${request.socket.remotePort}`;

        clients.add(ws);
        clientIds.set(ws, clientId);
        pendingAcknowledgements.set(ws, new Map());

        if (verbose) {
            console.log(`[WebSocket] Client connected: ${clientId}`);
        }

        if (onClientConnect) {
            onClientConnect(clientId, ws);
        }

        if (prepareInitialMessages) {
            try {
                const replayPayloads = Array.from(prepareInitialMessages());
                const replayPayload = replayPayloads.length === 1 ? replayPayloads[0] : replayPayloads;
                const replayPatches = identifyStreamedPatches(replayPayload);
                const replayedCount =
                    replayPayloads.length > 0 && sendJsonMessage(ws, replayPayload, clientId)
                        ? replayPayloads.length
                        : 0;

                if (replayedCount > 0) {
                    recordDeliveredPatches(ws, replayPatches);
                    recordLatestStreamedPatch(replayPatches);
                }

                if (verbose && replayedCount > 0) {
                    console.log(`[WebSocket] Sent ${replayedCount} queued message(s) to ${clientId}`);
                }
            } catch (error) {
                if (verbose) {
                    console.error(
                        `[WebSocket] Failed to send initial messages to ${clientId}: ${describeWebSocketError(error)}`
                    );
                }
            }
        }

        ws.on("message", (data) => {
            let payload: unknown;
            try {
                payload = JSON.parse(data.toString());
            } catch (error) {
                if (verbose) {
                    console.error(
                        `[WebSocket] Ignored malformed client message (${clientId}): ${describeWebSocketError(error)}`
                    );
                }
                return;
            }

            const acknowledgement = parsePatchAppliedAcknowledgement(payload);
            if (acknowledgement) {
                const deliveredPatch = pendingAcknowledgements
                    .get(ws)
                    ?.get(acknowledgementKey(acknowledgement.id, acknowledgement.revision));
                if (!deliveredPatch) {
                    if (verbose) {
                        console.error(`[WebSocket] Ignored acknowledgement for an undelivered patch (${clientId})`);
                    }
                    return;
                }
                pendingAcknowledgements
                    .get(ws)
                    ?.delete(acknowledgementKey(acknowledgement.id, acknowledgement.revision));
                onPatchAcknowledgement?.(clientId, { ...acknowledgement, sequence: deliveredPatch.sequence });
            } else if (verbose) {
                console.error(`[WebSocket] Ignored unsupported client message (${clientId})`);
            }
        });

        let cleanedUp = false;
        const cleanupClient = (reason: "close" | "error", error?: unknown) => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;

            clients.delete(ws);
            clientIds.delete(ws);
            pendingAcknowledgements.delete(ws);

            if (verbose) {
                if (reason === "error") {
                    console.error(`[WebSocket] Client error (${clientId}): ${describeWebSocketError(error)}`);
                } else {
                    console.log(`[WebSocket] Client disconnected: ${clientId}`);
                }
            }

            if (onClientDisconnect) {
                onClientDisconnect(clientId);
            }
        };

        ws.on("close", () => {
            cleanupClient("close");
        });

        ws.on("error", (error) => {
            cleanupClient("error", error);

            try {
                ws.close();
            } catch (closeError) {
                if (verbose) {
                    console.error(
                        `[WebSocket] Failed to close client socket (${clientId}): ${describeWebSocketError(closeError)}`
                    );
                }
            }
        });
    });

    wss.on("error", (error) => {
        if (verbose) {
            console.error("[WebSocket] Server error:", error.message);
        }
    });

    const address = wss.address();
    const resolvedHost = host ?? DEFAULT_HOST;
    const resolvedPort = typeof address === "object" ? address.port : DEFAULT_PORT;
    const url = `ws://${resolvedHost}:${resolvedPort}`;

    if (verbose) {
        console.log(`[WebSocket] Server listening at ${url}`);
    }

    let closed = false;

    /**
     * Broadcasts a patch to all connected clients.
     * Optimized to serialize the patch once and reuse the message for all clients.
     *
     * @param {object} patch - Patch object to broadcast
     */
    function broadcast(patch: unknown): PatchBroadcastResult {
        let successCount = 0;
        let failureCount = 0;

        // Serialize once for all clients to minimize CPU overhead
        let serializedMessage: string;
        try {
            serializedMessage = JSON.stringify(patch);
        } catch (error) {
            if (verbose) {
                console.error(`[WebSocket] Failed to serialize patch: ${describeWebSocketError(error)}`);
            }
            // All sends fail if serialization fails
            return { successCount: 0, failureCount: clients.size, totalClients: clients.size };
        }

        const streamedPatches = identifyStreamedPatches(patch);
        recordLatestStreamedPatch(streamedPatches);

        for (const ws of clients) {
            try {
                if (ws.readyState !== READY_STATE_OPEN) {
                    failureCount += 1;
                    continue;
                }

                ws.send(serializedMessage);
                recordDeliveredPatches(ws, streamedPatches);
                successCount += 1;
            } catch (error) {
                failureCount += 1;
                if (verbose) {
                    const clientId = clientIds.get(ws) ?? "[unknown]";
                    console.error(`[WebSocket] Failed to send to ${clientId}: ${describeWebSocketError(error)}`);
                }
            }
        }

        return { successCount, failureCount, totalClients: clients.size };
    }

    /**
     * Stops the WebSocket server and closes all connections.
     */
    async function stop() {
        if (closed) {
            return;
        }
        closed = true;

        for (const ws of clients) {
            try {
                ws.close();
            } catch (closeError) {
                if (verbose) {
                    const clientId = clientIds.get(ws) ?? "[unknown]";
                    console.error(
                        `[WebSocket] Failed to close client socket (${clientId}): ${describeWebSocketError(closeError)}`
                    );
                }
            }
        }

        clients.clear();

        await new Promise<void>((resolve, reject) => {
            const rejectWithError = (reason: unknown): void => {
                if (Core.isErrorLike(reason)) {
                    reject(reason);
                    return;
                }

                const description = describeValueForError(reason ?? "[WebSocket] Unknown server shutdown failure");

                reject(new Error(description));
            };

            wss.close((error) => {
                if (error) {
                    rejectWithError(error);
                    return;
                }

                resolve();
            });
        });

        if (verbose) {
            console.log("[WebSocket] Server stopped");
        }
    }

    return {
        url,
        host: resolvedHost,
        port: resolvedPort,
        broadcast,
        stop,
        getClientCount: () => clients.size,
        getLastStreamedPatch: () => lastStreamedPatch
    };
}

function parsePatchAppliedAcknowledgement(payload: unknown): PatchAppliedAcknowledgement | null {
    if (!Core.isObjectLike(payload)) {
        return null;
    }

    const message = payload as Record<string, unknown>;
    if (
        message.type !== "patch_ack" ||
        message.status !== "applied" ||
        !Core.isNonEmptyString(message.id) ||
        message.id.length > 512 ||
        !Core.isNonEmptyString(message.revision) ||
        message.revision.length > 512
    ) {
        return null;
    }

    const runtimeVersion = message.runtimeVersion;
    if (runtimeVersion === undefined) {
        return {
            type: "patch_ack",
            id: message.id,
            revision: message.revision,
            status: "applied"
        };
    }
    if (typeof runtimeVersion !== "number" || !Number.isFinite(runtimeVersion) || runtimeVersion < 0) {
        return null;
    }

    return {
        type: "patch_ack",
        id: message.id,
        revision: message.revision,
        status: "applied",
        runtimeVersion
    };
}
