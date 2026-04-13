/**
 * HTTP status server for the watch command.
 *
 * Provides a simple HTTP endpoint that returns JSON status information about
 * the running watch command, including metrics, recent patches, errors, and
 * WebSocket client count.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Socket } from "node:net";

import type { ServerEndpoint, ServerLifecycle } from "../server/index.js";
import {
    DEFAULT_STATUS_HEALTH_POLICY_CONFIG,
    evaluateReadiness,
    evaluateTranspilationHealth
} from "./status-health-policy.js";

export interface StatusSnapshot {
    uptime: number;
    /** Number of patches in the bounded metrics window (capped at maxPatchHistory). */
    patchCount: number;
    /** Cumulative count of all patches broadcast since startup (not bounded). */
    totalPatchCount?: number;
    /** Number of patch summaries currently retained in the history ring. */
    patchHistorySize?: number;
    /** Maximum number of patches retained in the history ring. */
    maxPatchHistory?: number;
    errorCount: number;
    recentPatches: Array<{
        id: string;
        timestamp: number;
        durationMs: number;
        filePath: string;
        /** End-to-end hot-reload latency from file-change detection to patch broadcast, when available. */
        hotReloadLatencyMs?: number;
    }>;
    recentErrors: Array<{
        timestamp: number;
        filePath: string;
        error: string;
    }>;
    websocketClients: number;
    /** Whether the initial file scan has completed. */
    scanComplete?: boolean;
    /** Average end-to-end hot-reload latency (ms) across all patches in the current metrics window. */
    avgHotReloadLatencyMs?: number;
    /** 95th-percentile end-to-end hot-reload latency (ms) across all patches in the current metrics window. */
    p95HotReloadLatencyMs?: number;
}

/**
 * Handler function for an HTTP endpoint.
 *
 * @param req - Incoming HTTP request
 * @param res - HTTP response to write to
 * @param getSnapshot - Function to retrieve current status snapshot
 */
export type EndpointHandler = (req: IncomingMessage, res: ServerResponse, getSnapshot: () => StatusSnapshot) => void;

/**
 * Registry for HTTP endpoint handlers.
 *
 * Decouples endpoint registration from request routing, enabling consumers
 * to inject custom diagnostic or monitoring endpoints without modifying the
 * server implementation.
 *
 * @example
 * ```typescript
 * // Create a custom endpoint registry
 * const customEndpoints = new EndpointRegistry();
 *
 * // Register a metrics endpoint
 * customEndpoints.register("/metrics", (req, res, getSnapshot) => {
 *     const snapshot = getSnapshot();
 *     res.writeHead(200, { "Content-Type": "application/json" });
 *     res.end(JSON.stringify({
 *         patches: snapshot.patchCount,
 *         errors: snapshot.errorCount,
 *         uptime: snapshot.uptime
 *     }));
 * });
 *
 * // Start server with custom endpoints
 * const server = await startStatusServer({
 *     getSnapshot: () => myStatusSnapshot,
 *     customEndpoints
 * });
 * ```
 *
 * @remarks
 * - Custom endpoints are additive by default, preserving all default endpoints
 * - Custom endpoints can override defaults by registering the same path
 * - Intended for monitoring tools, custom health checks, and diagnostic endpoints
 * - Keep endpoints focused and lightweight to avoid blocking the event loop
 */
export class EndpointRegistry {
    private readonly handlers = new Map<string, EndpointHandler>();

    /**
     * Registers an endpoint handler.
     *
     * @param path - URL path (e.g., "/status", "/metrics")
     * @param handler - Handler function to invoke for this path
     */
    register(path: string, handler: EndpointHandler): void {
        this.handlers.set(path, handler);
    }

    /**
     * Retrieves the handler for a given path.
     *
     * @param path - URL path to look up
     * @returns Handler function if registered, undefined otherwise
     */
    getHandler(path: string): EndpointHandler | undefined {
        return this.handlers.get(path);
    }

