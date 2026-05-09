export { createWebSocketClient } from "./client.js";
export { ensureApplicationSurfaceAccessor, resolveRuntimeReadiness } from "./runtime-readiness.js";
export type {
    MessageEventLike,
    PatchQueueMetrics,
    PatchQueueOptions,
    PatchQueueState,
    RuntimeWebSocketClient,
    RuntimeWebSocketConstructor,
    RuntimeWebSocketInstance,
    WebSocketClientOptions,
    WebSocketClientState,
    WebSocketConnectionLifecycle,
    WebSocketConnectionMetrics,
    WebSocketEvent,
    WebSocketInstanceProvider,
    WebSocketMessageSender,
    WebSocketMetricsCollector,
    WebSocketPatchQueueManager
} from "./types.js";
