import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, readFileSync, watch, type WatchListener, type WatchOptions } from "node:fs";
import { access, constants, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Lint, listLintRuleCatalogEntries } from "@gmloop/lint";
import { Refactor, type RefactorCodemodId } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { UI } from "@gmloop/ui";
import { Command, Option } from "commander";
import { ESLint } from "eslint";

import { getCliCommandCatalog, getMcpToolCatalogEntries } from "../cli.js";
import { createMinimumValueValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createConfigOption, createPathOption, createVerboseOption } from "../cli-core/shared-command-options.js";
import * as AgentPack from "../modules/auto-game-agent-pack/index.js";
import {
    type AutoGameProjectSkill,
    discoverAutoGameProjectSkills,
    setAutoGameProjectSkillEnabled
} from "../modules/auto-game-skills/index.js";
import {
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_LIVE_RELOAD_STATUS_HOST,
    DEFAULT_LIVE_RELOAD_STATUS_PORT,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT
} from "../modules/live-reload/config.js";
import { manageLiveReloadSession } from "../modules/live-reload/session-controller.js";
import {
    discoverLiveReloadSessionByPath,
    type LiveReloadRegisteredSession
} from "../modules/live-reload/session-registry.js";
import { createRefactorBridges } from "../modules/refactor/bridge-factory.js";
import { readProjectOperationState } from "../modules/runtime/project-operation-state.js";
import { runSemanticIndexOperation } from "../modules/runtime/semantic-index-operation.js";
import {
    type GraphVisualizationServerPlaygroundFixture,
    openUrlInDefaultBrowser,
    startGraphVisualizationServer
} from "../modules/server/graph-visualization-server.js";
import { createGmlParserAdapter, createGmlTranspilerAdapter } from "../modules/transpilation/adapters.js";
import {
    createDefaultGmloopProjectConfig,
    createGraphVisualizationProjectConfigurationCatalog
} from "../modules/ui/index.js";
import { findRepoRootSync } from "../shared/repo-root.js";
import { validateGameMakerProjectFilePath } from "../workflow/project-file-validation.js";
import {
    discoverProjectRoot,
    readGameMakerCliActiveProjectStateProjectPath,
    resolveExplicitWorkflowTargetPath,
    resolveGameMakerCliActiveProjectStatePath,
    writeGameMakerCliActiveProjectState
} from "../workflow/project-root.js";

type GraphCommandSharedOptions = {
    config?: string;
    databasePath?: string;
    depth?: number;
    force?: boolean;
    json?: boolean;
    limit?: number;
    path?: string;
    toolsetRoot?: string;
    verbose?: boolean;
    open?: boolean;
    output?: string;
    serve?: boolean;
    liveReload?: boolean;
    projectState?: string;
    vacuum?: boolean;
};

type GraphResolutionContext = Readonly<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}>;

type GraphJsonEnvelope<TPayload> = Readonly<{
    command: string;
    databasePath: string;
    ok: true;
    payload: TPayload;
    projectRoot: string;
    toolsetRoot: string | null;
}>;

type GraphVisualizationExportResult = Readonly<{
    entryHtmlPath: string;
    outputDirectory: string;
}>;

type GraphVisualizationProjectWorkflow = (typeof UI.PROJECT_WORKFLOWS)[number];
const SEMANTIC_INDEX_OPERATION_KIND = "semantic-index";

function createAutoGamePipelineModel(
    skills: ReadonlyArray<AutoGameProjectSkill>,
    agentPackStatus: AgentPack.AgentPackProjectStatus,
    resources: ReadonlyArray<AgentPack.AgentPackResourcePreview>
) {
    return Object.freeze({
        actions: Object.freeze([]),
        agentPack: Object.freeze({ ...agentPackStatus, resources }),
        events: Object.freeze([]),
        llmOutputs: Object.freeze([]),
        skills: Object.freeze(skills.map((skill) => Object.freeze({ ...skill, id: skill.name }))),
        status: "idle",
        statusText:
            skills.length === 0
                ? "No project-scoped Auto-Game skills are installed."
                : `${String(skills.filter((skill) => skill.enabled).length)} of ${String(skills.length)} project skills included in Auto-Game.`
    });
}

type AutoGamePipelineModel = ReturnType<typeof createAutoGamePipelineModel>;

async function createAutoGamePipelineModelForProject(context: GraphResolutionContext): Promise<AutoGamePipelineModel> {
    const [skills, agentPackStatus, resources] = await Promise.all([
        discoverAutoGameProjectSkills(context.projectRoot, context.projectConfig),
        AgentPack.readAgentPackProjectStatus(context.projectRoot),
        AgentPack.readAgentPackResourcePreviews()
    ]);
    return createAutoGamePipelineModel(skills, agentPackStatus, resources);
}

async function runGraphVisualizationProjectWorkflow(
    context: GraphResolutionContext,
    configPath: string | undefined,
    workflow: GraphVisualizationProjectWorkflow,
    onLogLine: ((logLine: string) => void) | null = null,
    onProcessStart: ((childProcess: ChildProcessWithoutNullStreams) => void) | null = null
): Promise<Readonly<{ logLines: ReadonlyArray<string> }>> {
    const cliEntryPath = fileURLToPath(new URL("../../index.js", import.meta.url));
    const args = ["--disable-warning=ExperimentalWarning"];
    if (workflow === "refactor") {
        args.push("--max-old-space-size=16384");
    }
    args.push(cliEntryPath, ...createGraphVisualizationWorkflowArguments(workflow, context.projectRoot));
    if (configPath) {
        args.push("--config", configPath);
    }

    const logLines = new Array<string>();
    const appendLogLine = (logLine: string): void => {
        if (logLine.trim().length === 0) {
            return;
        }
        const normalizedLogLine = logLine.trimEnd();
        logLines.push(normalizedLogLine);
        onLogLine?.(normalizedLogLine);
    };

    const childProcess = spawn(process.execPath, args, {
        cwd: context.projectRoot,
        stdio: ["ignore", "pipe", "pipe"]
    });
    onProcessStart?.(childProcess);

    const stdoutPromise = streamProcessOutputByLine(childProcess.stdout, appendLogLine);
    const stderrPromise = streamProcessOutputByLine(childProcess.stderr, appendLogLine);

    const exitCode = await awaitChildProcessExitCode(childProcess);
    await Promise.all([stdoutPromise, stderrPromise]);

    if (exitCode !== 0) {
        throw new Error(
            logLines.length > 0
                ? logLines.join("\n")
                : `Fix workflow process exited with code ${exitCode === null ? "unknown" : String(exitCode)}.`
        );
    }

    return Object.freeze({ logLines: Object.freeze([...logLines]) });
}

function createGraphVisualizationWorkflowArguments(
    workflow: GraphVisualizationProjectWorkflow,
    projectRoot: string
): ReadonlyArray<string> {
    switch (workflow) {
        case "fix": {
            return ["fix", "--write", "--path", projectRoot];
        }
        case "format": {
            return ["format", "--write", "--path", projectRoot, "--on-parse-error", "skip"];
        }
        case "lint": {
            return ["lint", projectRoot, "--write", "--path", projectRoot, "--project-strict"];
        }
        case "refactor": {
            return ["refactor", "codemod", projectRoot, "--write", "--path", projectRoot];
        }
    }
}

function isSemanticIndexBuildActiveForProject(projectRoot: string): boolean {
    const activeOperation = readProjectOperationState(projectRoot).active;
    return (
        activeOperation !== null &&
        activeOperation.status === "running" &&
        (activeOperation.kind === SEMANTIC_INDEX_OPERATION_KIND ||
            activeOperation.phase === SEMANTIC_INDEX_OPERATION_KIND ||
            activeOperation.semanticIndex !== null)
    );
}

async function runGraphIndexBuildInChildProcess(
    options: GraphCommandSharedOptions,
    projectRoot: string,
    force: boolean
): Promise<void> {
    const cliEntryPath = fileURLToPath(new URL("../../index.js", import.meta.url));
    const args = ["--disable-warning=ExperimentalWarning", cliEntryPath, "graph", "index", "--path", projectRoot];
    if (force) {
        args.push("--force");
    }
    if (options.config) {
        args.push("--config", options.config);
    }
    if (options.databasePath) {
        args.push("--database-path", options.databasePath);
    }
    if (options.toolsetRoot) {
        args.push("--toolset-root", options.toolsetRoot);
    }

    const logLines = new Array<string>();
    const appendLogLine = (logLine: string): void => {
        if (logLine.trim().length > 0) {
            logLines.push(logLine.trimEnd());
        }
    };

    // The target project is passed explicitly via --path, so the child
    // inherits this process's working directory instead of depending on the
    // project root being usable as a cwd.
    const childProcess = spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutPromise = streamProcessOutputByLine(childProcess.stdout, appendLogLine);
    const stderrPromise = streamProcessOutputByLine(childProcess.stderr, appendLogLine);
    const exitCode = await awaitChildProcessExitCode(childProcess);
    await Promise.all([stdoutPromise, stderrPromise]);

    if (exitCode !== 0) {
        throw new Error(
            logLines.length > 0
                ? logLines.join("\n")
                : `Graph index process exited with code ${exitCode === null ? "unknown" : String(exitCode)}.`
        );
    }
}

/**
 * Build the graph index for the serve UI without blocking its event loop.
 *
 * The synchronous SQLite persistence inside an in-process build starves the
 * visualization server on large projects, so serve mode delegates the build to
 * a `graph index` child process. Progress flows back through the shared
 * project operation-state file, which the serve progress endpoint already
 * polls. When another process owns the semantic build, this attaches to that
 * build's shared progress instead of starting duplicate analysis.
 */
