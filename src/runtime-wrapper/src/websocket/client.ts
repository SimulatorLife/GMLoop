import { Core } from "@gmloop/core";

import { resolveRuntimeErrorMessage } from "../runtime/error-normalization.js";
import type { Logger } from "../runtime/logger.js";
import { validatePatch } from "../runtime/patch-utils.js";
import type { Patch, PatchApplicator, RuntimePatchError, TrySafeApplyResult } from "../runtime/types.js";
import { getHighResolutionTime } from "../timing/index.js";
import {
    createInitialConnectionMetrics,
    createPatchQueueState,
    deduplicatePatchesById,
    enqueuePatchForDeferredFlush,
    enqueuePendingPatchUntilRuntimeReady,
    flushQueuedPatches as flushQueuedPatchBatch,
    recordPatchReceived
} from "./patch-queue.js";
import { ensureApplicationSurfaceAccessor, resolveRuntimeReadiness } from "./runtime-readiness.js";
import type {
    MessageEventLike,
    PatchQueueMetrics,
    RuntimeWebSocketClient,
    RuntimeWebSocketConstructor,
    RuntimeWebSocketInstance,
    WebSocketClientOptions,
    WebSocketClientState,
    WebSocketConnectionMetrics
} from "./types.js";

const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_FLUSH_INTERVAL_MS = 50;
const READINESS_POLL_INTERVAL_MS = 50;
const noopListenerTeardown = (): void => {};
const MIN_PATCH_QUEUE_SIZE = 1;
const MIN_PATCH_QUEUE_FLUSH_INTERVAL_MS = 1;

const textDecoder = new TextDecoder();

/**
 * Resolve a positive integer option with a guaranteed lower bound.
 *
 * @param value Candidate numeric value supplied by callers.
 * @param fallback Default value when the candidate is invalid.
 * @param minimum Inclusive minimum accepted value.
 * @returns A finite positive integer suitable for queue and timer configuration.
 */
function resolvePositiveIntegerOption(value: number | undefined, fallback: number, minimum: number): number {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.max(minimum, Math.trunc(value));
}

function applyIncomingPatchInternal(
    incoming: unknown,
    state: WebSocketClientState,
    wrapper: PatchApplicator | null,
    onError?: WebSocketClientOptions["onError"],
    logger?: Logger,
    alreadyRecordedReceived = false
): boolean {
    const receivedAt = alreadyRecordedReceived
        ? (state.connectionMetrics.lastPatchReceivedAt ?? Date.now())
        : recordPatchReceived(state);

    const patchResult = validatePatchCandidate(incoming, onError);
    if (patchResult.status === "skip") {
        state.connectionMetrics.patchErrors += 1;
        return true;
    }

    if (patchResult.status === "error") {
        state.connectionMetrics.patchesFailed += 1;
        state.connectionMetrics.patchErrors += 1;
        return false;
    }

    const patch = patchResult.patch;

    if (
        logger &&
        patch.metadata?.timestamp &&
        typeof patch.metadata.timestamp === "number" &&
        patch.metadata.timestamp > 0
    ) {
        const transportLatency = receivedAt - patch.metadata.timestamp;
        logger.debug(
            `Patch ${patch.id} transport latency: ${transportLatency}ms (generated at ${new Date(patch.metadata.timestamp).toISOString()})`
        );
    }

    const recordSuccess = (applyDuration: number) => {
        state.connectionMetrics.patchesApplied += 1;
        state.connectionMetrics.lastPatchAppliedAt = Date.now();
        if (logger) {
            logger.info(`Patch ${patch.id} applied in ${applyDuration}ms`);
        }
    };

    const recordFailure = () => {
        state.connectionMetrics.patchesFailed += 1;
        state.connectionMetrics.patchErrors += 1;
    };

    if (wrapper && wrapper.trySafeApply) {
        const appliedStartAt = getHighResolutionTime();
        const applied = applyPatchSafely(patch, wrapper, onError);
        if (applied) {
            recordSuccess(getHighResolutionTime() - appliedStartAt);
        } else {
            recordFailure();
        }
        return applied;
    }

    if (wrapper) {
        const appliedStartAt = getHighResolutionTime();
        const applied = applyPatchDirectly(patch, wrapper, onError);
        if (applied) {
            recordSuccess(getHighResolutionTime() - appliedStartAt);
        } else {
            recordFailure();
        }
        return applied;
    }

    return true;
}

