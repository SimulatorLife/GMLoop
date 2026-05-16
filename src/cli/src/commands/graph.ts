import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { existsSync, type FSWatcher, watch, type WatchListener, type WatchOptions } from "node:fs";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Parser } from "@gmloop/parser";
import { Refactor, type RefactorCodemodId } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Transpiler } from "@gmloop/transpiler";
import { UI } from "@gmloop/ui";
import { Command, Option } from "commander";
import { ESLint } from "eslint";

import { getCliCommandCatalog, getMcpToolCatalogEntries } from "../cli.js";
import { createMinimumValueValidator } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createConfigOption, createPathOption, createVerboseOption } from "../cli-core/shared-command-options.js";
import {
    createStatusUrl,
    createWebSocketUrl,
    DEFAULT_GM_TEMP_ROOT,
    DEFAULT_LIVE_RELOAD_STATUS_HOST,
    DEFAULT_LIVE_RELOAD_STATUS_PORT,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
    DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT
} from "../modules/live-reload/config.js";
import { GmlParserBridge, GmlSemanticBridge, GmlTranspilerBridge } from "../modules/refactor/index.js";
import { startGraphVisualizationServer } from "../modules/server/graph-visualization-server.js";
import { openUrlInDefaultBrowser } from "../modules/server/open-url.js";
import { createGraphVisualizationProjectConfigurationCatalog } from "../modules/ui/index.js";
import { findRepoRootSync } from "../shared/repo-root.js";
import { discoverProjectRoot, resolveExplicitWorkflowTargetPath } from "../workflow/project-root.js";

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

async function runGraphVisualizationFixWorkflow(
    context: GraphResolutionContext,
    configPath: string | undefined
): Promise<Readonly<{ logLines: ReadonlyArray<string> }>> {
    const cliEntryPath = fileURLToPath(new URL("../../index.js", import.meta.url));
    const args = [cliEntryPath, "fix", "--write", "--path", context.projectRoot];
    if (configPath) {
        args.push("--config", configPath);
    }

    const logText = await new Promise<string>((resolve, reject) => {
        execFile(process.execPath, args, { cwd: context.projectRoot }, (error, stdout, stderr) => {
            const combinedOutput = [stdout, stderr].filter((value) => value.length > 0).join("\n");
            if (error) {
                reject(new Error(combinedOutput.length > 0 ? combinedOutput : Core.getErrorMessage(error)));
                return;
            }

            resolve(combinedOutput);
        });
    });

    return Object.freeze({ logLines: logText.split(/\r?\n/u).filter((line) => line.length > 0) });
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

type GraphServeSource = "cli-path" | "demo-project" | "finder-open" | "working-directory";

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
    childProcess: ChildProcessWithoutNullStreams | null;
    childStderrBuffer: Array<string>;
    model: GraphVisualizationLiveReloadModel | null;
    startupPromise: Promise<GraphVisualizationLiveReloadModel> | null;
};

