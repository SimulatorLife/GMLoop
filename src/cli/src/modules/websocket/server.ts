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

function describeWebSocketError(error: unknown): string {
    if (Core.isErrorLike(error)) {
        return error.message;
    }

    return describeValueForError(error);
}

export interface PatchWebSocketServerOptions {
    host?: string;
    port?: number;
    verbose?: boolean;
    onClientConnect?: (clientId: string, socket: WebSocket) => void;
    onClientDisconnect?: (clientId: string) => void;
    prepareInitialMessages?: () => Iterable<unknown>;
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
    prepareInitialMessages
}: PatchWebSocketServerOptions = {}): Promise<PatchWebSocketServer> {
    const clients = new Set<WebSocket>();
    const clientIds = new Map<WebSocket, string>();

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
                const replayedCount =
                    replayPayloads.length > 0 && sendJsonMessage(ws, replayPayload, clientId)
                        ? replayPayloads.length
                        : 0;

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

        let cleanedUp = false;
        const cleanupClient = (reason: "close" | "error", error?: unknown) => {
            if (cleanedUp) {
                return;
            }
            cleanedUp = true;

            clients.delete(ws);
            clientIds.delete(ws);

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

        for (const ws of clients) {
            try {
                if (ws.readyState !== READY_STATE_OPEN) {
                    failureCount += 1;
                    continue;
                }

                ws.send(serializedMessage);
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
        getClientCount: () => clients.size
    };
}