export function createWebSocketClient({
    url = "ws://127.0.0.1:17890",
    wrapper = null,
    onConnect,
    onDisconnect,
    onError,
    reconnectDelay = 800,
    autoConnect = true,
    patchQueue,
    logger
}: WebSocketClientOptions = {}): RuntimeWebSocketClient {
    const requestedPatchQueueEnabled = patchQueue?.enabled ?? false;
    const queueEnabled = requestedPatchQueueEnabled && wrapper !== null;
    if (requestedPatchQueueEnabled && wrapper === null && logger) {
        logger.warn("Patch queue is disabled because no runtime wrapper was provided.");
    }
    const maxQueueSize = resolvePositiveIntegerOption(
        patchQueue?.maxQueueSize,
        DEFAULT_MAX_QUEUE_SIZE,
        MIN_PATCH_QUEUE_SIZE
    );
    const flushIntervalMs = resolvePositiveIntegerOption(
        patchQueue?.flushIntervalMs,
        DEFAULT_FLUSH_INTERVAL_MS,
        MIN_PATCH_QUEUE_FLUSH_INTERVAL_MS
    );
    const maxPendingPatches = maxQueueSize;

    const state: WebSocketClientState = {
        ws: null,
        isConnected: false,
        reconnectTimer: null,
        manuallyDisconnected: false,
        connectionMetrics: createInitialConnectionMetrics(),
        patchQueue: queueEnabled ? createPatchQueueState() : null,
        pendingPatches: [],
        pendingPatchHead: 0,
        readinessTimer: null,
        runtimeReady: false
    };
    let detachWebSocketListeners = noopListenerTeardown;

    const clearReadinessTimer = (): void => {
        if (state.readinessTimer !== null) {
            clearInterval(state.readinessTimer);
            state.readinessTimer = null;
        }
    };

    const flushPendingPatches = (): void => {
        const runtimeReady = resolveRuntimeReadiness(state.runtimeReady);
        state.runtimeReady = runtimeReady;
        if (!runtimeReady) {
            return;
        }

        ensureApplicationSurfaceAccessor();

        const pendingCount = state.pendingPatches.length - state.pendingPatchHead;
        if (pendingCount > 0) {
            const pending =
                state.pendingPatchHead === 0
                    ? state.pendingPatches
                    : state.pendingPatches.slice(state.pendingPatchHead);
            const { patches: deduplicatedPending } = deduplicatePatchesById(pending);

            state.pendingPatches = [];
            state.pendingPatchHead = 0;

            for (const patch of deduplicatedPending) {
                if (state.patchQueue) {
                    recordPatchReceived(state);
                    enqueuePatch(patch);
                } else {
                    applyIncomingPatchInternal(patch, state, wrapper, onError, logger);
                }
            }
        }

        clearReadinessTimer();
    };

    const ensureReadinessTimer = (): void => {
        if (state.readinessTimer !== null) {
            return;
        }

        state.readinessTimer = setInterval(() => {
            const runtimeReady = resolveRuntimeReadiness(state.runtimeReady);
            state.runtimeReady = runtimeReady;
            if (runtimeReady) {
                flushPendingPatches();
            }
        }, READINESS_POLL_INTERVAL_MS);
    };

    const queuePendingPatch = (patch: unknown): void => {
        enqueuePendingPatchUntilRuntimeReady(state, patch, maxPendingPatches);
        ensureReadinessTimer();
    };

    const flushQueuedPatches = (): number => {
        return flushQueuedPatchBatch(
            state,
            wrapper,
            (incoming) => applyIncomingPatchInternal(incoming, state, wrapper, onError, logger, true),
            logger
        );
    };

    const scheduleFlush = (): void => {
        if (!state.patchQueue) {
            return;
        }

        const queueState = state.patchQueue;
        if (queueState.flushTimer !== null) {
            return;
        }

        queueState.flushTimer = setTimeout(() => {
            queueState.flushTimer = null;
            flushQueuedPatches();
        }, flushIntervalMs);
    };

    const enqueuePatch = (patch: unknown): void => {
        enqueuePatchForDeferredFlush(state, patch, maxQueueSize, flushQueuedPatches, scheduleFlush, logger);
    };

    const applyIncomingPatch = (incoming: unknown): boolean => {
        const runtimeReady = resolveRuntimeReadiness(state.runtimeReady);
        state.runtimeReady = runtimeReady;
        if (!runtimeReady) {
            queuePendingPatch(incoming);
            return true;
        }

        ensureApplicationSurfaceAccessor();

        if (state.patchQueue) {
            recordPatchReceived(state);
            enqueuePatch(incoming);
            return true;
        }

        return applyIncomingPatchInternal(incoming, state, wrapper, onError, logger);
    };

    function connect() {
        if (state.ws && state.isConnected) {
            return;
        }

        state.manuallyDisconnected = false;

        // Clear any pending reconnect timer before establishing a new connection
        // This ensures that if connect() is called while a reconnect is scheduled,
        // we don't leak the timer or create duplicate connection attempts
        if (state.reconnectTimer !== null) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }

        try {
            const ctor = resolveWebSocketConstructor();
            const ws = new ctor(url);
            state.ws = ws;
            detachWebSocketListeners();
            detachWebSocketListeners = noopListenerTeardown;

            detachWebSocketListeners = attachWebSocketEventListeners(ws, {
                state,
                wrapper,
                onConnect,
                onDisconnect,
                onError,
                reconnectDelay,
                applyIncomingPatch,
                connect,
                logger,
                url,
                clearReadinessTimer,
                releaseListeners: () => {
                    detachWebSocketListeners();
                    detachWebSocketListeners = noopListenerTeardown;
                }
            });
        } catch (error) {
            handleConnectionError(error, onError);
        }
    }

    function disconnect() {
        state.manuallyDisconnected = true;

        if (state.patchQueue) {
            if (state.patchQueue.flushTimer !== null) {
                clearTimeout(state.patchQueue.flushTimer);
                state.patchQueue.flushTimer = null;
            }
            flushQueuedPatches();
        }

        if (state.reconnectTimer) {
            clearTimeout(state.reconnectTimer);
            state.reconnectTimer = null;
        }

        if (state.ws) {
            const activeSocket = state.ws;
            try {
                activeSocket.close();
            } finally {
                if (state.ws === activeSocket) {
                    detachWebSocketListeners();
                    detachWebSocketListeners = noopListenerTeardown;
                    state.ws = null;
                }
            }
        }

        if (state.isConnected) {
            state.connectionMetrics.totalDisconnections += 1;
            state.connectionMetrics.lastDisconnectedAt = Date.now();
            if (logger) {
                logger.websocketDisconnected();
            }
            if (onDisconnect) {
                onDisconnect();
            }
            state.ws = null;
        }

        state.isConnected = false;
        state.pendingPatches.length = 0;
        state.pendingPatchHead = 0;
        state.runtimeReady = false;
        clearReadinessTimer();
    }

    function isConnected(): boolean {
        return state.isConnected;
    }

    function send(data: unknown) {
        if (!state.ws || !state.isConnected) {
            throw new Error("WebSocket is not connected");
        }

        const message = typeof data === "string" ? data : JSON.stringify(data);
        state.ws.send(message);
    }

    function getWebSocket(): RuntimeWebSocketInstance | null {
        return state.ws;
    }

    function getConnectionMetrics(): Readonly<WebSocketConnectionMetrics> {
        return Object.freeze({ ...state.connectionMetrics });
    }

    function resetConnectionMetrics(): void {
        state.connectionMetrics = createInitialConnectionMetrics();
    }

    function getPatchQueueMetrics(): Readonly<PatchQueueMetrics> | null {
        if (!state.patchQueue) {
            return null;
        }
        return Object.freeze({ ...state.patchQueue.queueMetrics });
    }

    function flushPatchQueue(): number {
        return flushQueuedPatches();
    }

    if (autoConnect) {
        connect();
    }

    return {
        connect,
        disconnect,
        isConnected,
        send,
        getWebSocket,
        getConnectionMetrics,
        resetConnectionMetrics,
        getPatchQueueMetrics,
        flushPatchQueue
    };
}

