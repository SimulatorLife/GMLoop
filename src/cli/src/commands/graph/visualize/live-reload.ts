import net from "node:net";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_LIVE_RELOAD_STATUS_HOST,
    DEFAULT_LIVE_RELOAD_STATUS_PORT,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT
} from "../../../modules/live-reload/config.js";
import { manageLiveReloadSession } from "../../../modules/live-reload/session-controller.js";
import {
    discoverLiveReloadSessionByPath,
    type LiveReloadRegisteredSession
} from "../../../modules/live-reload/session-registry.js";
import type {
    GraphVisualizationLiveReloadEndpointOptions,
    GraphVisualizationLiveReloadModel,
    GraphVisualizationLiveReloadSessionState,
    GraphVisualizationLiveReloadStartupOptions,
    GraphVisualizationLiveReloadStatusSnapshot
} from "./types.js";

const GRAPH_VISUALIZATION_LIVE_RELOAD_POLL_INTERVAL_MS = 2000;

function resolveGraphVisualizationLiveReloadStartupOptions(
    projectRoot: string,
    projectConfig: Record<string, unknown>
): GraphVisualizationLiveReloadStartupOptions {
    const runtimeConfig = Core.isObjectLike(projectConfig.runtime)
        ? (projectConfig.runtime as Record<string, unknown>)
        : null;
    const liveReloadConfig = Core.isObjectLike(runtimeConfig?.liveReload)
        ? (runtimeConfig.liveReload as Record<string, unknown>)
        : null;
    const configuredHtml5OutputRoot =
        typeof liveReloadConfig?.html5Output === "string" ? liveReloadConfig.html5Output.trim() : "";
    const configuredGmTempRoot =
        typeof liveReloadConfig?.gmTempRoot === "string" ? liveReloadConfig.gmTempRoot.trim() : "";
    const hasBuildConfiguration = Core.isObjectLike(liveReloadConfig?.build);

    return Object.freeze({
        gmTempRoot:
            configuredGmTempRoot.length > 0 ? path.resolve(projectRoot, configuredGmTempRoot) : DEFAULT_GM_TEMP_ROOT,
        hasBuildConfiguration,
        html5OutputRoot:
            configuredHtml5OutputRoot.length > 0 ? path.resolve(projectRoot, configuredHtml5OutputRoot) : null,
        statusHost: DEFAULT_LIVE_RELOAD_STATUS_HOST,
        statusPort: DEFAULT_LIVE_RELOAD_STATUS_PORT,
        websocketHost: DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
        websocketPort: DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT
    });
}

function createGraphVisualizationLiveReloadStartArguments(
    startupOptions: GraphVisualizationLiveReloadStartupOptions
): Array<string> {
    return [
        ...(startupOptions.html5OutputRoot === null ? [] : ["--html5-output", startupOptions.html5OutputRoot]),
        "--gm-temp-root",
        startupOptions.gmTempRoot,
        "--websocket-port",
        String(startupOptions.websocketPort),
        "--websocket-host",
        startupOptions.websocketHost,
        "--status-port",
        String(startupOptions.statusPort),
        "--status-host",
        startupOptions.statusHost,
        "--start-source",
        "ui",
        "--quiet"
    ];
}