async function ensureGraphIndexForServe(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext,
    force: boolean
): Promise<void> {
    if (isSemanticIndexBuildActiveForProject(context.projectRoot)) {
        return;
    }

    try {
        await runGraphIndexBuildInChildProcess(options, context.projectRoot, force);
    } catch (error: unknown) {
        if (isSemanticIndexBuildActiveForProject(context.projectRoot)) {
            return;
        }
        throw error;
    }
}

/**
 * Stream child-process output incrementally and invoke a callback for each completed line.
 * Removes all registered listeners on the stream before resolving so the stream
 * is fully dissociated from this promise chain regardless of how it settles.
 *
 * @param stream - Child-process stdout/stderr stream.
 * @param onLogLine - Callback invoked with each parsed line.
 */
function streamProcessOutputByLine(stream: NodeJS.ReadableStream, onLogLine: (logLine: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        let bufferedText = "";
        stream.setEncoding("utf8");

        const handleData = (chunk: string): void => {
            bufferedText += chunk;
            let nextLineBreakIndex = bufferedText.search(/\r?\n/u);
            while (nextLineBreakIndex >= 0) {
                const completeLine = bufferedText.slice(0, nextLineBreakIndex);
                if (completeLine.length > 0) {
                    onLogLine(completeLine);
                }
                const lineBreakLength = bufferedText[nextLineBreakIndex] === "\r" ? 2 : 1;
                bufferedText = bufferedText.slice(nextLineBreakIndex + lineBreakLength);
                nextLineBreakIndex = bufferedText.search(/\r?\n/u);
            }
        };

        const handleError = (error: unknown): void => {
            stream.removeListener("data", handleData);
            stream.removeListener("error", handleError);
            stream.removeListener("end", handleEnd);
            const message = Core.getErrorMessage(error, { fallback: "Unknown stream error" });
            reject(new Error(message));
        };

        const handleEnd = (): void => {
            stream.removeListener("data", handleData);
            stream.removeListener("error", handleError);
            stream.removeListener("end", handleEnd);
            if (bufferedText.length > 0) {
                onLogLine(bufferedText);
            }
            resolve();
        };

        stream.on("data", handleData);
        stream.on("error", handleError);
        stream.on("end", handleEnd);
    });
}

/**
 * Await a child process close event and return its exit code.
 *
 * @param childProcess - Child process to observe.
 */
function awaitChildProcessExitCode(childProcess: ChildProcessWithoutNullStreams): Promise<number | null> {
    return new Promise((resolve, reject) => {
        childProcess.once("error", reject);
        childProcess.once("close", (code) => {
            resolve(code);
        });
    });
}

type GraphVisualizationBundleFile = Readonly<{
    bytes: Uint8Array;
    contentType: string;
    relativePath: string;
}>;

type GraphVisualizationBundleArtifact = Readonly<{
    entryHtmlPath: string;
    files: ReadonlyArray<GraphVisualizationBundleFile>;
}>;

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

type OsaScriptExecutionResult = Readonly<{
    stderr: string;
    stdout: string;
}>;

const DEMO_PROJECT_DIRECTORY = path.join("vendor", "3DSpider");
const DEMO_PROJECT_MANIFEST = "3D-ish spider thing 2.yyp";
const GRAPH_VISUALIZATION_LIVE_RELOAD_POLL_INTERVAL_MS = 2000;

function createEmptyGraphVisualizationData(): GraphVisualizationServePayload {
    return Object.freeze({
        edges: [],
        generatedAt: new Date().toISOString(),
        graphs: [],
        nodes: [],
        projectRoot: ""
    });
}

function createGraphVisualizationServeLoadingState(
    message: string,
    detail: string | null
): GraphVisualizationServeBackgroundState {
    return Object.freeze({
        detail,
        message,
        phase: "loading"
    });
}