type WebSocketEventListenerArgs = {
    state: WebSocketClientState;
    wrapper: WebSocketClientOptions["wrapper"];
    onConnect?: WebSocketClientOptions["onConnect"];
    onDisconnect?: WebSocketClientOptions["onDisconnect"];
    onError?: WebSocketClientOptions["onError"];
    reconnectDelay: number;
    applyIncomingPatch: (incoming: unknown) => boolean;
    connect: () => void;
    logger?: Logger;
    url: string;
    clearReadinessTimer: () => void;
    releaseListeners?: () => void;
};

type WebSocketMessageHandlerArgs = {
    wrapper: WebSocketClientOptions["wrapper"];
    applyIncomingPatch: (incoming: unknown) => boolean;
    onError?: WebSocketClientOptions["onError"];
};

type WebSocketCloseHandlerArgs = {
    state: WebSocketClientState;
    onDisconnect?: WebSocketClientOptions["onDisconnect"];
    reconnectDelay: number;
    connect: () => void;
    logger?: Logger;
    clearReadinessTimer: () => void;
    releaseListeners?: () => void;
};

type WebSocketErrorHandlerArgs = {
    state: WebSocketClientState;
    onError?: WebSocketClientOptions["onError"];
    logger?: Logger;
};

function attachWebSocketEventListeners(ws: RuntimeWebSocketInstance, args: WebSocketEventListenerArgs): () => void {
    const openHandler = createOpenHandler(args.state, args.onConnect, args.logger, args.url);
    const messageHandler = createMessageHandler({
        wrapper: args.wrapper,
        applyIncomingPatch: args.applyIncomingPatch,
        onError: args.onError
    });
    const closeHandler = createCloseHandler({
        state: args.state,
        onDisconnect: args.onDisconnect,
        reconnectDelay: args.reconnectDelay,
        connect: args.connect,
        logger: args.logger,
        clearReadinessTimer: args.clearReadinessTimer,
        releaseListeners: args.releaseListeners
    });
    const errorHandler = createErrorHandler({
        state: args.state,
        onError: args.onError,
        logger: args.logger
    });

    ws.addEventListener("open", openHandler);
    ws.addEventListener("message", messageHandler);
    ws.addEventListener("close", closeHandler);
    ws.addEventListener("error", errorHandler);

    return () => {
        ws.removeEventListener("open", openHandler);
        ws.removeEventListener("message", messageHandler);
        ws.removeEventListener("close", closeHandler);
        ws.removeEventListener("error", errorHandler);
    };
}

