import type { Logger } from "../runtime/logger.js";
import type { PatchApplicator, RuntimePatchError } from "../runtime/types.js";

export type WebSocketEvent = "open" | "message" | "close" | "error";

export interface MessageEventLike {
    data: unknown;
}

export interface RuntimeWebSocketInstance {
    addEventListener(event: WebSocketEvent, handler: (event?: MessageEventLike | Error) => void): void;
    removeEventListener(event: WebSocketEvent, handler: (event?: MessageEventLike | Error) => void): void;
    send(data: string): void;
    close(): void;
}

export type RuntimeWebSocketConstructor = new (url: string) => RuntimeWebSocketInstance;

export interface PatchQueueOptions {
    maxQueueSize?: number;
    flushIntervalMs?: number;
    enabled?: boolean;
}

export interface WebSocketClientOptions {
    url?: string;
    wrapper?: PatchApplicator | null;
    onConnect?: () => void;
    onDisconnect?: () => void;
    onError?: (error: RuntimePatchError, phase: "connection" | "patch") => void;
    reconnectDelay?: number;
    autoConnect?: boolean;
    patchQueue?: PatchQueueOptions;
    logger?: Logger;
}

export interface PatchQueueState {
    queue: Array<unknown>;
    flushTimer: ReturnType<typeof setTimeout> | null;
    queueMetrics: PatchQueueMetrics;
    queueHead: number;
}

export interface WebSocketClientState {
    ws: RuntimeWebSocketInstance | null;
    isConnected: boolean;
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    manuallyDisconnected: boolean;
    connectionMetrics: WebSocketConnectionMetrics;
    patchQueue: PatchQueueState | null;
    pendingPatches: Array<unknown>;
    pendingPatchHead: number;
    readinessTimer: ReturnType<typeof setInterval> | null;
    runtimeReady: boolean;
    errorPendingReconnectSuppression?: boolean;
}

export interface PatchQueueMetrics {
    totalQueued: number;
    totalFlushed: number;
    totalDropped: number;
    /**
     * Cumulative count of patches skipped during flush because a later patch
     * with the same ID was already in the same flush batch. Only the most-recent
     * patch per ID is applied; earlier duplicates are counted here.
     */
    totalDeduplicated: number;
    maxQueueDepth: number;
    flushCount: number;
    lastFlushSize: number;
    lastFlushedAt: number | null;
}

export interface WebSocketConnectionMetrics {
    totalConnections: number;
    totalDisconnections: number;
    totalReconnectAttempts: number;
    patchesReceived: number;
    patchesApplied: number;
    patchesFailed: number;
    lastConnectedAt: number | null;
    lastDisconnectedAt: number | null;
    lastPatchReceivedAt: number | null;
    lastPatchAppliedAt: number | null;
    connectionErrors: number;
    patchErrors: number;
}

/**
 * Connection lifecycle management.
 *
 * Provides the ability to establish, tear down, and check the status
 * of the WebSocket connection without coupling to message transmission,
 * metrics tracking, or patch queue management.
 */
export interface WebSocketConnectionLifecycle {
    /**
     * Establishes a WebSocket connection to the server.
     * Does nothing if already connected.
     */
    connect(): void;

    /**
     * Disconnects from the WebSocket server and flushes any pending patches.
     * Prevents automatic reconnection attempts.
     */
    disconnect(): void;

    /**
     * Returns true if the WebSocket is currently connected, false otherwise.
     */
    isConnected(): boolean;
}

/**
 * Message transmission.
 *
 * Provides the ability to send messages over the WebSocket connection
 * without coupling to connection lifecycle or metrics.
 */
export interface WebSocketMessageSender {
    /**
     * Sends arbitrary data over the WebSocket connection.
     * Data is stringified if not already a string.
     * @throws {Error} Throws an Error with message "WebSocket is not connected" if the connection is not established
     */
    send(data: unknown): void;
}

/**
 * WebSocket instance access.
 *
 * Provides access to the underlying WebSocket instance for advanced
 * use cases without coupling to lifecycle management or metrics.
 */
export interface WebSocketInstanceProvider {
    /**
     * Returns the underlying WebSocket instance, or null if not connected.
     */
    getWebSocket(): RuntimeWebSocketInstance | null;
}

/**
 * Connection metrics tracking.
 *
 * Provides diagnostics and monitoring capabilities for connection
 * health without coupling to message transmission or lifecycle.
 */
export interface WebSocketMetricsCollector {
    /**
     * Returns connection health metrics for diagnostics and monitoring.
     */
    getConnectionMetrics(): Readonly<WebSocketConnectionMetrics>;

    /**
     * Resets all connection metrics to their initial state.
     * Useful for starting fresh metric collection in long-running sessions
     * or for testing scenarios that require clean metric baselines.
     */
    resetConnectionMetrics(): void;
}

/**
 * Patch queue management.
 *
 * Provides control over patch queueing behavior and metrics
 * without coupling to connection lifecycle or message transmission.
 */
export interface WebSocketPatchQueueManager {
    /**
     * Returns patch queue metrics if queuing is enabled, null otherwise.
     * These metrics track queuing behavior for diagnostic and tuning purposes.
     */
    getPatchQueueMetrics(): Readonly<PatchQueueMetrics> | null;

    /**
     * Manually flushes any queued patches immediately.
     * Only applicable when patch queuing is enabled.
     * Returns the number of patches flushed.
     */
    flushPatchQueue(): number;
}

/**
 * Complete WebSocket client interface.
 *
 * Combines all role-focused interfaces for consumers that need full
 * WebSocket client capabilities. Consumers should prefer depending on
 * the minimal interface they need (WebSocketConnectionLifecycle,
 * WebSocketMessageSender, etc.) rather than this composite interface
 * when possible.
 */
export interface RuntimeWebSocketClient
    extends WebSocketConnectionLifecycle,
        WebSocketMessageSender,
        WebSocketInstanceProvider,
        WebSocketMetricsCollector,
        WebSocketPatchQueueManager {}