async function allocateGraphVisualizationLiveReloadPort(host: string): Promise<number> {
    const server = net.createServer();
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, host, () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (address === null || typeof address === "string") {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
        throw new Error("Could not allocate a live-reload port.");
    }

    const port = address.port;
    await new Promise<void>((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
    return port;
}

async function allocateGraphVisualizationLiveReloadEndpointOptions(): Promise<GraphVisualizationLiveReloadEndpointOptions> {
    return Object.freeze({
        statusHost: DEFAULT_LIVE_RELOAD_STATUS_HOST,
        statusPort: await allocateGraphVisualizationLiveReloadPort(DEFAULT_LIVE_RELOAD_STATUS_HOST),
        websocketHost: DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
        websocketPort: await allocateGraphVisualizationLiveReloadPort(DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST)
    });
}

function parseGraphVisualizationLiveReloadStatusSnapshot(
    payload: Record<string, unknown>
): GraphVisualizationLiveReloadStatusSnapshot {
    const patchCount = typeof payload.patchCount === "number" ? payload.patchCount : 0;
    const totalPatchCount = typeof payload.totalPatchCount === "number" ? payload.totalPatchCount : null;
    const patchHistorySize = typeof payload.patchHistorySize === "number" ? payload.patchHistorySize : null;
    const maxPatchHistory = typeof payload.maxPatchHistory === "number" ? payload.maxPatchHistory : null;
    const errorCount = typeof payload.errorCount === "number" ? payload.errorCount : 0;
    const scanComplete = payload.scanComplete === true;
    const websocketClients = typeof payload.websocketClients === "number" ? payload.websocketClients : 0;
    const uptimeMs = typeof payload.uptime === "number" ? payload.uptime : 0;
    const runtimeUrl =
        typeof payload.runtimeUrl === "string" && payload.runtimeUrl.trim().length > 0 ? payload.runtimeUrl : null;

    return Object.freeze({
        avgHotReloadLatencyMs: typeof payload.avgHotReloadLatencyMs === "number" ? payload.avgHotReloadLatencyMs : null,
        errorCount,
        maxPatchHistory,
        patchCount,
        patchHistorySize,
        p95HotReloadLatencyMs: typeof payload.p95HotReloadLatencyMs === "number" ? payload.p95HotReloadLatencyMs : null,
        recentErrors: Array.isArray(payload.recentErrors)
            ? payload.recentErrors
                  .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
                  .map((entry) =>
                      Object.freeze({
                          error: typeof entry.error === "string" ? entry.error : "Unknown error",
                          filePath: typeof entry.filePath === "string" ? entry.filePath : "unknown",
                          recoveryHint: typeof entry.recoveryHint === "string" ? entry.recoveryHint : null,
                          timestamp: typeof entry.timestamp === "number" ? entry.timestamp : 0
                      })
                  )
            : [],
        recentPatches: Array.isArray(payload.recentPatches)
            ? payload.recentPatches
                  .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
                  .map((entry) =>
                      Object.freeze({
                          durationMs: typeof entry.durationMs === "number" ? entry.durationMs : 0,
                          filePath: typeof entry.filePath === "string" ? entry.filePath : "unknown",
                          hotReloadLatencyMs:
                              typeof entry.hotReloadLatencyMs === "number" ? entry.hotReloadLatencyMs : null,
                          id: typeof entry.id === "string" ? entry.id : "unknown",
                          timestamp: typeof entry.timestamp === "number" ? entry.timestamp : 0
                      })
                  )
            : [],
        runtimeUrl,
        scanComplete,
        totalPatchCount,
        uptimeMs,
        watcherStatus: errorCount > 0 && scanComplete === false ? "error" : scanComplete ? "running" : "scanning",
        websocketClients
    });
}

function createGraphVisualizationLiveReloadModelFromSession(
    session: LiveReloadRegisteredSession,
    status: Record<string, unknown> | null
): GraphVisualizationLiveReloadModel {
    const statusSnapshot = status === null ? null : parseGraphVisualizationLiveReloadStatusSnapshot(status);
    return Object.freeze({
        endpoints: Object.freeze({
            runtimeUrl: session.runtimeUrl ?? statusSnapshot?.runtimeUrl ?? null,
            statusUrl: session.statusUrl,
            websocketUrl: session.websocketUrl
        }),
        pollIntervalMs: GRAPH_VISUALIZATION_LIVE_RELOAD_POLL_INTERVAL_MS,
        runtimeHealth: null,
        statusSnapshot
    });
}

function createGraphVisualizationLiveReloadSessionState(): GraphVisualizationLiveReloadSessionState {
    return {
        generation: 0,
        model: null,
        ownedSession: null,
        session: null,
        startupPromise: null
    };
}

function resetGraphVisualizationLiveReloadSession(sessionState: GraphVisualizationLiveReloadSessionState): void {
    sessionState.generation += 1;
    sessionState.model = null;
    sessionState.ownedSession = null;
    sessionState.session = null;
    sessionState.startupPromise = null;
}

function haveSameGraphVisualizationLiveReloadSession(
    left: LiveReloadRegisteredSession,
    right: LiveReloadRegisteredSession
): boolean {
    return (
        left.projectRoot === right.projectRoot &&
        left.processId === right.processId &&
        left.sessionId === right.sessionId
    );
}

async function stopOwnedGraphVisualizationLiveReloadSession(
    sessionState: GraphVisualizationLiveReloadSessionState,
    targetPath: string | null,
    manageSession: typeof manageLiveReloadSession = manageLiveReloadSession,
    discoverSession: typeof discoverLiveReloadSessionByPath = discoverLiveReloadSessionByPath
): Promise<void> {
    const ownedSession = sessionState.ownedSession;
    const resolvedTargetPath = targetPath ?? ownedSession?.projectRoot ?? null;
    if (ownedSession === null || resolvedTargetPath === null) {
        resetGraphVisualizationLiveReloadSession(sessionState);
        return;
    }

    const discovery = await discoverSession(resolvedTargetPath);
    if (discovery.session !== null && haveSameGraphVisualizationLiveReloadSession(ownedSession, discovery.session)) {
        await manageSession({
            forceStart: false,
            startArguments: [],
            stop: true,
            targetPath: resolvedTargetPath
        });
    }

    resetGraphVisualizationLiveReloadSession(sessionState);
}

async function stopGraphVisualizationLiveReloadSession(
    sessionState: GraphVisualizationLiveReloadSessionState,
    targetPath: string | null,
    manageSession: typeof manageLiveReloadSession = manageLiveReloadSession,
    discoverSession: typeof discoverLiveReloadSessionByPath = discoverLiveReloadSessionByPath
): Promise<void> {
    const session = sessionState.session;
    const resolvedTargetPath = targetPath ?? session?.projectRoot ?? null;
    if (session === null || resolvedTargetPath === null) {
        resetGraphVisualizationLiveReloadSession(sessionState);
        return;
    }

    const discovery = await discoverSession(resolvedTargetPath);
    if (discovery.session !== null && haveSameGraphVisualizationLiveReloadSession(session, discovery.session)) {
        await manageSession({
            forceStart: false,
            startArguments: [],
            stop: true,
            targetPath: resolvedTargetPath
        });
    }

    resetGraphVisualizationLiveReloadSession(sessionState);
}

type GraphVisualizationLiveReloadSessionDependencies = Readonly<{
    allocateEndpointOptions: () => Promise<GraphVisualizationLiveReloadEndpointOptions>;
    discoverSession: typeof discoverLiveReloadSessionByPath;
    manageSession: typeof manageLiveReloadSession;
}>;

const DEFAULT_GRAPH_VISUALIZATION_LIVE_RELOAD_SESSION_DEPENDENCIES: GraphVisualizationLiveReloadSessionDependencies =
    Object.freeze({
        allocateEndpointOptions: allocateGraphVisualizationLiveReloadEndpointOptions,
        discoverSession: discoverLiveReloadSessionByPath,
        manageSession: manageLiveReloadSession
    });

async function ensureGraphVisualizationLiveReloadSession(
    sessionState: GraphVisualizationLiveReloadSessionState,
    input: Readonly<{
        projectConfig: Record<string, unknown>;
        projectRoot: string;
        restart: boolean;
    }>,
    dependencies: GraphVisualizationLiveReloadSessionDependencies = DEFAULT_GRAPH_VISUALIZATION_LIVE_RELOAD_SESSION_DEPENDENCIES
): Promise<GraphVisualizationLiveReloadModel> {
    if (sessionState.startupPromise !== null) {
        return sessionState.startupPromise;
    }

    const startupGeneration = sessionState.generation;
    const startupPromise = (async (): Promise<GraphVisualizationLiveReloadModel> => {
        const existingSession = input.restart ? null : await dependencies.discoverSession(input.projectRoot);
        const endpointOptions = existingSession?.alive === true ? null : await dependencies.allocateEndpointOptions();
        const configuredStartupOptions = resolveGraphVisualizationLiveReloadStartupOptions(
            input.projectRoot,
            input.projectConfig
        );
        const startupOptions =
            endpointOptions === null
                ? configuredStartupOptions
                : Object.freeze({
                      ...configuredStartupOptions,
                      ...endpointOptions
                  });
        const result = await dependencies.manageSession({
            forceStart: input.restart,
            startArguments:
                endpointOptions === null ? [] : createGraphVisualizationLiveReloadStartArguments(startupOptions),
            stop: false,
            targetPath: input.projectRoot
        });
        if (result.session === null) {
            throw new Error("Live-reload session startup completed without a registered session.");
        }

        if (sessionState.generation !== startupGeneration) {
            if (result.mode === "started" || result.mode === "restarted") {
                await dependencies.manageSession({
                    forceStart: false,
                    startArguments: [],
                    stop: true,
                    targetPath: input.projectRoot
                });
            }
            throw new Error("Live-reload startup was superseded by a project change or stop request.");
        }

        const model = createGraphVisualizationLiveReloadModelFromSession(result.session, result.status);
        if (model.endpoints.runtimeUrl === null) {
            throw new Error(
                "Live-reload session startup completed without a runtime URL. The worker must register its runtime endpoint before becoming ready."
            );
        }

        sessionState.ownedSession = result.mode === "started" || result.mode === "restarted" ? result.session : null;
        sessionState.session = result.session;
        sessionState.model = model;
        return model;
    })();

    sessionState.startupPromise = startupPromise;
    try {
        return await startupPromise;
    } catch (error) {
        if (sessionState.generation === startupGeneration) {
            resetGraphVisualizationLiveReloadSession(sessionState);
        }
        throw error;
    } finally {
        if (sessionState.startupPromise === startupPromise) {
            sessionState.startupPromise = null;
        }
    }
}

export {
    allocateGraphVisualizationLiveReloadEndpointOptions,
    allocateGraphVisualizationLiveReloadPort,
    createGraphVisualizationLiveReloadModelFromSession,
    createGraphVisualizationLiveReloadSessionState,
    createGraphVisualizationLiveReloadStartArguments,
    ensureGraphVisualizationLiveReloadSession,
    haveSameGraphVisualizationLiveReloadSession,
    parseGraphVisualizationLiveReloadStatusSnapshot,
    resetGraphVisualizationLiveReloadSession,
    resolveGraphVisualizationLiveReloadStartupOptions,
    stopGraphVisualizationLiveReloadSession,
    stopOwnedGraphVisualizationLiveReloadSession
};
