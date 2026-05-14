import { execFile } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { access, constants, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
import { GmlParserBridge, GmlSemanticBridge, GmlTranspilerBridge } from "../modules/refactor/index.js";
import { startGraphVisualizationServer } from "../modules/server/graph-visualization-server.js";
import { openUrlInDefaultBrowser } from "../modules/server/open-url.js";
import { createGraphVisualizationProjectConfigurationCatalog } from "../modules/ui/index.js";
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

type GraphVisualizationBundleFile = Readonly<{
    bytes: Uint8Array;
    contentType: string;
    relativePath: string;
}>;

type GraphVisualizationBundleArtifact = Readonly<{
    entryHtmlPath: string;
    files: ReadonlyArray<GraphVisualizationBundleFile>;
}>;

type OsaScriptExecutionResult = Readonly<{
    stderr: string;
    stdout: string;
}>;

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

function resolveGraphVisualizationUiSourceWatchRoot(): string | null {
    const sourceRoot = path.resolve(process.cwd(), "src/ui/src");
    if (!existsSync(sourceRoot)) {
        return null;
    }

    return sourceRoot;
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
    type GraphServeSource = "cli-path" | "finder-open" | "working-directory";
    type GraphVisualizedLoadedTarget = Readonly<{
        activePath: string;
        projectRoot: string;
        selectedPaths: ReadonlyArray<string>;
        source: GraphServeSource;
    }>;

    const initialSelectedPath = resolveExplicitWorkflowTargetPath(options.path);
    let activeContext: GraphResolutionContext | null = null;
    let activeSelectedPaths = initialSelectedPath ? [initialSelectedPath] : [];
    let activeSource: GraphServeSource = options.path ? "cli-path" : "working-directory";

    if (options.serve === true) {
        if (initialSelectedPath) {
            activeContext = await resolveGraphContext(options);
            await ensureGraphIndexForQuery(options, activeContext);
        } else {
            try {
                activeContext = await resolveGraphContext(options);
                await ensureGraphIndexForQuery(options, activeContext);
                activeSelectedPaths = [activeContext.projectRoot];
            } catch {
                activeContext = null;
                activeSelectedPaths = [];
            }
        }
    } else {
        activeContext = await resolveGraphContext(options);
        await ensureGraphIndexForQuery(options, activeContext);
        activeSelectedPaths = [initialSelectedPath ?? activeContext.projectRoot];
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
        const activeConfig = resolveActiveConfig();
        if (!activeConfig) {
            return Object.freeze({
                edges: [],
                generatedAt: new Date().toISOString(),
                graphs: [],
                nodes: [],
                projectRoot: ""
            });
        }

        const database = Semantic.openExistingGraphIndexDatabase(activeConfig.databasePath);
        try {
            return Semantic.exportGraphVisualizationData(database, activeConfig.projectRoot);
        } finally {
            database.close();
        }
    }

    function safeStringifyVisualizationPayload(): string {
        try {
            return JSON.stringify(exportVisualizationPayload());
        } catch {
            return "";
        }
    }

    if (options.serve === true) {
        const documentationCatalogs = createDocumentationCatalogs();
        let uiRevision = 0;
        let uiWatchRebuildInProgress = false;
        let uiWatchRebuildPending = false;

        const runUiBundleRebuildCycle = async (): Promise<void> => {
            uiWatchRebuildPending = false;
            try {
                await runUiWorkspaceTypeBuildForServe();
                uiRevision += 1;
                console.log(`[graph visualize] UI source changed. Reload revision: ${String(uiRevision)}`);
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
        const uiSourceWatcher =
            options.liveReload === false || uiSourceWatchRoot === null
                ? null
                : watch(uiSourceWatchRoot, { recursive: true }, (_eventType, fileName) => {
                      if (!isGraphVisualizationUiSourceReloadCandidate(fileName)) {
                          return;
                      }
                      if (uiWatchDebounceTimer !== null) {
                          globalThis.clearTimeout(uiWatchDebounceTimer);
                      }
                      uiWatchDebounceTimer = globalThis.setTimeout(() => {
                          triggerUiBundleRebuild();
                      }, 300);
                  });

        const server = await startGraphVisualizationServer({
            getUiRevision: () => uiRevision,
            regenerate: async () => {
                const previousPayloadString = safeStringifyVisualizationPayload();
                if (!activeContext) {
                    return Object.freeze({ changed: false });
                }
                await ensureGraphIndex({ ...options, force: true }, activeContext);
                const nextPayloadString = JSON.stringify(exportVisualizationPayload());
                return Object.freeze({ changed: previousPayloadString !== nextPayloadString });
            },
            openProjectTargets: async ({ path: selectedPath }) => {
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
                const nextPayloadString = JSON.stringify(exportVisualizationPayload());
                return Object.freeze({ changed: previousPayloadString !== nextPayloadString });
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
            renderBundle: async (isServerMode) => {
                const projectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(
                    activeContext,
                    {
                        config: options.config
                    }
                );

                return UI.renderGraphVisualizationBundle(exportVisualizationPayload(), {
                    documentationCatalogs,
                    isServerMode,
                    loadedTarget: activeSelectedPaths.length > 0 || activeContext ? createLoadedTarget() : undefined,
                    mcpServerStatus: "not-started",
                    projectConfigurationCatalog,
                    title: activeContext?.projectRoot ?? "No project loaded"
                });
            }
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

        if (uiSourceWatcher) {
            process.once("SIGINT", () => uiSourceWatcher.close());
            process.once("SIGTERM", () => uiSourceWatcher.close());
        }

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
    isGraphVisualizationUiSourceReloadCandidate,
    resolveGraphVisualizationUiSourceWatchRoot
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