function createGraphVisualizationServeErrorState(
    message: string,
    detail: string | null
): GraphVisualizationServeBackgroundState {
    return Object.freeze({
        detail,
        message,
        phase: "error"
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

function startGraphVisualizationUiSourceWatcher({
    watchRoot,
    onReloadCandidate,
    onError,
    watchFactory = watch
}: Readonly<{
    watchRoot: string;
    onReloadCandidate: (fileName: string | Buffer | null) => void;
    onError: (error: unknown) => void;
    watchFactory?: GraphVisualizationUiSourceWatchFactory;
}>): FSWatcher {
    const watcher = watchFactory(watchRoot, { recursive: true }, (_eventType, fileName) => {
        onReloadCandidate(fileName);
    });

    watcher.on("error", (error) => {
        onError(error);
        watcher.close();
    });

    return watcher;
}

export interface GraphVisualizationFeatherMetadataWatcher {
    close: () => void;
}

export type GraphVisualizationFeatherMetadataWatchFactory = (
    path: string,
    listener?: WatchListener<string>
) => FSWatcher;

function startGraphVisualizationFeatherMetadataWatcher({
    featherMetadataPath,
    onChanged,
    onError,
    watchFactory = watch,
    readFileFn = readFile
}: Readonly<{
    featherMetadataPath: string;
    onChanged: () => void | Promise<void>;
    onError: (error: unknown) => void;
    watchFactory?: GraphVisualizationFeatherMetadataWatchFactory;
    readFileFn?: (path: string, options: "utf8") => Promise<string>;
}>): GraphVisualizationFeatherMetadataWatcher {
    let watcher: FSWatcher | null = null;
    let stopped = false;
    let lastFeatherMetadataHash = "";

    void (async () => {
        if (stopped) {
            return;
        }
        try {
            const content = await readFileFn(featherMetadataPath, "utf8");
            lastFeatherMetadataHash = createHash("sha256").update(content).digest("hex");
        } catch {
            // Ignore initial read error
        }

        if (stopped) {
            return;
        }

        try {
            watcher = watchFactory(featherMetadataPath, (eventType) => {
                if (eventType === "change" && !stopped) {
                    void (async () => {
                        try {
                            const content = await readFileFn(featherMetadataPath, "utf8");
                            const currentHash = createHash("sha256").update(content).digest("hex");
                            if (currentHash === lastFeatherMetadataHash) {
                                return;
                            }
                            lastFeatherMetadataHash = currentHash;
                            if (!stopped) {
                                await onChanged();
                            }
                        } catch (error) {
                            onError(error);
                        }
                    })();
                }
            });
            watcher.on("error", (error) => {
                onError(error);
            });
        } catch (error) {
            onError(error);
        }
    })();

    return {
        close: () => {
            stopped = true;
            if (watcher) {
                watcher.close();
                watcher = null;
            }
        }
    };
}

function startGraphVisualizationActiveProjectStateWatcher({
    env,
    intervalMs = 500,
    onError,
    onProjectPathChanged,
    statePathOption
}: Readonly<{
    env: NodeJS.ProcessEnv;
    intervalMs?: number;
    onError: (error: unknown) => void;
    onProjectPathChanged: (projectPath: string) => Promise<void> | void;
    statePathOption?: string;
}>): GraphVisualizationActiveProjectStateWatcher {
    const statePath = resolveGameMakerCliActiveProjectStatePath({ env, statePathOption });
    let stopped = false;
    let observedProjectPath: string | null = null;
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const scheduleNextPoll = (): void => {
        if (stopped) {
            return;
        }

        pollTimer = globalThis.setTimeout(() => {
            pollTimer = null;
            void pollActiveProjectState();
        }, intervalMs);
    };

    const pollActiveProjectState = async (): Promise<void> => {
        if (stopped) {
            return;
        }

        try {
            const projectPath = await readGameMakerCliActiveProjectStateProjectPath({ statePath });
            if (projectPath === null || projectPath === observedProjectPath) {
                observedProjectPath = projectPath;
                return;
            }

            observedProjectPath = projectPath;
            await onProjectPathChanged(projectPath);
        } catch (error) {
            onError(error);
        } finally {
            scheduleNextPoll();
        }
    };

    void pollActiveProjectState();

    return Object.freeze({
        stop: () => {
            stopped = true;
            if (pollTimer !== null) {
                globalThis.clearTimeout(pollTimer);
                pollTimer = null;
            }
        }
    });
}

function resetGraphVisualizationLiveReloadSession(sessionState: GraphVisualizationLiveReloadSessionState): void {
    sessionState.generation += 1;
    sessionState.model = null;
    sessionState.ownedSession = null;
    sessionState.session = null;
    sessionState.startupPromise = null;
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

function createMutableGraphPlaygroundLintConfig(
    enabledRuleIds: ReadonlyArray<string>,
    fixtureConfig: Record<string, unknown> | null = null
): Array<Record<string, unknown>> {
    const enabledRules = new Set(enabledRuleIds);
    const enforceRuleFilter = enabledRules.size > 0;
    const fixtureRuleEntries = fixtureConfig
        ? Lint.configs.createLintRuleEntriesFromProjectConfig(fixtureConfig)
        : null;

    return Lint.configs.recommended.map((config) => {
        const nextConfig = {
            ...config,
            files: Array.isArray(config.files) ? [...config.files] : config.files,
            plugins: config.plugins ? { ...config.plugins } : undefined,
            rules: config.rules ? { ...config.rules } : undefined
        };

        const rules = nextConfig.rules as Record<string, unknown> | undefined;
        if (rules && typeof rules === "object") {
            if (fixtureRuleEntries) {
                for (const [ruleId, ruleEntry] of Object.entries(fixtureRuleEntries)) {
                    if (rules[ruleId] !== undefined) {
                        rules[ruleId] = ruleEntry;
                    }
                }
            }

            if (enforceRuleFilter) {
                for (const ruleId of Object.keys(rules)) {
                    if (!enabledRules.has(ruleId)) {
                        rules[ruleId] = "off";
                    }
                }
            }
        }

        return nextConfig;
    });
}

function createGraphPlaygroundFormatOptions(
    selectedOptionNames: ReadonlyArray<string>,
    activeProjectConfig: Record<string, unknown> | null
): Record<string, unknown> {
    const configuredFormatOptions = Format.extractProjectFormatOptions(activeProjectConfig ?? {});
    const selectedOptionNameSet = new Set(selectedOptionNames);
    if (selectedOptionNameSet.size === 0) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(configuredFormatOptions).filter(([optionName]) => selectedOptionNameSet.has(optionName))
    );
}

function createRefactorEngineForPlayground(activeProjectRoot: string) {
    const bridges = createRefactorBridges({}, activeProjectRoot);
    return Refactor.createRefactorEngine({
        formatter: bridges.formatter,
        parser: bridges.parser,
        semantic: bridges.semantic
    });
}

async function applySelectedPlaygroundCodemods(
    sourceText: string,
    selectedCodemodIds: ReadonlyArray<string>,
    activeProjectRoot: string,
    activeProjectConfig: Record<string, unknown> | null
): Promise<string> {
    if (selectedCodemodIds.length === 0) {
        return sourceText;
    }

    const registeredCodemodIds = new Set(Refactor.listRegisteredCodemods().map((codemod) => codemod.id));
    const onlyCodemods = selectedCodemodIds.filter((codemodId): codemodId is RefactorCodemodId =>
        registeredCodemodIds.has(codemodId as RefactorCodemodId)
    );
    if (onlyCodemods.length === 0) {
        return sourceText;
    }

    const normalizedRefactorConfig = Refactor.normalizeRefactorProjectConfig(activeProjectConfig?.refactor);
    const rawCodemodConfig: Record<string, unknown> = { ...normalizedRefactorConfig.codemods };
    for (const codemodId of onlyCodemods) {
        if (rawCodemodConfig[codemodId] !== undefined) {
            continue;
        }
        rawCodemodConfig[codemodId] = codemodId === "namingConvention" ? { rules: {} } : {};
    }
    const config = Refactor.normalizeRefactorProjectConfig({ codemods: rawCodemodConfig });

    const engine = createRefactorEngineForPlayground(activeProjectRoot);
    const virtualFilePath = "graph-visualization-playground.gml";
    const nextOutput = sourceText;
    const result = await engine.executeConfiguredCodemods({
        config,
        dryRun: true,
        gmlFilePaths: [virtualFilePath],
        onlyCodemods,
        projectRoot: activeProjectRoot,
        readFile: () => nextOutput,
        targetPaths: [virtualFilePath]
    });

    const updatedOutput = result.appliedFiles.get(virtualFilePath);
    return updatedOutput ?? nextOutput;
}

function isMacOsDialogCancellationError(error: unknown, stderr: string): boolean {
    if (!Core.isErrorLike(error)) {
        return false;
    }

    return error.message.includes("User canceled") || stderr.includes("User canceled");
}

function readOsaScriptErrorStderr(error: unknown): string {
    if (typeof error !== "object" || error === null || !("stderr" in error)) {
        return "";
    }

    const stderrCandidate = Reflect.get(error, "stderr");
    return typeof stderrCandidate === "string" ? stderrCandidate : "";
}

function runOsaScript(lines: ReadonlyArray<string>): Promise<OsaScriptExecutionResult> {
    return new Promise<OsaScriptExecutionResult>((resolve, reject) => {
        const args = lines.flatMap((line) => ["-e", line] as const);
        execFile("osascript", args, { encoding: "utf8" }, (error, stdout, stderr) => {
            if (error) {
                reject(Core.isErrorLike(error) ? error : new Error("osascript execution failed."));
                return;
            }
            resolve(
                Object.freeze({
                    stderr,
                    stdout
                })
            );
        });
    });
}

async function runUiWorkspaceTypeBuildForServe(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        execFile("pnpm", ["--filter", "@gmloop/ui", "run", "build:types"], (error) => {
            if (error) {
                reject(Core.isErrorLike(error) ? error : new Error("Failed to build @gmloop/ui workspace."));
                return;
            }
            resolve();
        });
    });
}

function isGraphVisualizationUiSourceReloadCandidate(fileName: string | null): boolean {
    return fileName !== null && (fileName.endsWith(".ts") || fileName.endsWith(".css") || fileName.endsWith(".html"));
}

function normalizeGraphVisualizationUiSourceWatchFileName(fileName: string | Buffer | null): string | null {
    if (fileName === null) {
        return null;
    }

    return typeof fileName === "string" ? fileName : fileName.toString("utf8");
}

function resolveGraphVisualizationUiSourceWatchRoot(): string | null {
    const repoRoot = findRepoRootSync(path.dirname(fileURLToPath(import.meta.url)));
    const sourceRoot = path.resolve(repoRoot, "src/ui/src");
    if (!existsSync(sourceRoot)) {
        return null;
    }

    return sourceRoot;
}

function resolveDefaultGraphVisualizationServeTargetPath(startDirectory: string = process.cwd()): string | null {
    try {
        const repoRoot = findRepoRootSync(startDirectory);
        const demoProjectRoot = path.join(repoRoot, DEMO_PROJECT_DIRECTORY);
        const demoProjectManifest = path.join(demoProjectRoot, DEMO_PROJECT_MANIFEST);
        return existsSync(demoProjectManifest) ? demoProjectRoot : null;
    } catch {
        return null;
    }
}

async function resolveGraphVisualizationServeStartupState(
    options: GraphCommandSharedOptions,
    initialSelectedPath: string | null,
    onTargetResolved: (target: Readonly<{ selectedPaths: ReadonlyArray<string>; source: GraphServeSource }>) => void
): Promise<GraphVisualizationStartupState> {
    if (initialSelectedPath !== null) {
        const context = await resolveGraphContext(options);
        const target = { selectedPaths: [initialSelectedPath], source: "cli-path" as const };
        onTargetResolved(target);
        await ensureGraphIndexForServe(options, context, false);
        return { context, ...target };
    }

    try {
        const statePath = resolveGameMakerCliActiveProjectStatePath({
            env: process.env,
            statePathOption: options.projectState
        });
        const activeProjectPath = await readGameMakerCliActiveProjectStateProjectPath({ statePath });
        if (activeProjectPath !== null) {
            const nextOptions = {
                ...options,
                path: activeProjectPath
            };
            const context = await resolveGraphContext(nextOptions);
            const target = { selectedPaths: [activeProjectPath], source: "active-project-state" as const };
            onTargetResolved(target);
            await ensureGraphIndexForServe(nextOptions, context, false);
            return { context, ...target };
        }
    } catch {
        // Ignore state path load failures and continue with normal discovery.
    }

    try {
        const context = await resolveGraphContext(options);
        const target = { selectedPaths: [context.projectRoot], source: "working-directory" as const };
        onTargetResolved(target);
        await ensureGraphIndexForServe(options, context, false);
        return { context, ...target };
    } catch {
        const defaultServeTargetPath = resolveDefaultGraphVisualizationServeTargetPath();
        if (defaultServeTargetPath === null) {
            const target = { selectedPaths: [], source: "working-directory" as const };
            onTargetResolved(target);
            return { context: null, ...target };
        }

        const nextOptions = {
            ...options,
            path: defaultServeTargetPath
        };
        const context = await resolveGraphContext(nextOptions);
        const target = { selectedPaths: [defaultServeTargetPath], source: "demo-project" as const };
        onTargetResolved(target);
        await ensureGraphIndexForServe(nextOptions, context, false);
        return { context, ...target };
    }
}

async function pickProjectPathUsingNativeDialog(): Promise<string | null> {
    if (process.platform !== "darwin") {
        return null;
    }

    const scriptLines = [
        'return POSIX path of (choose file with prompt "Choose a GameMaker .yyp project file:" of type {"yyp"})'
    ];

    try {
        const result = await runOsaScript(scriptLines);
        return result.stdout.trim();
    } catch (error: unknown) {
        if (Core.isErrorLike(error)) {
            const stderr = readOsaScriptErrorStderr(error);
            if (isMacOsDialogCancellationError(error, stderr)) {
                return null;
            }
        }
        throw error;
    }
}

async function loadOptionalProjectConfig(
    projectRoot: string,
    configPathOption: string | undefined
): Promise<Record<string, unknown>> {
    const candidatePath = configPathOption ? path.resolve(configPathOption) : path.join(projectRoot, "gmloop.json");

    try {
        await access(candidatePath, constants.R_OK);
    } catch {
        return {};
    }

    const loadedConfig = await Core.loadGmloopProjectConfig(candidatePath);
    return Core.isObjectLike(loadedConfig) ? loadedConfig : {};
}

async function resolveGraphContext(options: GraphCommandSharedOptions): Promise<GraphResolutionContext> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path,
        statePathOption: options.projectState
    });

    return Object.freeze({
        projectConfig: await loadOptionalProjectConfig(projectRoot, options.config),
        projectRoot
    });
}

function printGraphOutput(payload: unknown, asJson: boolean, humanText: string): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }

    console.log(humanText);
}