type GraphVisualizationLiveReloadStartupOptions = Readonly<{
    gmTempRoot: string;
    hasBuildConfiguration: boolean;
    html5OutputRoot: string | null;
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
const GRAPH_VISUALIZATION_LIVE_RELOAD_START_TIMEOUT_MS = 10 * 60 * 1000;
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

function createGraphVisualizationLiveReloadModel(
    runtimeUrl: string | null,
    statusSnapshot: GraphVisualizationLiveReloadStatusSnapshot | null = null
): GraphVisualizationLiveReloadModel {
    return Object.freeze({
        endpoints: Object.freeze({
            runtimeUrl,
            statusUrl: createStatusUrl(DEFAULT_LIVE_RELOAD_STATUS_HOST, DEFAULT_LIVE_RELOAD_STATUS_PORT),
            websocketUrl: createWebSocketUrl(DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST, DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT)
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
            configuredHtml5OutputRoot.length > 0 ? path.resolve(projectRoot, configuredHtml5OutputRoot) : null
    });
}

function createGraphVisualizationLiveReloadDevCommandArgs(
    projectRoot: string,
    startupOptions: GraphVisualizationLiveReloadStartupOptions
): Array<string> {
    return [
        "live-reload",
        "dev",
        projectRoot,
        ...(startupOptions.html5OutputRoot === null ? [] : ["--html5-output", startupOptions.html5OutputRoot]),
        "--gm-temp-root",
        startupOptions.gmTempRoot,
        "--quiet"
    ];
}

function resolveGraphVisualizationCliEntrypointPath(): string {
    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const candidatePaths = [
        path.resolve(moduleDirectory, "../../dist/index.js"),
        path.resolve(moduleDirectory, "../../index.js")
    ];

    for (const candidatePath of candidatePaths) {
        if (existsSync(candidatePath)) {
            return candidatePath;
        }
    }

    throw new Error("Could not locate the CLI entrypoint required to start live reload.");
}

async function tryFetchGraphVisualizationLiveReloadStatusSnapshot(): Promise<GraphVisualizationLiveReloadStatusSnapshot | null> {
    const statusUrl = createStatusUrl(DEFAULT_LIVE_RELOAD_STATUS_HOST, DEFAULT_LIVE_RELOAD_STATUS_PORT);

    try {
        const response = await fetch(statusUrl, {
            headers: { Accept: "application/json" }
        });
        if (!response.ok) {
            return null;
        }

        const payload = (await response.json()) as Record<string, unknown>;
        const patchCount = typeof payload.patchCount === "number" ? payload.patchCount : 0;
        const totalPatchCount = typeof payload.totalPatchCount === "number" ? payload.totalPatchCount : null;
        const patchHistorySize = typeof payload.patchHistorySize === "number" ? payload.patchHistorySize : null;
        const maxPatchHistory = typeof payload.maxPatchHistory === "number" ? payload.maxPatchHistory : null;
        const errorCount = typeof payload.errorCount === "number" ? payload.errorCount : 0;
        const scanComplete = payload.scanComplete === true;
        const websocketClients = typeof payload.websocketClients === "number" ? payload.websocketClients : 0;
        const uptimeMs = typeof payload.uptime === "number" ? payload.uptime : 0;

        return Object.freeze({
            avgHotReloadLatencyMs:
                typeof payload.avgHotReloadLatencyMs === "number" ? payload.avgHotReloadLatencyMs : null,
            errorCount,
            maxPatchHistory,
            patchCount,
            patchHistorySize,
            p95HotReloadLatencyMs:
                typeof payload.p95HotReloadLatencyMs === "number" ? payload.p95HotReloadLatencyMs : null,
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
            scanComplete,
            totalPatchCount,
            uptimeMs,
            watcherStatus: errorCount > 0 && scanComplete === false ? "error" : scanComplete ? "running" : "scanning",
            websocketClients
        });
    } catch {
        return null;
    }
}

function setActiveGraphVisualizationLiveReloadModel(
    sessionState: GraphVisualizationLiveReloadSessionState,
    model: GraphVisualizationLiveReloadModel
): GraphVisualizationLiveReloadModel {
    sessionState.model = model;
    return model;
}

function createGraphVisualizationLiveReloadStartupTimeoutError(stderrMessages: ReadonlyArray<string>): Error {
    const stderrMessage = stderrMessages.join("\n").trim();
    if (stderrMessage.length > 0) {
        return new Error(stderrMessage);
    }

    return new Error(
        "Timed out waiting for the live-reload build and watcher to become ready. " +
            "Ensure GameMaker CLI/Igor prerequisites are installed and runtime.liveReload.build plus runtime.liveReload.html5Output are configured correctly in gmloop.json."
    );
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

function setActiveGraphVisualizationLiveReloadStartupPromise(
    sessionState: GraphVisualizationLiveReloadSessionState,
    startupPromise: Promise<GraphVisualizationLiveReloadModel>
): Promise<GraphVisualizationLiveReloadModel> {
    sessionState.startupPromise = startupPromise;
    return startupPromise;
}

function clearActiveGraphVisualizationLiveReloadStartupPromise(
    sessionState: GraphVisualizationLiveReloadSessionState
): void {
    sessionState.startupPromise = null;
}

function resetGraphVisualizationLiveReloadSessionForRestart(
    sessionState: GraphVisualizationLiveReloadSessionState
): void {
    sessionState.childStderrBuffer = [];
    sessionState.model = null;
}

async function stopGraphVisualizationLiveReloadChildProcess(
    sessionState: GraphVisualizationLiveReloadSessionState
): Promise<void> {
    const activeChildProcess = sessionState.childProcess;
    if (activeChildProcess === null || activeChildProcess.killed) {
        sessionState.childProcess = null;
        return;
    }
    sessionState.childProcess = null;

    await new Promise<void>((resolve) => {
        let settled = false;
        const settle = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };

        const timeoutHandle = globalThis.setTimeout(() => {
            activeChildProcess.removeListener("exit", settle);
            settle();
        }, 1500);
        activeChildProcess.once("exit", () => {
            globalThis.clearTimeout(timeoutHandle);
            settle();
        });
        activeChildProcess.kill("SIGTERM");
    });
}

function createMutableGraphPlaygroundLintConfig(enabledRuleIds: ReadonlyArray<string>): Array<Record<string, unknown>> {
    const enabledRules = new Set(enabledRuleIds);
    const enforceRuleFilter = enabledRules.size > 0;
    return Lint.configs.recommended.map((config) => {
        const nextConfig = {
            ...config,
            files: Array.isArray(config.files) ? [...config.files] : config.files,
            plugins: config.plugins ? { ...config.plugins } : undefined,
            rules: config.rules ? { ...config.rules } : undefined
        };

        if (enforceRuleFilter && nextConfig.rules && typeof nextConfig.rules === "object") {
            for (const ruleId of Object.keys(nextConfig.rules)) {
                if (!enabledRules.has(ruleId)) {
                    nextConfig.rules[ruleId] = "off";
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
    return new Refactor.RefactorEngine({
        formatter: new GmlTranspilerBridge(),
        parser: new GmlParserBridge(),
        semantic: new GmlSemanticBridge({}, activeProjectRoot)
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

async function runOsaScript(lines: ReadonlyArray<string>): Promise<OsaScriptExecutionResult> {
    return await new Promise<OsaScriptExecutionResult>((resolve, reject) => {
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
                reject(error instanceof Error ? error : new Error("Failed to build @gmloop/ui workspace."));
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
    initialSelectedPath: string | null
): Promise<GraphVisualizationStartupState> {
    if (initialSelectedPath !== null) {
        const context = await resolveGraphContext(options);
        await ensureGraphIndexForQuery(options, context);
        return {
            context,
            selectedPaths: [initialSelectedPath],
            source: "cli-path"
        };
    }

    try {
        const context = await resolveGraphContext(options);
        await ensureGraphIndexForQuery(options, context);
        return {
            context,
            selectedPaths: [context.projectRoot],
            source: "working-directory"
        };
    } catch {
        const defaultServeTargetPath = resolveDefaultGraphVisualizationServeTargetPath();
        if (defaultServeTargetPath === null) {
            return {
                context: null,
                selectedPaths: [],
                source: "working-directory"
            };
        }

        const nextOptions = {
            ...options,
            path: defaultServeTargetPath
        };
        const context = await resolveGraphContext(nextOptions);
        await ensureGraphIndexForQuery(nextOptions, context);
        return {
            context,
            selectedPaths: [defaultServeTargetPath],
            source: "demo-project"
        };
    }
}

async function pickProjectPathUsingNativeDialog(): Promise<string | null> {
    if (process.platform !== "darwin") {
        return null;
    }

    const scriptLines = [
        'set selectionMode to button returned of (display dialog "Open GameMaker project from:" buttons {"Cancel", "Folder", "YYP File"} default button "Folder" cancel button "Cancel")',
        'if selectionMode is "YYP File" then',
        '    return POSIX path of (choose file with prompt "Choose a .yyp project file:" of type {"yyp"})',
        "end if",
        'return POSIX path of (choose folder with prompt "Choose a GameMaker project folder:")'
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
    return Core.isObjectLike(loadedConfig) ? (loadedConfig as Record<string, unknown>) : {};
}

async function resolveGraphContext(options: GraphCommandSharedOptions): Promise<GraphResolutionContext> {
    const projectRoot = await discoverProjectRoot({
        configPath: options.config,
        explicitProjectPath: options.path
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

async function ensureGraphIndex(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<Awaited<ReturnType<typeof Semantic.buildGraphIndex>>> {
    return await Semantic.buildGraphIndex({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        rebuild: options.force === true,
        toolsetRoot: options.toolsetRoot
    });
}

async function ensureGraphIndexForQuery(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext
): Promise<void> {
    if (options.force === true) {
        await ensureGraphIndex(options, context);
        return;
    }

    const config = Semantic.resolveGraphIndexConfig({
        databasePath: options.databasePath,
        projectConfig: context.projectConfig,
        projectRoot: context.projectRoot,
        toolsetRoot: options.toolsetRoot
    });

    try {
        await access(config.databasePath, constants.R_OK);
    } catch {
        await ensureGraphIndex(options, context);
    }
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

async function runGraphVisualizeAction(options: GraphCommandSharedOptions): Promise<void> {
    const initialSelectedPath = resolveExplicitWorkflowTargetPath(options.path);
    let activeContext: GraphResolutionContext | null = null;
    let activeSelectedPaths = initialSelectedPath ? [initialSelectedPath] : [];
    let activeSource: GraphServeSource = options.path ? "cli-path" : "working-directory";
    let activeVisualizationPayload = createEmptyGraphVisualizationData();
    let activeProjectConfigurationCatalog: Awaited<
        ReturnType<typeof createGraphVisualizationProjectConfigurationCatalog>
    > | null = null;
    let activeStartupState: GraphVisualizationServeBackgroundState | null =
        options.serve === true ? createGraphVisualizationServeLoadingState("Loading project data…", null) : null;
    let activeServeStartupGeneration = 0;
    let activeServeRevision = 0;
    let activeServeBundleCache: GraphVisualizationServeBundleCache | null = null;
    const activeLiveReloadSession: GraphVisualizationLiveReloadSessionState = {
        childProcess: null,
        childStderrBuffer: [],
        model: null,
        startupPromise: null
    };

    if (options.serve === true) {
        const initialLiveReloadStatus = await tryFetchGraphVisualizationLiveReloadStatusSnapshot();
        if (initialLiveReloadStatus !== null) {
            activeLiveReloadSession.model = createGraphVisualizationLiveReloadModel(null, initialLiveReloadStatus);
        }
    } else {
        activeContext = await resolveGraphContext(options);
        await ensureGraphIndexForQuery(options, activeContext);
        activeSelectedPaths = [initialSelectedPath ?? activeContext.projectRoot];
        activeVisualizationPayload = readVisualizationPayloadFromContext(activeContext);
        activeProjectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(activeContext, {
            config: options.config
        });
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

    function readVisualizationPayloadFromContext(context: GraphResolutionContext) {
        const activeConfig = Semantic.resolveGraphIndexConfig({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: options.toolsetRoot
        });
        const database = Semantic.openExistingGraphIndexDatabase(activeConfig.databasePath);
        try {
            return Semantic.exportGraphVisualizationData(database, activeConfig.projectRoot);
        } finally {
            database.close();
        }
    }

    async function refreshActiveVisualizationArtifacts(context: GraphResolutionContext | null): Promise<void> {
        if (context === null) {
            activeVisualizationPayload = createEmptyGraphVisualizationData();
            activeProjectConfigurationCatalog = null;
            return;
        }

        activeVisualizationPayload = readVisualizationPayloadFromContext(context);
        activeProjectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(context, {
            config: options.config
        });
    }

    function createLoadedTarget(): GraphVisualizedLoadedTarget {
        const resolvedSelectedPaths = activeSelectedPaths.map(
            (selectedPathValue) => resolveExplicitWorkflowTargetPath(selectedPathValue) ?? selectedPathValue
        );
        const activePath = resolvedSelectedPaths[0] ?? "";
        const projectRoot = activeContext?.projectRoot ?? "";

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

    function updateLiveReloadRuntimeUrlFromProcessOutput(outputChunk: string): void {
        const runtimeMatch = outputChunk.match(/Runtime static server ready at (\S+)/u);
        if (!runtimeMatch) {
            return;
        }

        const runtimeUrl = runtimeMatch[1] ?? null;
        const previousSnapshot = activeLiveReloadSession.model?.statusSnapshot ?? null;
        setActiveGraphVisualizationLiveReloadModel(
            activeLiveReloadSession,
            createGraphVisualizationLiveReloadModel(runtimeUrl, previousSnapshot)
        );
        if (options.serve === true) {
            markServeRevisionChanged();
        }
    }

    async function ensureLiveReloadSessionStarted(
        input: Readonly<{ restart: boolean }>
    ): Promise<GraphVisualizationLiveReloadModel> {
        if (activeContext === null) {
            throw new Error("Open a project before starting live reload.");
        }

        if (activeLiveReloadSession.startupPromise !== null) {
            if (input.restart === false) {
                return activeLiveReloadSession.startupPromise;
            }
            try {
                await activeLiveReloadSession.startupPromise;
            } catch {
                // Ignore startup failures when a restart is explicitly requested.
            }
        }

        if (input.restart) {
            resetGraphVisualizationLiveReloadSessionForRestart(activeLiveReloadSession);
            await stopGraphVisualizationLiveReloadChildProcess(activeLiveReloadSession);
        }

        if (input.restart === false) {
            const existingStatusSnapshot = await tryFetchGraphVisualizationLiveReloadStatusSnapshot();
            if (existingStatusSnapshot !== null) {
                return setActiveGraphVisualizationLiveReloadModel(
                    activeLiveReloadSession,
                    createGraphVisualizationLiveReloadModel(null, existingStatusSnapshot)
                );
            }
        }

        const startupPromise = (async () => {
            const startupOptions = resolveGraphVisualizationLiveReloadStartupOptions(
                activeContext.projectRoot,
                activeContext.projectConfig
            );

            const cliEntrypointPath = resolveGraphVisualizationCliEntrypointPath();
            const childProcess = spawn(
                process.execPath,
                [
                    cliEntrypointPath,
                    ...createGraphVisualizationLiveReloadDevCommandArgs(activeContext.projectRoot, startupOptions)
                ],
                {
                    cwd: process.cwd(),
                    stdio: ["ignore", "pipe", "pipe"]
                }
            );

            activeLiveReloadSession.childProcess = childProcess;
            activeLiveReloadSession.childStderrBuffer = [];
            setActiveGraphVisualizationLiveReloadModel(
                activeLiveReloadSession,
                createGraphVisualizationLiveReloadModel(null)
            );

            childProcess.stdout.on("data", (chunk: Buffer | string) => {
                updateLiveReloadRuntimeUrlFromProcessOutput(String(chunk));
            });
            childProcess.stderr.on("data", (chunk: Buffer | string) => {
                const message = String(chunk).trim();
                if (message.length === 0) {
                    return;
                }
                activeLiveReloadSession.childStderrBuffer.push(message);
                if (activeLiveReloadSession.childStderrBuffer.length > 10) {
                    activeLiveReloadSession.childStderrBuffer.shift();
                }
            });
            childProcess.once("exit", () => {
                activeLiveReloadSession.childProcess = null;
            });

            return await new Promise<GraphVisualizationLiveReloadModel>((resolve, reject) => {
                const timeoutHandle = globalThis.setTimeout(() => {
                    cleanup();
                    void stopGraphVisualizationLiveReloadChildProcess(activeLiveReloadSession);
                    reject(
                        createGraphVisualizationLiveReloadStartupTimeoutError(activeLiveReloadSession.childStderrBuffer)
                    );
                }, GRAPH_VISUALIZATION_LIVE_RELOAD_START_TIMEOUT_MS);

                const cleanup = (): void => {
                    globalThis.clearTimeout(timeoutHandle);
                    childProcess.off("exit", handleExit);
                };

                const handleExit = (code: number | null): void => {
                    cleanup();
                    const stderrMessage = activeLiveReloadSession.childStderrBuffer.join("\n").trim();
                    reject(
                        new Error(
                            stderrMessage.length > 0
                                ? stderrMessage
                                : `Live reload exited before it became ready (exit code ${String(code ?? "unknown")}).`
                        )
                    );
                };

                childProcess.once("exit", handleExit);

                const pollStatus = async (): Promise<void> => {
                    const snapshot = await tryFetchGraphVisualizationLiveReloadStatusSnapshot();
                    if (snapshot !== null) {
                        cleanup();
                        const runtimeUrl = activeLiveReloadSession.model?.endpoints.runtimeUrl ?? null;
                        resolve(
                            setActiveGraphVisualizationLiveReloadModel(
                                activeLiveReloadSession,
                                createGraphVisualizationLiveReloadModel(runtimeUrl, snapshot)
                            )
                        );
                        return;
                    }

                    if (activeLiveReloadSession.childProcess === null) {
                        cleanup();
                        reject(new Error("Live reload stopped before the status server became available."));
                        return;
                    }

                    globalThis.setTimeout(() => {
                        void pollStatus();
                    }, 200);
                };

                void pollStatus();
            });
        })();

        const activeStartupPromise = setActiveGraphVisualizationLiveReloadStartupPromise(
            activeLiveReloadSession,
            startupPromise
        );
        try {
            return await activeStartupPromise;
        } finally {
            clearActiveGraphVisualizationLiveReloadStartupPromise(activeLiveReloadSession);
        }
    }

    if (options.serve === true) {
        const documentationCatalogs = createDocumentationCatalogs();
        let uiWatchRebuildInProgress = false;
        let uiWatchRebuildPending = false;

        const runUiBundleRebuildCycle = async (): Promise<void> => {
            uiWatchRebuildPending = false;
            try {
                await runUiWorkspaceTypeBuildForServe();
                markServeRevisionChanged();
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
                    const startupState = await resolveGraphVisualizationServeStartupState(options, initialSelectedPath);
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
                    activeVisualizationPayload = createEmptyGraphVisualizationData();
                    activeProjectConfigurationCatalog = null;
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

        const server = await startGraphVisualizationServer({
            getUiRevision: () => activeServeRevision,
            regenerate: async () => {
                const previousPayloadString = safeStringifyVisualizationPayload();
                if (!activeContext) {
                    return Object.freeze({ changed: false });
                }
                await ensureGraphIndex({ ...options, force: true }, activeContext);
                await refreshActiveVisualizationArtifacts(activeContext);
                const nextPayloadString = safeStringifyVisualizationPayload();
                markServeRevisionChanged();
                return Object.freeze({ changed: previousPayloadString !== nextPayloadString });
            },
            openProjectTargets: async ({ path: selectedPath }) => {
                activeServeStartupGeneration += 1;
                const previousPayloadString = safeStringifyVisualizationPayload();
                const nextPathFromPicker =
                    selectedPath === null ? await pickProjectPathUsingNativeDialog() : selectedPath;
                if (!nextPathFromPicker) {
                    return Object.freeze({ changed: false });
                }
                const resolvedPathFromPicker =
                    resolveExplicitWorkflowTargetPath(nextPathFromPicker) ?? nextPathFromPicker;
                const nextOptions = {
                    ...options,
                    path: resolvedPathFromPicker
                };
                const nextContext = await resolveGraphContext(nextOptions);
                await ensureGraphIndexForQuery(nextOptions, nextContext);
                activeContext = nextContext;
                activeSelectedPaths = [resolvedPathFromPicker];
                activeSource = "finder-open";
                await refreshActiveVisualizationArtifacts(activeContext);
                activeStartupState = null;
                const nextPayloadString = safeStringifyVisualizationPayload();
                markServeRevisionChanged();
                return Object.freeze({ changed: previousPayloadString !== nextPayloadString });
            },
            runFix: async () => {
                if (!activeContext) {
                    throw new Error("Open a GameMaker project before running fixes.");
                }

                const result = await runGraphVisualizationFixWorkflow(activeContext, options.config);
                await ensureGraphIndex({ ...options, force: true }, activeContext);
                await refreshActiveVisualizationArtifacts(activeContext);
                markServeRevisionChanged();
                return result;
            },
            processPlayground: async ({
                gml,
                formatOptionNames,
                format,
                lint,
                lintRuleIds,
                refactor,
                codemodIds,
                transpileMode
            }) => {
                let ast: string;
                let output = gml;
                let error: string | null = null;

                try {
                    const gmlParser = new Parser.GMLParser(gml);
                    const program = gmlParser.parse();
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
                            activeContext?.projectConfig ?? null
                        );
                    }

                    if (lint) {
                        const eslint = new ESLint({
                            overrideConfigFile: true,
                            fix: true,
                            overrideConfig: createMutableGraphPlaygroundLintConfig(lintRuleIds)
                        });
                        const [result] = await eslint.lintText(output, {
                            filePath: "graph-visualization-playground.gml"
                        });
                        output = result.output ?? output;
                    }

                    if (format) {
                        output = await Format.format(
                            output,
                            createGraphPlaygroundFormatOptions(formatOptionNames, activeContext?.projectConfig ?? null)
                        );
                    }

                    if (transpileMode === "patch") {
                        const transpiler = new Transpiler.GmlTranspiler();
                        const patch = transpiler.transpileScript({
                            sourceText: output,
                            symbolId: "playground-script"
                        });
                        output = patch.js_body;
                    } else if (transpileMode === "expression") {
                        const transpiler = new Transpiler.GmlTranspiler();
                        output = transpiler.transpileExpression(output);
                    }
                } catch (error_) {
                    error = Core.isErrorLike(error_) ? error_.message : String(error_);
                    output = "";
                    ast = "";
                }

                return Object.freeze({ ast, output, error });
            },
            startLiveReload: (input) => ensureLiveReloadSessionStarted(input),
            renderBundle: (isServerMode) => {
                if (isServerMode && activeServeBundleCache?.revision === activeServeRevision) {
                    return activeServeBundleCache.bundle;
                }

                const bundle = UI.renderGraphVisualizationBundle(exportVisualizationPayload(), {
                    documentationCatalogs,
                    isServerMode,
                    liveReload: activeLiveReloadSession.model ?? undefined,
                    loadedTarget: activeSelectedPaths.length > 0 || activeContext ? createLoadedTarget() : undefined,
                    mcpServerStatus: "not-started",
                    projectConfigurationCatalog: activeProjectConfigurationCatalog ?? undefined,
                    startupState: activeStartupState ?? undefined,
                    title: activeContext?.projectRoot ?? "No project loaded"
                });

                if (isServerMode) {
                    activeServeBundleCache = Object.freeze({
                        bundle,
                        revision: activeServeRevision
                    });
                }

                return bundle;
            }
        });

        initializeServeStateInBackground();

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
        const stopLiveReloadChildProcess = (): Promise<void> =>
            stopGraphVisualizationLiveReloadChildProcess(activeLiveReloadSession);
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

            void (async () => {
                try {
                    await Promise.all([server.stop(), stopLiveReloadChildProcess()]);
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
            void stopLiveReloadChildProcess();
        });

        return;
    }

    const activeConfig = resolveActiveConfig();
    if (!activeConfig || !activeContext) {
        throw new Error("Could not locate a GameMaker project root. Pass --path or run inside a project tree.");
    }
    const documentationCatalogs = createDocumentationCatalogs();
    const projectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(activeContext, {
        config: options.config
    });
    const dbPath = activeConfig.databasePath;
    const payload = exportVisualizationPayload();
    const bundleArtifact = UI.renderGraphVisualizationBundle(payload, {
        documentationCatalogs,
        loadedTarget: createLoadedTarget(),
        mcpServerStatus: "not-started",
        projectConfigurationCatalog,
        title: activeConfig.projectRoot
    });
    const outputDirectory = options.output ?? path.join(path.dirname(dbPath), "graph-visualization");
    const exportResult = await writeGraphVisualizationBundleArtifact(bundleArtifact, outputDirectory);

    printGraphOutput(
        createGraphEnvelope("graph visualize", activeContext, options, exportResult),
        options.json === true,
        `Exported graph visualization bundle to ${path.join(outputDirectory, exportResult.entryHtmlPath)}`
    );

    if (options.open) {
        openUrlInDefaultBrowser(path.join(outputDirectory, exportResult.entryHtmlPath));
    }
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
    GRAPH_VISUALIZATION_LIVE_RELOAD_START_TIMEOUT_MS,
    createGraphVisualizationLiveReloadDevCommandArgs,
    isGraphVisualizationUiSourceReloadCandidate,
    normalizeGraphVisualizationUiSourceWatchFileName,
    resolveGraphVisualizationLiveReloadStartupOptions,
    resolveDefaultGraphVisualizationServeTargetPath,
    resolveGraphVisualizationUiSourceWatchRoot,
    startGraphVisualizationUiSourceWatcher
});
function createDocumentationCatalogs() {
    const cliCommands = getCliCommandCatalog();
    const lintCatalogEntryById = new Map(
        Lint.listLintRuleCatalogEntries().map((entry) => [entry.ruleId, entry] as const)
    );
    const semanticIndexCodemodIdSet = new Set(Refactor.listSemanticProjectIndexDependentCodemodIds());

    return Object.freeze({
        cliCommands,
        mcpServer: Object.freeze({
            name: "gmloop-mcp",
            version: "0.0.1"
        }),
        mcpTools: getMcpToolCatalogEntries(),
        workspaceRules: Object.freeze({
            formatOptions: Format.listProjectFormatOptionCatalogEntries().map((entry) =>
                Object.freeze({
                    defaultValue: entry.defaultValue,
                    description: entry.description,
                    name: entry.name
                })
            ),
            lintRules: Lint.listLintRuleCatalogEntries().map((entry) =>
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