function createOpenHandler(
    state: WebSocketClientState,
    onConnect?: WebSocketClientOptions["onConnect"],
    logger?: Logger,
    url?: string
): () => void {
    return () => {
        const websocketState = state;
        websocketState.isConnected = true;
        websocketState.connectionMetrics.totalConnections += 1;
        websocketState.connectionMetrics.lastConnectedAt = Date.now();

        if (websocketState.reconnectTimer) {
            clearTimeout(websocketState.reconnectTimer);
            websocketState.reconnectTimer = null;
        }

        if (logger && url) {
            logger.websocketConnected(url);
        }

        if (onConnect) {
            onConnect();
        }
    };
}

function createMessageHandler({
    wrapper,
    applyIncomingPatch,
    onError
}: WebSocketMessageHandlerArgs): (event?: MessageEventLike | Error) => void {
    return (event?: MessageEventLike | Error) => {
        if (!wrapper) {
            return;
        }

        const payload = parseWebSocketPayload(event, onError);
        if (payload === null) {
            return;
        }

        const patches = Core.toArray(payload);

        for (const patch of patches) {
            if (!applyIncomingPatch(patch)) {
                break;
            }
        }
    };
}

function parseWebSocketPayload(
    event: MessageEventLike | Error | undefined,
    onError?: WebSocketClientOptions["onError"]
): unknown {
    if (!event || typeof event !== "object" || !("data" in event)) {
        return null;
    }

    const message = event.data;

    if (isStructuredPayload(message)) {
        return message;
    }

    if (isBinaryPayload(message)) {
        return decodeBinaryPayload(message, onError);
    }

    if (typeof message !== "string") {
        return null;
    }

    try {
        return JSON.parse(message);
    } catch (error) {
        if (onError) {
            const safeError = toRuntimePatchError(error);
            onError(safeError, "patch");
        }

        return null;
    }
}