function ensureGraphIndex(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<Awaited<ReturnType<typeof Semantic.buildGraphIndex>>> {
    return runSemanticIndexOperation(context.projectRoot, (onProgress) =>
        Semantic.buildGraphIndex({
            databasePath: options.databasePath,
            onProgress,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            rebuild: options.force === true,
            toolsetRoot: options.toolsetRoot
        })
    );
}

async function ensureGraphIndexForQuery(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<void> {
    // Graph tables are a projection of the canonical semantic store. Reconcile
    // the projection on every query so visualization, search, and LSP facts
    // always share the same persisted project snapshot. The semantic builder
    // restores from SQLite and only parses sources when that snapshot is absent
    // or stale, so this does not reintroduce a second source-of-truth scan.
    await ensureGraphIndex(options, context);
}

function createGraphEnvelope<TPayload>(
    command: string,
    context: GraphResolutionContext,
    options: GraphCommandSharedOptions,
    payload: TPayload
): GraphJsonEnvelope<TPayload> {
    const config = Semantic.resolveGraphIndexConfig({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    return Object.freeze({
        command,
        databasePath: config.databasePath,
        ok: true,
        payload,
        projectRoot: config.projectRoot,
        toolsetRoot: config.toolsetRoot
    });
}

async function runGraphIndexAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    const result = await ensureGraphIndex(options, context);
    const payload = {
        databasePath: result.databasePath,
        graphIds: result.graphIds
    };
    printGraphOutput(
        createGraphEnvelope("graph index", context, options, payload),
        options.json === true,
        `Indexed ${result.graphIds.join(", ")} graph(s) at ${result.databasePath}.`
    );
}

async function runGraphSearchAction(queryText: string, options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    await ensureGraphIndexForQuery(options, context);
    const result = Semantic.searchGraphIndex({
        databasePath: options.databasePath,
        limit: options.limit,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        query: queryText,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph search", context, options, result),
        options.json === true,
        `Found ${String(result.results.length)} graph result(s) for "${result.query}".`
    );
}

async function runGraphDoctorAction(options: GraphCommandSharedOptions): Promise<void> {
    const context = await resolveGraphContext(options);
    if (options.vacuum) {
        const result = Semantic.vacuumGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        printGraphOutput(
            createGraphEnvelope("graph doctor", context, options, result),
            options.json === true,
            `Compacted graph database at ${result.databasePath} (${String(result.bloatPercentBefore ?? 0)}% -> ${String(result.bloatPercentAfter ?? 0)}% reclaimable space).`
        );
        return;
    }

    const report = Semantic.doctorGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });
    printGraphOutput(
        createGraphEnvelope("graph doctor", context, options, report),
        options.json === true,
        report.issues.length === 0
            ? `Graph index is healthy at ${report.databasePath}.`
            : `Graph doctor reported ${String(report.issues.length)} issue(s).`
    );
}

type GraphVisualizationStaticExportInput = Readonly<{
    autoGamePipeline: AutoGamePipelineModel | null;
    context: GraphResolutionContext | null;
    loadedTarget: GraphVisualizedLoadedTarget;
    options: GraphCommandSharedOptions;
    payload: GraphVisualizationServePayload;
    projectConfigurationCatalog: Awaited<ReturnType<typeof createGraphVisualizationProjectConfigurationCatalog>>;
}>;

/**
 * Render a one-shot `graph visualize` export bundle and write it to disk.
 *
 * Single responsibility: given a resolved project context, the active
 * visualization payload, the project configuration catalog, and the
 * user-supplied options, render the static HTML+assets bundle to the requested
 * output directory and report the result.
 *
 * This is the static-export counterpart to the inner `runServeVisualizationMode`
 * helper inside {@link runGraphVisualizeAction}. It is intentionally
 * serve-mode-free: it does not consult live-reload sessions, serve-revision
 * counters, bundle caches, or fix-workflow state. By keeping those concerns
 * separate, the outer action can dispatch to the right helper without
 * tangling mode-specific state.
 */
async function runGraphVisualizationStaticExportMode(input: GraphVisualizationStaticExportInput): Promise<void> {
    if (input.context === null) {
        throw new Error("Could not locate a GameMaker project root. Pass --path or run inside a project tree.");
    }

    const activeConfig = Semantic.resolveGraphIndexConfig({
        databasePath: input.options.databasePath,
        projectConfig: input.context.projectConfig,
        projectRoot: input.context.projectRoot,
        toolsetRoot: input.options.toolsetRoot
    });

    const documentationCatalogs = createDocumentationCatalogs();
    const dbPath = activeConfig.databasePath;
    const bundleArtifact = await UI.renderGraphVisualizationBundle(input.payload, {
        autoGamePipeline: input.autoGamePipeline ?? undefined,
        documentationCatalogs,
        loadedTarget: input.loadedTarget,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: input.projectConfigurationCatalog,
        title: activeConfig.projectRoot
    });
    const outputDirectory = input.options.output ?? path.join(path.dirname(dbPath), "graph-visualization");
    const exportResult = await writeGraphVisualizationBundleArtifact(bundleArtifact, outputDirectory);

    printGraphOutput(
        createGraphEnvelope("graph visualize", input.context, input.options, exportResult),
        input.options.json === true,
        `Exported graph visualization bundle to ${path.join(outputDirectory, exportResult.entryHtmlPath)}`
    );

    if (input.options.open) {
        openUrlInDefaultBrowser(path.join(outputDirectory, exportResult.entryHtmlPath));
    }
}

async function runGraphVisualizeAction(options: GraphCommandSharedOptions): Promise<void> {
    const initialSelectedPath = resolveExplicitWorkflowTargetPath(options.path);
    let activeContext: GraphResolutionContext | null = null;
    const updateActiveContext = (context: GraphResolutionContext | null): void => {
        activeContext = context;
    };
    let activeSelectedPaths = initialSelectedPath ? [initialSelectedPath] : [];
    let activeSource: GraphServeSource = options.path ? "cli-path" : "working-directory";
    let activeVisualizationPayload = createEmptyGraphVisualizationData();
    let activeProjectConfigurationCatalog: Awaited<
        ReturnType<typeof createGraphVisualizationProjectConfigurationCatalog>
    > | null = null;
    let activeAutoGamePipeline: AutoGamePipelineModel | null = null;
    let activeStartupState: GraphVisualizationServeBackgroundState | null =
        options.serve === true ? createGraphVisualizationServeLoadingState("Loading project data…", null) : null;
    let activeServeStartupGeneration = 0;
    let activeServeRevision = 0;
    let activeServeBundleCache: GraphVisualizationServeBundleCache | null = null;
    let activeLastFixRun: Readonly<{ logLines: ReadonlyArray<string>; projectRoot: string; status: "success" }> | null =
        null;
    let activeFixProgressLogLines = new Array<string>();
    let isFixWorkflowRunning = false;
    let activeFixWorkflow: GraphVisualizationProjectWorkflow | null = null;
    let activeFixChildProcess: ChildProcessWithoutNullStreams | null = null;
    let isFixCancelRequested = false;
    const activeLiveReloadSession = createGraphVisualizationLiveReloadSessionState();

    if (options.serve !== true) {
        activeContext = await resolveGraphContext(options);
        await ensureGraphIndexForQuery(options, activeContext);
        activeSelectedPaths = [initialSelectedPath ?? activeContext.projectRoot];
        activeVisualizationPayload = readVisualizationPayloadFromContext(activeContext);
        activeProjectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(activeContext, {
            config: options.config
        });
        activeAutoGamePipeline = await createAutoGamePipelineModelForProject(activeContext);
    }

    function resolveActiveConfig() {
        if (!activeContext) {
            return null;
        }

        return Semantic.resolveGraphIndexConfig({
            databasePath: options.databasePath,
            projectConfig: activeContext.projectConfig,
            projectRoot: activeContext.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
    }

    function markServeRevisionChanged(): void {
        activeServeRevision += 1;
        activeServeBundleCache = null;
    }

    function cacheServeBundleForRevision(revision: number, bundle: GraphVisualizationServeBundleCache["bundle"]): void {
        if (activeServeRevision !== revision) {
            return;
        }

        activeServeBundleCache = Object.freeze({
            bundle,
            revision
        });
    }

    function readVisualizationPayloadFromContext(context: GraphResolutionContext) {
        const activeConfig = Semantic.resolveGraphIndexConfig({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        try {
            const database = Semantic.openExistingGraphIndexDatabase(activeConfig.databasePath);
            try {
                return Semantic.exportGraphVisualizationData(database, activeConfig.projectRoot);
            } finally {
                database.close();
            }
        } catch (error: unknown) {
            const activeOperation = readProjectOperationState(context.projectRoot).active;
            if (activeOperation?.phase !== SEMANTIC_INDEX_OPERATION_KIND) {
                throw error;
            }
            return createEmptyGraphVisualizationData();
        }
    }

    async function refreshActiveVisualizationArtifacts(
        context: GraphResolutionContext | null,
        isCurrent: () => boolean = () => true
    ): Promise<void> {
        if (context === null) {
            const projectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(null, {
                config: options.config
            });
            const [availableVersion, resources] = await Promise.all([
                AgentPack.readAgentPackVersion(),
                AgentPack.readAgentPackResourcePreviews()
            ]);
            if (!isCurrent()) {
                return;
            }
            const autoGamePipeline = createAutoGamePipelineModel(
                [],
                {
                    agentConfigs: Object.freeze([]),
                    availableVersion,
                    conflicts: Object.freeze([]),
                    installedVersion: null,
                    status: "not-installed"
                },
                resources
            );
            activeVisualizationPayload = createEmptyGraphVisualizationData();
            activeProjectConfigurationCatalog = projectConfigurationCatalog;
            activeAutoGamePipeline = autoGamePipeline;
            return;
        }

        const visualizationPayload = readVisualizationPayloadFromContext(context);
        const projectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(context, {
            config: options.config
        });
        if (!isCurrent()) {
            return;
        }
        const autoGamePipeline = await createAutoGamePipelineModelForProject(context);
        if (!isCurrent()) {
            return;
        }
        activeVisualizationPayload = visualizationPayload;
        activeProjectConfigurationCatalog = projectConfigurationCatalog;
        activeAutoGamePipeline = autoGamePipeline;
    }

    function createLoadedTarget(): GraphVisualizedLoadedTarget {
        const resolvedSelectedPaths = activeSelectedPaths.map(
            (selectedPathValue) => resolveExplicitWorkflowTargetPath(selectedPathValue) ?? selectedPathValue
        );
        const activePath = resolvedSelectedPaths[0] ?? "";
        const projectRoot = activeContext?.projectRoot ?? resolvedSelectedPaths[0] ?? "";

        return Object.freeze({
            activePath,
            projectRoot,
            selectedPaths: resolvedSelectedPaths,
            source: activeSource
        });
    }

    function exportVisualizationPayload() {
        return activeVisualizationPayload;
    }

    function safeStringifyVisualizationPayload(): string {
        try {
            return JSON.stringify(exportVisualizationPayload());
        } catch {
            return "";
        }
    }

    function resetActiveProjectScopedServeState(): void {
        activeLastFixRun = null;
    }

    async function ensureLiveReloadSessionStarted(
        input: Readonly<{ restart: boolean }>
    ): Promise<GraphVisualizationLiveReloadModel> {
        const startupContext = activeContext;
        if (startupContext === null) {
            throw new Error("Open a project before starting live reload.");
        }

        return await ensureGraphVisualizationLiveReloadSession(activeLiveReloadSession, {
            projectConfig: startupContext.projectConfig,
            projectRoot: startupContext.projectRoot,
            restart: input.restart
        });
    }

    async function runServeVisualizationMode(): Promise<void> {
        const renderServeBundle = async (isServerMode: boolean) => {
            Core.clearFeatherMetadataCache();

            const renderRevision = activeServeRevision;
            if (isServerMode && activeServeBundleCache?.revision === renderRevision) {
                return activeServeBundleCache.bundle;
            }

            const freshDocumentationCatalogs = createDocumentationCatalogs();

            const bundle = await UI.renderGraphVisualizationBundle(exportVisualizationPayload(), {
                autoGamePipeline: activeAutoGamePipeline ?? undefined,
                documentationCatalogs: freshDocumentationCatalogs,
                isServerMode,
                lastFixRun: activeLastFixRun ?? undefined,
                liveReload: activeLiveReloadSession.model ?? undefined,
                loadedTarget: activeSelectedPaths.length > 0 || activeContext ? createLoadedTarget() : undefined,
                mcpServerStatus: "not-started",
                projectConfigurationCatalog: activeProjectConfigurationCatalog ?? undefined,
                startupState: activeStartupState ?? undefined,
                title: activeContext?.projectRoot ?? "No project loaded"
            });

            if (isServerMode) {
                cacheServeBundleForRevision(renderRevision, bundle);
            }

            return bundle;
        };

        const repoRoot = findRepoRootSync(path.dirname(fileURLToPath(import.meta.url)));
        const featherMetadataPath = path.resolve(repoRoot, "resources/feather-metadata.json");
        let featherMetadataWatcher: GraphVisualizationFeatherMetadataWatcher | null = null;
        if (existsSync(featherMetadataPath)) {
            featherMetadataWatcher = startGraphVisualizationFeatherMetadataWatcher({
                featherMetadataPath,
                onChanged: async () => {
                    Core.clearFeatherMetadataCache();
                    try {
                        await refreshActiveVisualizationArtifacts(activeContext);
                        markServeRevisionChanged();
                        console.log("[graph visualize] feather-metadata.json changed. Reloading UI...");
                    } catch (error) {
                        console.error(
                            `[graph visualize] Failed to refresh catalog on metadata change: ${Core.getErrorMessage(error)}`
                        );
                    }
                },
                onError: (error) => {
                    console.error(
                        `[graph visualize] Failed to watch feather-metadata.json: ${Core.getErrorMessage(error)}`
                    );
                }
            });
        }
        let uiWatchRebuildInProgress = false;
        let uiWatchRebuildPending = false;

        const runUiBundleRebuildCycle = async (): Promise<void> => {
            uiWatchRebuildPending = false;
            try {
                await runUiWorkspaceTypeBuildForServe();
                UI.clearGraphVisualizationBundleCache();
                markServeRevisionChanged();
                await renderServeBundle(true);
                console.log(`[graph visualize] UI source changed. Reload revision: ${String(activeServeRevision)}`);
            } catch (error) {
                console.error(
                    `[graph visualize] UI rebuild failed: ${Core.getErrorMessage(error, {
                        fallback: "Unknown build failure"
                    })}`
                );
            }

            if (uiWatchRebuildPending) {
                await runUiBundleRebuildCycle();
                return;
            }

            uiWatchRebuildInProgress = false;
        };

        const triggerUiBundleRebuild = (): void => {
            uiWatchRebuildPending = true;
            if (uiWatchRebuildInProgress) {
                return;
            }
            uiWatchRebuildInProgress = true;
            void runUiBundleRebuildCycle();
        };

        let uiWatchDebounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
        const uiSourceWatchRoot = resolveGraphVisualizationUiSourceWatchRoot();
        let uiSourceWatcher: FSWatcher | null = null;
        if (options.liveReload !== false && uiSourceWatchRoot !== null) {
            try {
                uiSourceWatcher = startGraphVisualizationUiSourceWatcher({
                    watchRoot: uiSourceWatchRoot,
                    onReloadCandidate: (fileName) => {
                        const normalizedFileName = normalizeGraphVisualizationUiSourceWatchFileName(fileName);
                        if (!isGraphVisualizationUiSourceReloadCandidate(normalizedFileName)) {
                            return;
                        }
                        if (uiWatchDebounceTimer !== null) {
                            globalThis.clearTimeout(uiWatchDebounceTimer);
                        }
                        uiWatchDebounceTimer = globalThis.setTimeout(() => {
                            triggerUiBundleRebuild();
                        }, 300);
                    },
                    onError: (error) => {
                        if (uiWatchDebounceTimer !== null) {
                            globalThis.clearTimeout(uiWatchDebounceTimer);
                            uiWatchDebounceTimer = null;
                        }
                        console.error(
                            `[graph visualize] UI source watcher disabled: ${Core.getErrorMessage(error, {
                                fallback: "Unknown file-watcher failure"
                            })}`
                        );
                        uiSourceWatcher = null;
                    }
                });
            } catch (error) {
                console.error(
                    `[graph visualize] Failed to start UI source watcher: ${Core.getErrorMessage(error, {
                        fallback: "Unknown file-watcher startup failure"
                    })}`
                );
            }
        }

        const initializeServeStateInBackground = (): void => {
            activeServeStartupGeneration += 1;
            const startupGeneration = activeServeStartupGeneration;
            void (async () => {
                try {
                    const startupState = await resolveGraphVisualizationServeStartupState(
                        options,
                        initialSelectedPath,
                        (target) => {
                            if (startupGeneration !== activeServeStartupGeneration) {
                                return;
                            }
                            // Publish the startup target before the semantic
                            // build so progress endpoints can resolve the
                            // project's shared operation state immediately.
                            activeSelectedPaths = [...target.selectedPaths];
                            activeSource = target.source;
                        }
                    );
                    if (startupGeneration !== activeServeStartupGeneration) {
                        return;
                    }

                    const resolvedContext = startupState.context;
                    activeContext = resolvedContext;
                    activeSelectedPaths = startupState.selectedPaths;
                    activeSource = startupState.source;
                    await refreshActiveVisualizationArtifacts(resolvedContext);
                    if (startupGeneration !== activeServeStartupGeneration) {
                        return;
                    }
                    activeStartupState = null;
                } catch (error) {
                    if (startupGeneration !== activeServeStartupGeneration) {
                        return;
                    }

                    activeContext = null;
                    await refreshActiveVisualizationArtifacts(null);
                    activeStartupState = createGraphVisualizationServeErrorState(
                        "Failed to load the initial project.",
                        Core.getErrorMessage(error, { fallback: "Unknown graph visualization startup error" })
                    );
                    console.error(
                        `[graph visualize] Initial project load failed: ${Core.getErrorMessage(error, {
                            fallback: "Unknown graph visualization startup error"
                        })}`
                    );
                } finally {
                    if (startupGeneration === activeServeStartupGeneration) {
                        markServeRevisionChanged();
                    }
                }
            })();
        };

        const openProjectTargetPath = (
            selectedPath: string,
            source: GraphServeSource
        ): Readonly<{ changed: boolean; projectChanged: boolean }> => {
            activeServeStartupGeneration += 1;
            const startupGeneration = activeServeStartupGeneration;
            const previousPayloadString = safeStringifyVisualizationPayload();
            const resolvedSelectedPath = resolveExplicitWorkflowTargetPath(selectedPath) ?? selectedPath;
            const previousSelectedPath = activeSelectedPaths[0] ?? null;
            const previousProjectRoot = activeContext?.projectRoot ?? null;
            const projectChanged = previousProjectRoot !== resolvedSelectedPath;
            const nextOptions = {
                ...options,
                path: resolvedSelectedPath
            };

            // Publish the selected target and loading state before any semantic
            // work. The next document render can therefore update the open
            // widget immediately while the graph-dependent surfaces stay in a
            // scoped loading state.
            activeContext = null;
            activeSelectedPaths = [resolvedSelectedPath];
            activeSource = source;
            activeVisualizationPayload = createEmptyGraphVisualizationData();
            activeProjectConfigurationCatalog = null;
            activeAutoGamePipeline = null;
            activeStartupState = createGraphVisualizationServeLoadingState("Loading project data…", null);
            if (projectChanged) {
                resetActiveProjectScopedServeState();
            }
            markServeRevisionChanged();

            setImmediate(() => {
                void (async () => {
                    try {
                        if (source !== "active-project-state") {
                            try {
                                await writeGameMakerCliActiveProjectState({
                                    env: process.env,
                                    projectPath: resolvedSelectedPath,
                                    statePathOption: options.projectState
                                });
                            } catch (error) {
                                console.error(
                                    `[graph visualize] Failed to write active project state: ${Core.getErrorMessage(error)}`
                                );
                            }
                        }

                        if (projectChanged) {
                            await stopOwnedGraphVisualizationLiveReloadSession(
                                activeLiveReloadSession,
                                previousProjectRoot
                            );
                        }

                        const nextContext = await resolveGraphContext(nextOptions);
                        if (startupGeneration !== activeServeStartupGeneration) {
                            return;
                        }
                        await ensureGraphIndexForServe(nextOptions, nextContext, false);
                        if (startupGeneration !== activeServeStartupGeneration) {
                            return;
                        }

                        updateActiveContext(nextContext);
                        await refreshActiveVisualizationArtifacts(
                            nextContext,
                            () => startupGeneration === activeServeStartupGeneration
                        );
                        if (startupGeneration !== activeServeStartupGeneration) {
                            return;
                        }
                        activeStartupState = null;
                    } catch (error) {
                        if (startupGeneration !== activeServeStartupGeneration) {
                            return;
                        }

                        activeContext = null;
                        activeVisualizationPayload = createEmptyGraphVisualizationData();
                        activeProjectConfigurationCatalog = null;
                        activeAutoGamePipeline = null;
                        activeStartupState = createGraphVisualizationServeErrorState(
                            "Failed to load the selected project.",
                            Core.getErrorMessage(error, { fallback: "Unknown project loading error" })
                        );
                    } finally {
                        if (startupGeneration === activeServeStartupGeneration) {
                            markServeRevisionChanged();
                        }
                    }
                })();
            });

            return Object.freeze({
                changed:
                    previousPayloadString !== safeStringifyVisualizationPayload() ||
                    previousSelectedPath !== resolvedSelectedPath,
                projectChanged
            });
        };

        let activeProjectStateOpenInProgress = false;
        let pendingActiveProjectStateProjectPath: string | null = null;
        const openNextPendingActiveProjectStatePath = (): void => {
            const nextProjectPath = pendingActiveProjectStateProjectPath;
            pendingActiveProjectStateProjectPath = null;
            if (nextProjectPath === null) {
                activeProjectStateOpenInProgress = false;
                return;
            }

            try {
                openProjectTargetPath(nextProjectPath, "active-project-state");
            } catch (error) {
                console.error(
                    `[graph visualize] Failed to open gm-cli active project: ${Core.getErrorMessage(error, {
                        fallback: "Unknown active-project state failure"
                    })}`
                );
            }

            openNextPendingActiveProjectStatePath();
        };

        const requestActiveProjectStateOpen = (projectPath: string): void => {
            pendingActiveProjectStateProjectPath = projectPath;
            if (activeProjectStateOpenInProgress) {
                return;
            }

            activeProjectStateOpenInProgress = true;
            void openNextPendingActiveProjectStatePath();
        };

        const discoverPlaygroundFixtures = async (): Promise<
            ReadonlyArray<GraphVisualizationServerPlaygroundFixture>
        > => {
            try {
                const fixtureRepoRoot = repoRoot;
                const fixtureRoots = [
                    { kind: "format", path: path.join(fixtureRepoRoot, "src", "format", "test", "fixtures") },
                    { kind: "lint", path: path.join(fixtureRepoRoot, "src", "lint", "test", "fixtures") },
                    { kind: "refactor", path: path.join(fixtureRepoRoot, "src", "refactor", "test", "fixtures") },
                    { kind: "integration", path: path.join(fixtureRepoRoot, "test", "fixtures", "integration") }
                ];

                const discoveredFixtureGroups = await Promise.all(
                    fixtureRoots.map(async (fixtureRoot) => {
                        if (!existsSync(fixtureRoot.path)) {
                            return [];
                        }

                        const entries = await readdir(fixtureRoot.path, { withFileTypes: true });
                        const fixtureDirectories = entries
                            .filter((entry) => entry.isDirectory())
                            .map((entry) => entry.name)
                            .sort((left, right) => left.localeCompare(right));

                        return Promise.all(
                            fixtureDirectories.map(async (caseId) => {
                                const caseRoot = path.join(fixtureRoot.path, caseId);
                                const inputFilePath = path.join(caseRoot, "input.gml");
                                if (!existsSync(inputFilePath)) {
                                    return null;
                                }

                                const expectedFilePath = path.join(caseRoot, "expected.gml");
                                const configPath = path.join(caseRoot, "gmloop.json");
                                const [inputGml, expectedGml, config] = await Promise.all([
                                    readFile(inputFilePath, "utf8"),
                                    existsSync(expectedFilePath)
                                        ? readFile(expectedFilePath, "utf8")
                                        : Promise.resolve(null),
                                    existsSync(configPath)
                                        ? readFile(configPath, "utf8").then(
                                              (source) => JSON.parse(source) as Record<string, unknown>
                                          )
                                        : Promise.resolve({})
                                ]);

                                return {
                                    caseId: `${fixtureRoot.kind}/${caseId}`,
                                    kind: fixtureRoot.kind,
                                    inputGml,
                                    expectedGml,
                                    config
                                };
                            })
                        );
                    })
                );
                return discoveredFixtureGroups.flat().filter((fixture) => fixture !== null);
            } catch (error) {
                console.error("Failed to discover playground fixtures:", error);
                return [];
            }
        };

        const writeActiveProjectConfig = async (config: Readonly<Record<string, unknown>>) => {
            const projectRoot = activeContext?.projectRoot ?? process.cwd();
            const configPath = path.join(projectRoot, "gmloop.json");
            await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
            const nextContext = await resolveGraphContext({
                ...options,
                path: projectRoot
            });
            updateActiveContext(nextContext);
            await refreshActiveVisualizationArtifacts(nextContext);
            markServeRevisionChanged();
            return Object.freeze({ changed: true });
        };

        const server = await startGraphVisualizationServer({
            getUiRevision: () => activeServeRevision,
            getPlaygroundFixtures: discoverPlaygroundFixtures,
            regenerate: async () => {
                const previousPayloadString = safeStringifyVisualizationPayload();
                if (!activeContext) {
                    return Object.freeze({ changed: false });
                }
                await ensureGraphIndexForServe(options, activeContext, true);
                await refreshActiveVisualizationArtifacts(activeContext);
                const nextPayloadString = safeStringifyVisualizationPayload();
                markServeRevisionChanged();
                return Object.freeze({ changed: previousPayloadString !== nextPayloadString });
            },
            createConfig: () => {
                return writeActiveProjectConfig(createDefaultGmloopProjectConfig());
            },
            saveConfig: ({ config }) => {
                return writeActiveProjectConfig(config);
            },
            initializeAutoGameAgentPack: async ({ agentTargets, includeGitIgnore, includeVSCode }) => {
                if (!activeContext) {
                    throw new Error("Open a GameMaker project before initializing the Auto-Game agent pack.");
                }
                const result = await AgentPack.initializeAgentPack(activeContext.projectRoot, {
                    agentTargets,
                    includeGitIgnore,
                    includeVSCode
                });
                await refreshActiveVisualizationArtifacts(activeContext);
                markServeRevisionChanged();
                return Object.freeze({ changed: result.changed });
            },
            setAutoGameSkillEnabled: async ({ enabled, name }) => {
                if (!activeContext) {
                    throw new Error("Open a GameMaker project before changing Auto-Game skills.");
                }
                const projectConfig = await setAutoGameProjectSkillEnabled(activeContext.projectRoot, name, enabled);
                activeContext = Object.freeze({ ...activeContext, projectConfig });
                await refreshActiveVisualizationArtifacts(activeContext);
                markServeRevisionChanged();
                return Object.freeze({ changed: true });
            },
            openProjectTargets: async ({ path: selectedPath }) => {
                const nextPathFromPicker =
                    selectedPath === null ? await pickProjectPathUsingNativeDialog() : selectedPath;
                if (!nextPathFromPicker) {
                    return Object.freeze({ changed: false, projectChanged: false });
                }
                const validatedProjectPath = await validateGameMakerProjectFilePath(nextPathFromPicker);
                return openProjectTargetPath(validatedProjectPath, "finder-open");
            },
            runFix: async ({ workflow }) => {
                if (!activeContext) {
                    throw new Error("Open a GameMaker project before running fixes.");
                }

                activeFixProgressLogLines = [];
                activeFixWorkflow = workflow;
                isFixWorkflowRunning = true;
                isFixCancelRequested = false;
                try {
                    const result = await runGraphVisualizationProjectWorkflow(
                        activeContext,
                        options.config,
                        workflow,
                        (logLine) => {
                            activeFixProgressLogLines.push(logLine);
                        },
                        (childProcess) => {
                            activeFixChildProcess = childProcess;
                        }
                    );
                    activeLastFixRun = Object.freeze({
                        logLines: result.logLines,
                        projectRoot: activeContext.projectRoot,
                        status: "success"
                    });
                    activeFixProgressLogLines.push("Rebuilding SQLite graph index database...");
                    await ensureGraphIndexForServe(options, activeContext, true);
                    activeFixProgressLogLines.push("Refreshing graph visualization artifacts...");
                    await refreshActiveVisualizationArtifacts(activeContext);
                    activeFixProgressLogLines.push("Fix workflow post-processing complete.");
                    markServeRevisionChanged();
                    return result;
                } catch (error) {
                    if (isFixCancelRequested) {
                        const cancelledMessage = "Fix workflow was cancelled.";
                        activeFixProgressLogLines.push(cancelledMessage);
                        throw new Error(cancelledMessage, { cause: error });
                    }
                    throw error;
                } finally {
                    isFixWorkflowRunning = false;
                    activeFixWorkflow = null;
                    activeFixChildProcess = null;
                }
            },
            // This never awaits anything internally (killing the child process is
            // synchronous), so it stays a plain function returning a resolved promise
            // instead of `async`, satisfying both the `GraphVisualizationServerCancelFix`
            // contract and the require-await lint rule.
            cancelFix: () => {
                if (!isFixWorkflowRunning || activeFixChildProcess === null) {
                    return Promise.resolve(Object.freeze({ cancelled: false }));
                }

                isFixCancelRequested = true;
                activeFixProgressLogLines.push("Cancelling fix workflow...");
                activeFixChildProcess.kill("SIGTERM");
                return Promise.resolve(Object.freeze({ cancelled: true }));
            },
            getFixProgress: () =>
                (() => {
                    const localProgress = Object.freeze({
                        isRunning: isFixWorkflowRunning,
                        logLines: Object.freeze([...activeFixProgressLogLines]),
                        status: isFixWorkflowRunning ? "running" : (activeLastFixRun?.status ?? "idle"),
                        workflow: activeFixWorkflow ?? undefined
                    });
                    if (localProgress.isRunning || activeContext === null) {
                        return localProgress;
                    }

                    const sharedState = readProjectOperationState(activeContext.projectRoot);
                    const sharedOperation = sharedState.active ?? sharedState.recent[0] ?? null;
                    if (
                        sharedOperation === null ||
                        (sharedOperation.kind !== "fix" &&
                            sharedOperation.kind !== "format" &&
                            sharedOperation.kind !== "lint" &&
                            sharedOperation.kind !== "refactor")
                    ) {
                        return localProgress;
                    }

                    return Object.freeze({
                        isRunning: sharedOperation.status === "running",
                        logLines: sharedOperation.messages,
                        status:
                            sharedOperation.status === "running"
                                ? "running"
                                : sharedOperation.status === "succeeded"
                                  ? "success"
                                  : "error",
                        workflow: sharedOperation.kind
                    });
                })(),
            getSemanticIndexProgress: () => {
                // Fall back to the selected target so the initial project
                // open (which runs before activeContext exists) still reports
                // the child build's shared progress.
                const progressProjectRoot = activeContext?.projectRoot ?? createLoadedTarget().projectRoot;
                if (progressProjectRoot === "") {
                    return Object.freeze({
                        current: null,
                        isRunning: false,
                        logLines: Object.freeze([]),
                        stage: null,
                        status: "idle" as const,
                        summary: null,
                        total: null
                    });
                }

                const sharedState = readProjectOperationState(progressProjectRoot);
                const activeOperation = sharedState.active;
                const operation =
                    activeOperation?.kind === SEMANTIC_INDEX_OPERATION_KIND ||
                    activeOperation?.phase === SEMANTIC_INDEX_OPERATION_KIND ||
                    activeOperation?.semanticIndex !== null
                        ? activeOperation
                        : (sharedState.recent.find((entry) => entry.kind === SEMANTIC_INDEX_OPERATION_KIND) ?? null);
                if (operation === null) {
                    return Object.freeze({
                        current: null,
                        isRunning: false,
                        logLines: Object.freeze([]),
                        stage: null,
                        status: "idle" as const,
                        summary: null,
                        total: null
                    });
                }

                const semanticIndex = operation.semanticIndex;
                return Object.freeze({
                    current: semanticIndex?.stage === "gml-parse" ? semanticIndex.current : null,
                    isRunning: operation.status === "running",
                    logLines: operation.messages,
                    stage: semanticIndex?.stage ?? null,
                    status:
                        operation.status === "running"
                            ? ("running" as const)
                            : operation.status === "succeeded"
                              ? ("success" as const)
                              : ("error" as const),
                    summary: semanticIndex?.stage === "complete" ? semanticIndex.summary : null,
                    total: semanticIndex?.stage === "gml-parse" ? semanticIndex.total : null
                });
            },
            clearFixProgress: () => {
                activeFixProgressLogLines = [];
            },
            processPlayground: async ({
                gml,
                formatOptionNames,
                format,
                lint,
                lintRuleIds,
                refactor,
                codemodIds,
                transpileMode,
                fixtureId
            }) => {
                let ast: string;
                let output = gml;
                let error: string | null = null;

                try {
                    let projectConfig = activeContext?.projectConfig ?? null;
                    if (fixtureId) {
                        const fixtures = await discoverPlaygroundFixtures();
                        const found = fixtures.find((f) => f.caseId === fixtureId);
                        if (found) {
                            projectConfig = found.config;
                        }
                    }

                    const parseAdapter = createGmlParserAdapter();
                    const program = parseAdapter(gml);
                    ast = JSON.stringify(
                        program,
                        (key, value) => {
                            if (key === "parent" || key === "sourceRange") return;
                            return value;
                        },
                        2
                    );

                    if (refactor) {
                        output = await applySelectedPlaygroundCodemods(
                            output,
                            codemodIds,
                            activeContext?.projectRoot ?? process.cwd(),
                            projectConfig
                        );
                    }

                    if (lint) {
                        const eslint = new ESLint({
                            overrideConfigFile: true,
                            fix: true,
                            overrideConfig: createMutableGraphPlaygroundLintConfig(lintRuleIds, projectConfig)
                        });
                        const [result] = await eslint.lintText(output, {
                            filePath: "graph-visualization-playground.gml"
                        });
                        output = result.output ?? output;
                    }

                    if (format) {
                        output = await Format.format(
                            output,
                            createGraphPlaygroundFormatOptions(formatOptionNames, projectConfig)
                        );
                    }

                    if (transpileMode === "patch") {
                        const transpiler = createGmlTranspilerAdapter();
                        const patch = transpiler.transpileScript({
                            sourceText: output,
                            symbolId: "playground-script"
                        });
                        output = patch.js_body;
                    } else if (transpileMode === "expression") {
                        const transpiler = createGmlTranspilerAdapter();
                        output = transpiler.transpileExpression(output);
                    }
                } catch (error_) {
                    error = Core.getErrorMessage(error_);
                    output = "";
                    ast = "";
                }

                return Object.freeze({ ast, output, error });
            },
            startLiveReload: async (input) => {
                const liveReload = await ensureLiveReloadSessionStarted(input);
                markServeRevisionChanged();
                return liveReload;
            },
            stopLiveReload: async () => {
                await stopGraphVisualizationLiveReloadSession(
                    activeLiveReloadSession,
                    activeContext?.projectRoot ?? null
                );
                markServeRevisionChanged();
            },
            renderBundle: renderServeBundle
        });

        // Warm the web bundle before the browser's first request arrives so a
        // stale or missing dist/web build overlaps with browser startup
        // instead of blocking the first page load.
        void renderServeBundle(true).catch((error: unknown) => {
            console.error(
                `[graph visualize] Failed to prepare the UI bundle: ${Core.getErrorMessage(error, {
                    fallback: "Unknown UI bundle build failure"
                })}`
            );
        });

        initializeServeStateInBackground();
        let activeProjectStateWatcher: GraphVisualizationActiveProjectStateWatcher | null =
            startGraphVisualizationActiveProjectStateWatcher({
                env: process.env,
                onError: (error) => {
                    console.error(
                        `[graph visualize] gm-cli active-project watcher ignored state update: ${Core.getErrorMessage(
                            error,
                            { fallback: "Unknown active-project state failure" }
                        )}`
                    );
                },
                onProjectPathChanged: requestActiveProjectStateOpen,
                statePathOption: options.projectState
            });

        printGraphOutput(
            {
                command: "graph visualize",
                databasePath: resolveActiveConfig()?.databasePath ?? "",
                ok: true,
                payload: { url: server.url },
                projectRoot: activeContext?.projectRoot ?? "",
                toolsetRoot: resolveActiveConfig()?.toolsetRoot ?? null
            },
            options.json === true,
            `Serving graph visualization at ${server.url}`
        );
        if (options.open) {
            openUrlInDefaultBrowser(server.url);
        }

        let serveShutdownInProgress = false;
        const stopOwnedLiveReloadSession = (): Promise<void> =>
            stopOwnedGraphVisualizationLiveReloadSession(activeLiveReloadSession, activeContext?.projectRoot ?? null);
        const shutdownServeProcess = (exitCode: number): void => {
            if (serveShutdownInProgress) {
                return;
            }

            serveShutdownInProgress = true;
            if (uiWatchDebounceTimer !== null) {
                globalThis.clearTimeout(uiWatchDebounceTimer);
                uiWatchDebounceTimer = null;
            }
            uiSourceWatcher?.close();
            uiSourceWatcher = null;
            activeProjectStateWatcher?.stop();
            activeProjectStateWatcher = null;
            featherMetadataWatcher?.close();
            featherMetadataWatcher = null;

            void (async () => {
                try {
                    await Promise.all([server.stop(), stopOwnedLiveReloadSession()]);
                } finally {
                    process.exit(exitCode);
                }
            })();
        };
        process.once("SIGINT", () => shutdownServeProcess(130));
        process.once("SIGTERM", () => shutdownServeProcess(143));
        process.once("exit", () => {
            if (uiWatchDebounceTimer !== null) {
                globalThis.clearTimeout(uiWatchDebounceTimer);
                uiWatchDebounceTimer = null;
            }
            uiSourceWatcher?.close();
            uiSourceWatcher = null;
            activeProjectStateWatcher?.stop();
            activeProjectStateWatcher = null;
            featherMetadataWatcher?.close();
            featherMetadataWatcher = null;
            void stopOwnedLiveReloadSession();
        });
    }

    if (options.serve === true) {
        await runServeVisualizationMode();
        return;
    }

    await runGraphVisualizationStaticExportMode({
        autoGamePipeline: activeAutoGamePipeline,
        context: activeContext,
        loadedTarget: createLoadedTarget(),
        options,
        payload: activeVisualizationPayload,
        projectConfigurationCatalog: activeProjectConfigurationCatalog
    });
}

function addGraphSharedOptions(
    command: Command,
    { includeDepth = false, includeLimit = false, includeForce = false } = {}
): Command {
    command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createVerboseOption())
        .addOption(new Option("--database-path <path>", "SQLite graph-index database path"))
        .addOption(new Option("--toolset-root <path>", "Optional second GameMaker/toolset root to index").default(""))
        .addOption(new Option("--json", "Print machine-readable JSON output").default(false));

    if (includeDepth) {
        command.addOption(
            new Option("--depth <n>", "Neighbor traversal depth")
                .argParser(createMinimumValueValidator(1, "Depth must be at least 1"))
                .default(1)
        );
    }

    if (includeLimit) {
        command.addOption(
            new Option("--limit <n>", "Maximum number of search results")
                .argParser(createMinimumValueValidator(1, "Limit must be at least 1"))
                .default(10)
        );
    }

    if (includeForce) {
        command.addOption(new Option("--force", "Force graph-index regeneration before continuing.").default(false));
    }

    return command;
}

async function runGraphCommandAction(action: () => Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        handleCliError(error, {
            exitCode: 1,
            prefix: "Graph command failed."
        });
    }
}

/**
 * Create the `graph` command suite.
 */
export function createGraphCommand(): Command {
    const graphCommand = applyStandardCommandOptions(new Command("graph")).description(
        "Build and query the dual-root semantic graph index."
    );

    const indexCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("index")).description("Build or rebuild the graph index."),
        { includeForce: true }
    );
    indexCommand.action(async function graphIndexCommandAction() {
        await runGraphCommandAction(async () => {
            await runGraphIndexAction(this.opts<GraphCommandSharedOptions>());
        });
    });

    const searchCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("search"))
            .description("Search the graph index.")
            .argument("<query...>", "Search query"),
        { includeLimit: true, includeForce: true }
    );
    searchCommand.action(async function graphSearchCommandAction(query: Array<string>) {
        await runGraphCommandAction(async () => {
            await runGraphSearchAction(query.join(" "), this.opts<GraphCommandSharedOptions>());
        });
    });

    const doctorCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("doctor")).description("Inspect graph-index health and configuration."),
        {}
    ).addOption(
        new Option(
            "--vacuum",
            "Compact the graph database, reclaiming free space left by incremental rebuilds"
        ).default(false)
    );
    doctorCommand.action(async function graphDoctorCommandAction() {
        await runGraphCommandAction(async () => {
            await runGraphDoctorAction(this.opts<GraphCommandSharedOptions>());
        });
    });

    const visualizeCommand = addGraphSharedOptions(
        applyStandardCommandOptions(new Command("visualize")).description(
            "Render an interactive graph index visualization HTML+assets bundle."
        ),
        { includeForce: true }
    );
    visualizeCommand
        .addOption(new Option("--output <path>", "Output visualization directory path"))
        .addOption(new Option("--open", "Open the generated file in your default browser").default(true))
        .addOption(new Option("--no-open", "Do not open the generated file").default(false))
        .addOption(new Option("--serve", "Serve dynamically rather than writing an output file").default(false))
        .addOption(
            new Option("--live-reload", "Auto-rebuild and auto-reload served UI when src/ui/src changes").default(true)
        )
        .addOption(new Option("--project-state <path>", "Active-project state file written by GMLoop UI."))
        .action(async function graphVisualizeCommandAction() {
            await runGraphCommandAction(async () => {
                await runGraphVisualizeAction(this.opts<GraphCommandSharedOptions>());
            });
        });

    graphCommand.addCommand(indexCommand);
    graphCommand.addCommand(searchCommand);
    graphCommand.addCommand(doctorCommand);
    graphCommand.addCommand(visualizeCommand);

    return graphCommand;
}