    /**
     * Returns all registered endpoint paths.
     *
     * @returns Iterator of registered paths
     */
    paths(): IterableIterator<string> {
        return this.handlers.keys();
    }

    /**
     * Returns all registered handlers with their paths.
     *
     * @returns Iterator of [path, handler] entries
     */
    entries(): IterableIterator<[string, EndpointHandler]> {
        return this.handlers.entries();
    }
}

export interface StatusServerOptions {
    host?: string;
    port?: number;
    getSnapshot: () => StatusSnapshot;
    /**
     * Optional custom endpoint registry.
     *
     * When provided, these endpoints are registered in addition to the default
     * endpoints (/status, /health, /ping, /ready). Custom endpoints can override
     * default endpoints by registering the same path.
     *
     * Use this to inject monitoring, diagnostics, or domain-specific endpoints
     * without modifying the server implementation.
     */
    customEndpoints?: EndpointRegistry;
}

/**
 * Endpoint metadata for the status server.
 *
 * Keeps address information independent from lifecycle controls so consumers
 * can depend on only what they need.
 */
export type StatusServerEndpoint = ServerEndpoint;

/**
 * Lifecycle control for the status server.
 *
 * Provides shutdown capability without coupling to endpoint metadata.
 */
export type StatusServerLifecycle = ServerLifecycle;

/**
 * Combined status server handle.
 *
 * Provided for callers that need both endpoint metadata and lifecycle control.
 */
export type StatusServerHandle = StatusServerEndpoint & StatusServerLifecycle;

const DEFAULT_STATUS_HOST = "127.0.0.1";
const DEFAULT_STATUS_PORT = 17_891;

function sendJsonResponse(res: ServerResponse, statusCode: number, data: unknown): void {
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(data, null, 2));
}

interface SnapshotEndpointFailureResponseOptions {
    readonly logMessage: string;
    readonly statusCode: number;
    readonly body: Record<string, unknown>;
}

function respondWithSnapshot(
    res: ServerResponse,
    getSnapshot: () => StatusSnapshot,
    onSnapshot: (snapshot: StatusSnapshot) => void,
    failure: SnapshotEndpointFailureResponseOptions
): void {
    try {
        const snapshot = getSnapshot();
        onSnapshot(snapshot);
    } catch (error) {
        console.error(failure.logMessage, error);
        sendJsonResponse(res, failure.statusCode, failure.body);
    }
}

function handleStatusRequest(_req: IncomingMessage, res: ServerResponse, getSnapshot: () => StatusSnapshot): void {
    // Withhold internal error details from HTTP clients to avoid leaking
    // implementation specifics or stack traces. We log the full error on the
    // server (stderr or logging backend) for debugging, then send a generic
    // 500 response to the client. This defensive posture prevents accidental
    // disclosure of file paths, module names, or environmental configuration
    // that could aid attackers or confuse end users unfamiliar with the
    // server's internal structure.
    respondWithSnapshot(
        res,
        getSnapshot,
        (snapshot) => {
            sendJsonResponse(res, 200, snapshot);
        },
        {
            logMessage: "Failed to generate status snapshot:",
            statusCode: 500,
            body: {
                error: "Failed to generate status snapshot"
            }
        }
    );
}

function handleHealthRequest(_req: IncomingMessage, res: ServerResponse, getSnapshot: () => StatusSnapshot): void {
    respondWithSnapshot(
        res,
        getSnapshot,
        (snapshot) => {
            const health = {
                status: "healthy",
                timestamp: Date.now(),
                uptime: snapshot.uptime,
                checks: {
                    transpilation: {
                        ...evaluateTranspilationHealth({
                            patchCount: snapshot.patchCount,
                            errorCount: snapshot.errorCount
                        })
                    },
                    websocket: {
                        status: "pass",
                        clients: snapshot.websocketClients
                        // Note: Status is always 'pass' based on current snapshot data.
                        // Future enhancement: integrate with websocket server lifecycle
                        // to detect server startup failures or connection issues.
                    }
                }
            };
            sendJsonResponse(res, 200, health);
        },
        {
            logMessage: "Failed to generate health check:",
            statusCode: 503,
            body: {
                status: "unhealthy",
                error: "Failed to generate health check"
            }
        }
    );
}