function isStructuredPayload(value: unknown): value is object {
    return Boolean(value) && typeof value === "object" && !Core.isBinaryDataLike(value);
}

function isBinaryPayload(value: unknown): value is ArrayBuffer | ArrayBufferView {
    return Core.isBinaryDataLike(value);
}

function decodeBinaryPayload(
    payload: ArrayBuffer | ArrayBufferView,
    onError?: WebSocketClientOptions["onError"]
): unknown {
    try {
        const view = toUint8Array(payload);
        const decoded = textDecoder.decode(view);
        return JSON.parse(decoded);
    } catch (error) {
        if (onError) {
            const safeError = toRuntimePatchError(error);
            onError(safeError, "patch");
        }

        return null;
    }
}

function toUint8Array(payload: ArrayBuffer | ArrayBufferView): Uint8Array {
    if (Core.isArrayBufferLike(payload)) {
        return new Uint8Array(payload as ArrayBufferLike);
    }

    if (ArrayBuffer.isView(payload)) {
        return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
    }

    throw new Error("Binary payload must be an ArrayBuffer or ArrayBufferView");
}

function createCloseHandler({
    state,
    onDisconnect,
    reconnectDelay,
    connect,
    logger,
    clearReadinessTimer,
    releaseListeners
}: WebSocketCloseHandlerArgs): () => void {
    return () => {
        const websocketState = state;
        releaseListeners?.();
        websocketState.isConnected = false;
        websocketState.ws = null;
        websocketState.connectionMetrics.totalDisconnections += 1;
        websocketState.connectionMetrics.lastDisconnectedAt = Date.now();

        if (logger) {
            logger.websocketDisconnected();
        }

        if (onDisconnect) {
            onDisconnect();
        }

        // Ensure readiness polling does not run after the socket is closed.
        clearReadinessTimer();

        // Clear any existing reconnect timer before potentially setting a new one
        // This prevents timer leaks when close events occur in rapid succession
        // or when the WebSocket is closed externally (e.g., server disconnect, network error)
        if (websocketState.reconnectTimer !== null) {
            clearTimeout(websocketState.reconnectTimer);
            websocketState.reconnectTimer = null;
        }

        if (!websocketState.manuallyDisconnected && reconnectDelay > 0) {
            websocketState.connectionMetrics.totalReconnectAttempts += 1;
            if (logger) {
                logger.websocketReconnecting(websocketState.connectionMetrics.totalReconnectAttempts, reconnectDelay);
            }
            websocketState.reconnectTimer = setTimeout(() => {
                connect();
            }, reconnectDelay);
        }
    };
}

function createErrorHandler({ state, onError, logger }: WebSocketErrorHandlerArgs): (event?: Error) => void {
    return (event?: Error) => {
        const websocketState = state;
        websocketState.connectionMetrics.connectionErrors += 1;

        const errorMessage = Core.isErrorLike(event) ? event.message : "Unknown WebSocket error";

        if (logger) {
            logger.websocketError(errorMessage);
        }

        if (websocketState.ws) {
            websocketState.ws.close();
        }

        if (onError) {
            const safeError = createRuntimePatchError(errorMessage);
            onError(safeError, "connection");
        }
    };
}

function handleConnectionError(error: unknown, onError?: WebSocketClientOptions["onError"]): void {
    if (!onError) {
        return;
    }

    const safeError = toRuntimePatchError(error);
    onError(safeError, "connection");
}

type PatchValidationResult = { status: "skip" } | { status: "error" } | { status: "ok"; patch: Patch };

type HotReloadErrorNotification = {
    kind: "error";
    error: string;
    filePath?: string;
    timestamp?: number;
};

function isHotReloadErrorNotification(payload: Record<string, unknown>): payload is HotReloadErrorNotification {
    if (payload.kind !== "error") {
        return false;
    }

    return typeof payload.error === "string" && payload.error.length > 0;
}

function reportHotReloadErrorNotification(
    payload: HotReloadErrorNotification,
    onError?: WebSocketClientOptions["onError"]
): void {
    if (!onError) {
        return;
    }

    const fileDescriptor = payload.filePath ? ` in ${payload.filePath}` : "";
    const message = `Hot reload error${fileDescriptor}: ${payload.error}`;
    const error = createRuntimePatchError(message);
    onError(error, "patch");
}

