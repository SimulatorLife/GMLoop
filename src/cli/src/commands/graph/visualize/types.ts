import type { FSWatcher, WatchListener, WatchOptions } from "node:fs";

import type { Semantic } from "@gmloop/semantic";
import type { UI } from "@gmloop/ui";

import type { LiveReloadRegisteredSession } from "../../../modules/live-reload/session-registry.js";

type GraphServeSource = "active-project-state" | "cli-path" | "demo-project" | "finder-open" | "working-directory";

type GraphVisualizedLoadedTarget = Readonly<{
    activePath: string;
    projectRoot: string;
    selectedPaths: ReadonlyArray<string>;
    source: GraphServeSource;
}>;

type GraphVisualizationStartupState = Readonly<{
    context: GraphResolutionContext | null;
    selectedPaths: Array<string>;
    source: GraphServeSource;
}>;

type GraphVisualizationServeBackgroundState = Readonly<{
    detail: string | null;
    message: string;
    phase: "error" | "loading";
}>;

type GraphVisualizationServeBundleCache = Readonly<{
    bundle: GraphVisualizationBundleArtifact;
    revision: number;
}>;

type GraphVisualizationServePayload = ReturnType<(typeof Semantic)["exportGraphVisualizationData"]>;

type GraphVisualizationActiveProjectStateWatcher = Readonly<{
    stop: () => void;
}>;

type GraphVisualizationLiveReloadStatusSnapshot = Readonly<{
    avgHotReloadLatencyMs: number | null;
    errorCount: number;
    maxPatchHistory: number | null;
    patchCount: number;
    patchHistorySize: number | null;
    p95HotReloadLatencyMs: number | null;
    recentErrors: ReadonlyArray<
        Readonly<{
            error: string;
            filePath: string;
            recoveryHint: string | null;
            timestamp: number;
        }>
    >;
    recentPatches: ReadonlyArray<
        Readonly<{
            durationMs: number;
            filePath: string;
            hotReloadLatencyMs: number | null;
            id: string;
            timestamp: number;
        }>
    >;
    runtimeUrl: string | null;
    scanComplete: boolean;
    totalPatchCount: number | null;
    uptimeMs: number;
    watcherStatus: "inactive" | "offline" | "scanning" | "running" | "error";
    websocketClients: number;
}>;

type GraphVisualizationLiveReloadModel = Readonly<{
    endpoints: Readonly<{
        runtimeUrl: string | null;
        statusUrl: string | null;
        websocketUrl: string | null;
    }>;
    pollIntervalMs: number;
    runtimeHealth: null;
    statusSnapshot: GraphVisualizationLiveReloadStatusSnapshot | null;
}>;

type GraphVisualizationLiveReloadSessionState = {
    generation: number;
    model: GraphVisualizationLiveReloadModel | null;
    ownedSession: LiveReloadRegisteredSession | null;
    session: LiveReloadRegisteredSession | null;
    startupPromise: Promise<GraphVisualizationLiveReloadModel> | null;
};

type GraphVisualizationLiveReloadStartupOptions = Readonly<{
    gmTempRoot: string;
    hasBuildConfiguration: boolean;
    html5OutputRoot: string | null;
    statusHost: string;
    statusPort: number;
    websocketHost: string;
    websocketPort: number;
}>;

type GraphVisualizationLiveReloadEndpointOptions = Readonly<{
    statusHost: string;
    statusPort: number;
    websocketHost: string;
    websocketPort: number;
}>;

type GraphVisualizationUiSourceWatchFactory = (
    path: string,
    options?: WatchOptions | BufferEncoding | "buffer",
    listener?: WatchListener<string>
) => FSWatcher;

type GraphVisualizationFeatherMetadataWatcher = Readonly<{
    close: () => void;
}>;

type GraphVisualizationFeatherMetadataWatchFactory = (path: string, listener?: WatchListener<string>) => FSWatcher;

type GraphVisualizationBundleFile = Readonly<{
    bytes: Uint8Array;
    contentType: string;
    relativePath: string;
}>;

type GraphVisualizationBundleArtifact = Readonly<{
    entryHtmlPath: string;
    files: ReadonlyArray<GraphVisualizationBundleFile>;
}>;

type GraphVisualizationExportResult = Readonly<{
    entryHtmlPath: string;
    outputDirectory: string;
}>;

type OsaScriptExecutionResult = Readonly<{
    stderr: string;
    stdout: string;
}>;

type GraphResolutionContext = Readonly<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}>;

type GraphVisualizationProjectWorkflow = (typeof UI.PROJECT_WORKFLOWS)[number];

export {
    type GraphResolutionContext,
    type GraphServeSource,
    type GraphVisualizationActiveProjectStateWatcher,
    type GraphVisualizationBundleArtifact,
    type GraphVisualizationBundleFile,
    type GraphVisualizationExportResult,
    type GraphVisualizationFeatherMetadataWatcher,
    type GraphVisualizationFeatherMetadataWatchFactory,
    type GraphVisualizationLiveReloadEndpointOptions,
    type GraphVisualizationLiveReloadModel,
    type GraphVisualizationLiveReloadSessionState,
    type GraphVisualizationLiveReloadStartupOptions,
    type GraphVisualizationLiveReloadStatusSnapshot,
    type GraphVisualizationProjectWorkflow,
    type GraphVisualizationServeBackgroundState,
    type GraphVisualizationServeBundleCache,
    type GraphVisualizationServePayload,
    type GraphVisualizationStartupState,
    type GraphVisualizationUiSourceWatchFactory,
    type GraphVisualizedLoadedTarget,
    type OsaScriptExecutionResult
};