export const __graphCommandTest__ = Object.freeze({
    createGraphVisualizationWorkflowArguments,
    createGraphVisualizationLiveReloadStartArguments,
    createGraphVisualizationLiveReloadModelFromSession,
    createGraphVisualizationLiveReloadSessionState,
    ensureGraphVisualizationLiveReloadSession,
    stopGraphVisualizationLiveReloadSession,
    stopOwnedGraphVisualizationLiveReloadSession,
    isGraphVisualizationUiSourceReloadCandidate,
    normalizeGraphVisualizationUiSourceWatchFileName,
    resolveGraphVisualizationLiveReloadStartupOptions,
    resolveDefaultGraphVisualizationServeTargetPath,
    resolveGraphVisualizationUiSourceWatchRoot,
    resolveGraphVisualizationServeStartupState,
    startGraphVisualizationActiveProjectStateWatcher,
    startGraphVisualizationFeatherMetadataWatcher,
    startGraphVisualizationUiSourceWatcher,
    streamProcessOutputByLine
});
function loadLspToolsCatalogEntries() {
    try {
        const resolvedPath = fileURLToPath(import.meta.resolve("lsp-mcp-server"));
        const code = readFileSync(resolvedPath, "utf8");
        const match = code.match(/const TOOLS\s*=\s*(\[[\s\S]*?\]);\s*const toolHandlers/);
        if (!match) {
            return [];
        }
        const toolsString = match[1];
        const rawTools = vm.runInNewContext(toolsString) as ReadonlyArray<any>;

        return rawTools.map((rawTool) => {
            const properties = rawTool.inputSchema?.properties ?? {};
            const requiredFields = new Set<string>(rawTool.inputSchema?.required);
            const fields = Object.entries(properties).map(([fieldName, prop]: [string, any]) => {
                return Object.freeze({
                    choices: Array.isArray(prop.enum) ? Object.freeze(prop.enum.map(String)) : undefined,
                    default: prop.default,
                    description: prop.description ?? "",
                    name: fieldName,
                    required: requiredFields.has(fieldName),
                    type: prop.type ?? "string"
                });
            });
            return Object.freeze({
                description: rawTool.description ?? "",
                displayName: rawTool.annotations?.title ?? rawTool.name,
                fields: Object.freeze(fields),
                name: rawTool.name
            });
        });
    } catch {
        return [];
    }
}