function validatePatchCandidate(incoming: unknown, onError?: WebSocketClientOptions["onError"]): PatchValidationResult {
    if (!incoming || typeof incoming !== "object") {
        reportMalformedPatch(onError, "Received non-object patch payload; skipping message");
        return { status: "skip" };
    }

    if (isHotReloadErrorNotification(incoming as Record<string, unknown>)) {
        reportHotReloadErrorNotification(incoming as HotReloadErrorNotification, onError);
        return { status: "skip" };
    }

    const missingFields = resolveMissingPatchFields(incoming as Record<string, unknown>);
    if (missingFields.length > 0) {
        const missingList = missingFields.join(", ");
        reportMalformedPatch(
            onError,
            `Patch payload missing required field${missingFields.length > 1 ? "s" : ""}: ${missingList}`
        );
        return { status: "skip" };
    }

    const patchCandidate = incoming as Record<string, unknown>;
    try {
        validatePatch(patchCandidate);
    } catch (error) {
        if (onError) {
            const safeError = toRuntimePatchError(error);
            onError(safeError, "patch");
        }
        return { status: "error" };
    }

    return { status: "ok", patch: patchCandidate as Patch };
}

function applyPatchSafely(
    patch: Patch,
    wrapper: PatchApplicator,
    onError?: WebSocketClientOptions["onError"]
): boolean {
    try {
        const result = wrapper.trySafeApply(patch);
        return handleSafeApplyResult(result, patch, onError);
    } catch (error) {
        return handleSafeApplyException(error, patch, onError);
    }
}

function handleSafeApplyResult(
    result: TrySafeApplyResult | undefined,
    patch: Patch,
    onError?: WebSocketClientOptions["onError"]
): boolean {
    if (result && result.success === true) {
        return true;
    }

    const safeError = createRuntimePatchError(
        result?.message ?? result?.error ?? `Failed to apply patch ${patch.id}`,
        patch
    );
    safeError.rolledBack = result?.rolledBack;

    if (onError) {
        onError(safeError, "patch");
    }

    return false;
}

function handleSafeApplyException(error: unknown, patch: Patch, onError?: WebSocketClientOptions["onError"]): boolean {
    const safeError = toRuntimePatchError(error, patch);
    safeError.rolledBack =
        error && typeof error === "object" && "rolledBack" in error
            ? (error as { rolledBack?: boolean }).rolledBack
            : undefined;

    if (onError) {
        onError(safeError, "patch");
    }

    return false;
}

function applyPatchDirectly(
    patch: Patch,
    wrapper: PatchApplicator,
    onError?: WebSocketClientOptions["onError"]
): boolean {
    try {
        wrapper.applyPatch(patch);
        return true;
    } catch (error) {
        const safeError = toRuntimePatchError(error, patch);
        if (onError) {
            onError(safeError, "patch");
        }
        return false;
    }
}

function resolveWebSocketConstructor(): RuntimeWebSocketConstructor {
    const ctor = (globalThis as { WebSocket?: RuntimeWebSocketConstructor }).WebSocket;
    if (!ctor) {
        throw new Error("WebSocket global is not available");
    }

    return ctor;
}

function toRuntimePatchError(error: unknown, patch?: Patch): RuntimePatchError {
    const message = resolveRuntimeErrorMessage(error);
    return createRuntimePatchError(message, patch);
}

function createRuntimePatchError(message: string, patch?: Patch): RuntimePatchError {
    const runtimeError = new Error(message) as RuntimePatchError;
    runtimeError.patch = patch;
    return runtimeError;
}

function resolveMissingPatchFields(candidate: Record<string, unknown>): Array<"kind" | "id"> {
    const missing: Array<"kind" | "id"> = [];

    if (!("kind" in candidate)) {
        missing.push("kind");
    }

    if (!("id" in candidate)) {
        missing.push("id");
    }

    return missing;
}

function reportMalformedPatch(onError: WebSocketClientOptions["onError"] | undefined, message: string): void {
    if (!onError) {
        return;
    }

    const error = createRuntimePatchError(message);
    onError(error, "patch");
}