function handlePingRequest(
    _req: IncomingMessage,
    res: ServerResponse,
    // Parameter required for EndpointHandler type conformance, but not used by ping
    _getSnapshot: () => StatusSnapshot
): void {
    sendJsonResponse(res, 200, { status: "ok", timestamp: Date.now() });
}

function handleReadyRequest(_req: IncomingMessage, res: ServerResponse, getSnapshot: () => StatusSnapshot): void {
    respondWithSnapshot(
        res,
        getSnapshot,
        (snapshot) => {
            const { isReady } = evaluateReadiness(
                {
                    patchCount: snapshot.patchCount,
                    errorCount: snapshot.errorCount
                },
                DEFAULT_STATUS_HEALTH_POLICY_CONFIG
            );
            const statusCode = isReady ? 200 : 503;
            sendJsonResponse(res, statusCode, {
                ready: isReady,
                timestamp: Date.now(),
                uptime: snapshot.uptime
            });
        },
        {
            logMessage: "Failed to generate readiness check:",
            statusCode: 503,
            body: {
                ready: false,
                error: "Failed to generate readiness check"
            }
        }
    );
}

function handleNotFound(res: ServerResponse): void {
    sendJsonResponse(res, 404, {
        error: "Not found",
        message: "Supported endpoints: GET /status, GET /health, GET /ping, GET /ready"
    });
}

/**
 * Creates a default endpoint registry with standard status endpoints.
 *
 * @returns Registry with /status, /health, /ping, and /ready endpoints
 */
function createDefaultEndpointRegistry(): EndpointRegistry {
    const registry = new EndpointRegistry();
    registry.register("/status", handleStatusRequest);
    registry.register("/health", handleHealthRequest);
    registry.register("/ping", handlePingRequest);
    registry.register("/ready", handleReadyRequest);
    return registry;
}

/**
 * Creates and starts an HTTP status server.
 *
 * @param options - Server configuration
 * @returns Status server handle with endpoint metadata and lifecycle controls
 */
export async function startStatusServer({
    host = DEFAULT_STATUS_HOST,
    port = DEFAULT_STATUS_PORT,
    getSnapshot,
    customEndpoints
}: StatusServerOptions): Promise<StatusServerHandle> {
    const activeSockets = new Set<Socket>();

    // Start with default endpoints, then overlay custom endpoints if provided
    const registry = createDefaultEndpointRegistry();
    if (customEndpoints) {
        // Copy custom endpoints into the registry, potentially overriding defaults
        for (const [path, handler] of customEndpoints.entries()) {
            registry.register(path, handler);
        }
    }

    const server: Server = createServer((req, res) => {
        if (req.method === "GET" && req.url) {
            const handler = registry.getHandler(req.url);
            if (handler) {
                handler(req, res, getSnapshot);
            } else {
                handleNotFound(res);
            }
        } else {
            handleNotFound(res);
        }
    });

    server.on("connection", (socket) => {
        activeSockets.add(socket);

        const removeSocket = () => {
            activeSockets.delete(socket);
        };

        socket.on("close", removeSocket);
        socket.on("error", removeSocket);
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
        });
    });

    const actualAddress = server.address();
    const actualHost = actualAddress && typeof actualAddress === "object" ? actualAddress.address : host;
    const actualPort = actualAddress && typeof actualAddress === "object" ? actualAddress.port : port;

    return {
        url: `http://${actualHost}:${actualPort}/status`,
        host: actualHost,
        port: actualPort,
        stop() {
            return new Promise<void>((resolve, reject) => {
                for (const socket of activeSockets) {
                    socket.destroy();
                }
                activeSockets.clear();

                server.close((err) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        }
    };
}