function createDocumentationCatalogs() {
    const cliCommands = getCliCommandCatalog();
    const lintCatalogEntryById = new Map(listLintRuleCatalogEntries().map((entry) => [entry.ruleId, entry] as const));
    const semanticIndexCodemodIdSet = new Set(Refactor.listSemanticProjectIndexDependentCodemodIds());
    const lspTools = loadLspToolsCatalogEntries();

    return Object.freeze({
        cliCommands,
        lspTools,
        mcpServer: Object.freeze({
            name: "gmloop-mcp",
            version: "0.0.1"
        }),
        mcpTools: getMcpToolCatalogEntries({ includeInternal: true }),
        workspaceRules: Object.freeze({
            formatOptions: Format.projectFormatOptionCatalog.map((entry) =>
                Object.freeze({
                    defaultValue: entry.defaultValue,
                    description: entry.description,
                    name: entry.name
                })
            ),
            lintRules: listLintRuleCatalogEntries().map((entry) =>
                Object.freeze({
                    description: lintCatalogEntryById.get(entry.ruleId)?.description ?? entry.description,
                    fixable: entry.fixable,
                    ruleId: entry.ruleId
                })
            ),
            refactorCodemods: Refactor.listRegisteredCodemods().map((entry) =>
                Object.freeze({
                    description: entry.description,
                    id: entry.id,
                    requiresSemanticProjectIndex: semanticIndexCodemodIdSet.has(entry.id)
                })
            )
        })
    });
}

async function writeGraphVisualizationBundleArtifact(
    bundleArtifact: GraphVisualizationBundleArtifact,
    outputDirectory: string
): Promise<GraphVisualizationExportResult> {
    await mkdir(outputDirectory, { recursive: true });

    await Promise.all(
        bundleArtifact.files.map(async (bundleFile) => {
            const absoluteBundlePath = path.resolve(outputDirectory, bundleFile.relativePath);
            const absoluteOutputRoot = path.resolve(outputDirectory) + path.sep;
            if (
                !absoluteBundlePath.startsWith(absoluteOutputRoot) &&
                absoluteBundlePath !== path.resolve(outputDirectory)
            ) {
                throw new Error(
                    `Refusing to write graph visualization bundle file outside the output directory: ${bundleFile.relativePath}`
                );
            }
            await mkdir(path.dirname(absoluteBundlePath), { recursive: true });
            await writeFile(absoluteBundlePath, bundleFile.bytes);
        })
    );

    return Object.freeze({
        entryHtmlPath: bundleArtifact.entryHtmlPath,
        outputDirectory
    });
}
