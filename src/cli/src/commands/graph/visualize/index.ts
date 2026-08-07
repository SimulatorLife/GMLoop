import { type ChildProcessWithoutNullStreams, execFile } from "node:child_process";
import { existsSync, type FSWatcher } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Semantic } from "@gmloop/semantic";
import { UI } from "@gmloop/ui";
import { ESLint } from "eslint";

import * as AgentPack from "../../../modules/auto-game-agent-pack/index.js";
import { setAutoGameProjectSkillEnabled } from "../../../modules/auto-game-skills/index.js";
import { readProjectOperationState } from "../../../modules/runtime/project-operation-state.js";
import {
    type GraphVisualizationServerPlaygroundFixture,
    openUrlInDefaultBrowser,
    startGraphVisualizationServer
} from "../../../modules/server/graph-visualization-server.js";
import { createGmlParserAdapter, createGmlTranspilerAdapter } from "../../../modules/transpilation/adapters.js";
import {
    createDefaultGmloopProjectConfig,
    createGraphVisualizationProjectConfigurationCatalog
} from "../../../modules/ui/index.js";
import { findRepoRootSync } from "../../../shared/repo-root.js";
import { validateGameMakerProjectFilePath } from "../../../workflow/project-file-validation.js";
import {
    resolveExplicitWorkflowTargetPath,
    writeGameMakerCliActiveProjectState
} from "../../../workflow/project-root.js";
import {
    ensureGraphIndexForQuery,
    type GraphCommandSharedOptions,
    type GraphResolutionContext,
    printGraphOutput,
    resolveGraphContext
} from "../shared.js";
import {
    type AutoGamePipelineModel,
    createAutoGamePipelineModel,
    createAutoGamePipelineModelForProject
} from "./auto-game-pipeline.js";
import { createDocumentationCatalogs } from "./catalog.js";
import {
    ensureGraphIndexForServe,
    runGraphVisualizationProjectWorkflow,
    SEMANTIC_INDEX_OPERATION_KIND
} from "./child-process.js";
import { pickProjectPathUsingNativeDialog } from "./dialog.js";
import {
    createGraphVisualizationLiveReloadSessionState,
    ensureGraphVisualizationLiveReloadSession,
    stopGraphVisualizationLiveReloadSession,
    stopOwnedGraphVisualizationLiveReloadSession
} from "./live-reload.js";
import {
    applySelectedPlaygroundCodemods,
    createGraphPlaygroundFormatOptions,
    createMutableGraphPlaygroundLintConfig,
    parsePlaygroundFixtureConfig
} from "./playground.js";
import { resolveGraphVisualizationServeStartupState } from "./serve-target.js";
import {
    createEmptyGraphVisualizationData,
    createGraphVisualizationServeErrorState,
    createGraphVisualizationServeLoadingState
} from "./state.js";
import { runGraphVisualizationStaticExportMode } from "./static-export.js";
import type {
    GraphServeSource,
    GraphVisualizationActiveProjectStateWatcher,
    GraphVisualizationLiveReloadSessionState,
    GraphVisualizationProjectWorkflow,
    GraphVisualizationServeBackgroundState,
    GraphVisualizationServeBundleCache,
    GraphVisualizationServePayload,
    GraphVisualizedLoadedTarget
} from "./types.js";
import {
    isGraphVisualizationUiSourceReloadCandidate,
    normalizeGraphVisualizationUiSourceWatchFileName,
    resolveGraphVisualizationUiSourceWatchRoot,
    startGraphVisualizationActiveProjectStateWatcher,
    startGraphVisualizationFeatherMetadataWatcher,
    startGraphVisualizationUiSourceWatcher
} from "./watchers.js";

type GraphVisualizationProjectConfigurationCatalog = Awaited<
    ReturnType<typeof createGraphVisualizationProjectConfigurationCatalog>
>;

/**
 * Render a one-shot `graph visualize` export bundle to disk, or run a long-lived
 * visualization server that re-renders as projects change.
 *
 * The action wires together every visualization concern (graph indexing,
 * live-reload session lifecycle, watchers, the playground, the fix workflow,
 * and the serve/static-export dispatcher) but delegates each concrete step to
 * a focused helper module under `./`. State that the serve orchestrator needs
 * across phases lives in a single {@link GraphVisualizationServeController}
 * instance so the inner serve-mode closures can share it without recreating
 * the closure graph on every helper.
 */
async function runGraphVisualizeAction(options: GraphCommandSharedOptions): Promise<void> {
    const initialSelectedPath = resolveExplicitWorkflowTargetPath(options.path);
    const controller = new GraphVisualizationServeController(options, initialSelectedPath);

    if (options.serve !== true) {
        await controller.initializeStaticExportState();
        await runGraphVisualizationStaticExportMode(controller.buildStaticExportInput());
        return;
    }

    await controller.runServeMode();
}

class GraphVisualizationServeController {
    readonly #options: GraphCommandSharedOptions;

    readonly #initialSelectedPath: string | null;

    #activeContext: GraphResolutionContext | null = null;

    #activeSelectedPaths: Array<string>;

    #activeSource: GraphServeSource;

    #activeVisualizationPayload: GraphVisualizationServePayload = createEmptyGraphVisualizationData();

    #activeProjectConfigurationCatalog: GraphVisualizationProjectConfigurationCatalog | null = null;

    #activeAutoGamePipeline: AutoGamePipelineModel | null = null;

    #activeStartupState: GraphVisualizationServeBackgroundState | null;

    #activeServeStartupGeneration = 0;

    #activeServeRevision = 0;

    #activeServeBundleCache: GraphVisualizationServeBundleCache | null = null;

    #activeLastFixRun: Readonly<{ logLines: ReadonlyArray<string>; projectRoot: string; status: "success" }> | null =
        null;

    #activeFixProgressLogLines = new Array<string>();

    #isFixWorkflowRunning = false;

    #activeFixWorkflow: GraphVisualizationProjectWorkflow | null = null;

    #activeFixChildProcess: ChildProcessWithoutNullStreams | null = null;

    #isFixCancelRequested = false;

    readonly #activeLiveReloadSession: GraphVisualizationLiveReloadSessionState =
        createGraphVisualizationLiveReloadSessionState();

    constructor(options: GraphCommandSharedOptions, initialSelectedPath: string | null) {
        this.#options = options;
        this.#initialSelectedPath = initialSelectedPath;
        this.#activeSelectedPaths = initialSelectedPath ? [initialSelectedPath] : [];
        this.#activeSource = options.path ? "cli-path" : "working-directory";
        this.#activeStartupState =
            options.serve === true ? createGraphVisualizationServeLoadingState("Loading project data…", null) : null;
    }

    async initializeStaticExportState(): Promise<void> {
        const context = await resolveGraphContext(this.#options);
        await ensureGraphIndexForQuery(this.#options, context);
        this.#activeContext = context;
        this.#activeSelectedPaths = [this.#initialSelectedPath ?? context.projectRoot];
        this.#activeVisualizationPayload = this.#readVisualizationPayloadFromContext(context);
        this.#activeProjectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(context, {
            config: this.#options.config
        });
        this.#activeAutoGamePipeline = await createAutoGamePipelineModelForProject(context);
    }

    buildStaticExportInput() {
        return {
            autoGamePipeline: this.#activeAutoGamePipeline,
            context: this.#activeContext,
            loadedTarget: this.#createLoadedTarget(),
            options: this.#options,
            payload: this.#activeVisualizationPayload,
            projectConfigurationCatalog: this.#activeProjectConfigurationCatalog
        } as const;
    }

    async runServeMode(): Promise<void> {
        await this.#runServeVisualizationMode();
    }

    #resolveActiveConfig() {
        if (!this.#activeContext) {
            return null;
        }

        return Semantic.resolveGraphIndexConfig({
            databasePath: this.#options.databasePath,
            projectConfig: this.#activeContext.projectConfig,
            projectRoot: this.#activeContext.projectRoot,
            toolsetRoot: this.#options.toolsetRoot
        });
    }

    #markServeRevisionChanged(): void {
        this.#activeServeRevision += 1;
        this.#activeServeBundleCache = null;
    }

    #cacheServeBundleForRevision(revision: number, bundle: GraphVisualizationServeBundleCache["bundle"]): void {
        if (this.#activeServeRevision !== revision) {
            return;
        }

        this.#activeServeBundleCache = Object.freeze({
            bundle,
            revision
        });
    }

    #initializeServeStateInBackground(): void {
        this.#activeServeStartupGeneration += 1;
        const startupGeneration = this.#activeServeStartupGeneration;
        void (async () => {
            try {
                const startupState = await resolveGraphVisualizationServeStartupState(
                    this.#options,
                    this.#initialSelectedPath,
                    (target) => {
                        if (startupGeneration !== this.#activeServeStartupGeneration) {
                            return;
                        }
                        // Publish the startup target before the semantic
                        // build so progress endpoints can resolve the
                        // project's shared operation state immediately.
                        this.#activeSelectedPaths = [...target.selectedPaths];
                        this.#activeSource = target.source;
                    }
                );
                if (startupGeneration !== this.#activeServeStartupGeneration) {
                    return;
                }

                const resolvedContext = startupState.context;
                this.#activeContext = resolvedContext;
                this.#activeSelectedPaths = startupState.selectedPaths;
                this.#activeSource = startupState.source;
                await this.#refreshActiveVisualizationArtifacts(resolvedContext);
                if (startupGeneration !== this.#activeServeStartupGeneration) {
                    return;
                }
                this.#activeStartupState = null;
            } catch (error) {
                if (startupGeneration !== this.#activeServeStartupGeneration) {
                    return;
                }

                this.#activeContext = null;
                await this.#refreshActiveVisualizationArtifacts(null);
                this.#activeStartupState = createGraphVisualizationServeErrorState(
                    "Failed to load the initial project.",
                    Core.getErrorMessage(error, { fallback: "Unknown graph visualization startup error" })
                );
                console.error(
                    `[graph visualize] Initial project load failed: ${Core.getErrorMessage(error, {
                        fallback: "Unknown graph visualization startup error"
                    })}`
                );
            } finally {
                if (startupGeneration === this.#activeServeStartupGeneration) {
                    this.#markServeRevisionChanged();
                }
            }
        })();
    }

    #readVisualizationPayloadFromContext(context: GraphResolutionContext): GraphVisualizationServePayload {
        const activeConfig = Semantic.resolveGraphIndexConfig({
            databasePath: this.#options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            toolsetRoot: this.#options.toolsetRoot
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

    async #refreshActiveVisualizationArtifacts(
        context: GraphResolutionContext | null,
        isCurrent: () => boolean = () => true
    ): Promise<void> {
        if (context === null) {
            const projectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(null, {
                config: this.#options.config
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
            this.#activeVisualizationPayload = createEmptyGraphVisualizationData();
            this.#activeProjectConfigurationCatalog = projectConfigurationCatalog;
            this.#activeAutoGamePipeline = autoGamePipeline;
            return;
        }

        const visualizationPayload = this.#readVisualizationPayloadFromContext(context);
        const projectConfigurationCatalog = await createGraphVisualizationProjectConfigurationCatalog(context, {
            config: this.#options.config
        });
        if (!isCurrent()) {
            return;
        }
        const autoGamePipeline = await createAutoGamePipelineModelForProject(context);
        if (!isCurrent()) {
            return;
        }
        this.#activeVisualizationPayload = visualizationPayload;
        this.#activeProjectConfigurationCatalog = projectConfigurationCatalog;
        this.#activeAutoGamePipeline = autoGamePipeline;
    }

    #createLoadedTarget(): GraphVisualizedLoadedTarget {
        const resolvedSelectedPaths = this.#activeSelectedPaths.map(
            (selectedPathValue) => resolveExplicitWorkflowTargetPath(selectedPathValue) ?? selectedPathValue
        );
        const activePath = resolvedSelectedPaths[0] ?? "";
        const projectRoot = this.#activeContext?.projectRoot ?? resolvedSelectedPaths[0] ?? "";

        return Object.freeze({
            activePath,
            projectRoot,
            selectedPaths: resolvedSelectedPaths,
            source: this.#activeSource
        });
    }

    #safeStringifyVisualizationPayload(): string {
        try {
            return JSON.stringify(this.#activeVisualizationPayload);
        } catch {
            return "";
        }
    }

    #resetActiveProjectScopedServeState(): void {
        this.#activeLastFixRun = null;
    }

    async #ensureLiveReloadSessionStarted(
        input: Readonly<{ restart: boolean }>
    ): Promise<GraphVisualizationServeControllerLiveReloadModel> {
        const startupContext = this.#activeContext;
        if (startupContext === null) {
            throw new Error("Open a project before starting live reload.");
        }

        return await ensureGraphVisualizationLiveReloadSession(this.#activeLiveReloadSession, {
            projectConfig: startupContext.projectConfig,
            projectRoot: startupContext.projectRoot,
            restart: input.restart
        });
    }

    async #runServeVisualizationMode(): Promise<void> {
        const renderServeBundle = async (
            isServerMode: boolean
        ): Promise<GraphVisualizationServeBundleCache["bundle"]> => {
            Core.clearFeatherMetadataCache();

            const renderRevision = this.#activeServeRevision;
            if (isServerMode && this.#activeServeBundleCache?.revision === renderRevision) {
                return this.#activeServeBundleCache.bundle;
            }

            const freshDocumentationCatalogs = createDocumentationCatalogs();

            const bundle = await UI.renderGraphVisualizationBundle(this.#activeVisualizationPayload, {
                autoGamePipeline: this.#activeAutoGamePipeline ?? undefined,
                documentationCatalogs: freshDocumentationCatalogs,
                isServerMode,
                lastFixRun: this.#activeLastFixRun ?? undefined,
                liveReload: this.#activeLiveReloadSession.model ?? undefined,
                loadedTarget:
                    this.#activeSelectedPaths.length > 0 || this.#activeContext
                        ? this.#createLoadedTarget()
                        : undefined,
                mcpServerStatus: "not-started",
                projectConfigurationCatalog: this.#activeProjectConfigurationCatalog ?? undefined,
                startupState: this.#activeStartupState ?? undefined,
                title: this.#activeContext?.projectRoot ?? "No project loaded"
            });

            if (isServerMode) {
                this.#cacheServeBundleForRevision(renderRevision, bundle);
            }

            return bundle;
        };

        const repoRoot = findRepoRootSync(path.dirname(fileURLToPath(import.meta.url)));
        const featherMetadataPath = path.resolve(repoRoot, "resources/feather-metadata.json");
        let featherMetadataWatcher: ReturnType<typeof startGraphVisualizationFeatherMetadataWatcher> | null = null;
        if (existsSync(featherMetadataPath)) {
            featherMetadataWatcher = startGraphVisualizationFeatherMetadataWatcher({
                featherMetadataPath,
                onChanged: async () => {
                    Core.clearFeatherMetadataCache();
                    try {
                        await this.#refreshActiveVisualizationArtifacts(this.#activeContext);
                        this.#markServeRevisionChanged();
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
                this.#markServeRevisionChanged();
                await renderServeBundle(true);
                console.log(
                    `[graph visualize] UI source changed. Reload revision: ${String(this.#activeServeRevision)}`
                );
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
        if (this.#options.liveReload !== false && uiSourceWatchRoot !== null) {
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

        const openProjectTargetPath = (
            selectedPath: string,
            source: GraphServeSource
        ): Readonly<{ changed: boolean; projectChanged: boolean }> => {
            this.#activeServeStartupGeneration += 1;
            const startupGeneration = this.#activeServeStartupGeneration;
            const previousPayloadString = this.#safeStringifyVisualizationPayload();
            const resolvedSelectedPath = resolveExplicitWorkflowTargetPath(selectedPath) ?? selectedPath;
            const previousSelectedPath = this.#activeSelectedPaths[0] ?? null;
            const previousProjectRoot = this.#activeContext?.projectRoot ?? null;
            const projectChanged = previousProjectRoot !== resolvedSelectedPath;
            const nextOptions = {
                ...this.#options,
                path: resolvedSelectedPath
            };

            // Publish the selected target and loading state before any semantic
            // work. The next document render can therefore update the open
            // widget immediately while the graph-dependent surfaces stay in a
            // scoped loading state.
            this.#activeContext = null;
            this.#activeSelectedPaths = [resolvedSelectedPath];
            this.#activeSource = source;
            this.#activeVisualizationPayload = createEmptyGraphVisualizationData();
            this.#activeProjectConfigurationCatalog = null;
            this.#activeAutoGamePipeline = null;
            this.#activeStartupState = createGraphVisualizationServeLoadingState("Loading project data…", null);
            if (projectChanged) {
                this.#resetActiveProjectScopedServeState();
            }
            this.#markServeRevisionChanged();

            setImmediate(() => {
                void (async () => {
                    try {
                        if (source !== "active-project-state") {
                            try {
                                await writeGameMakerCliActiveProjectState({
                                    env: process.env,
                                    projectPath: resolvedSelectedPath,
                                    statePathOption: this.#options.projectState
                                });
                            } catch (error) {
                                console.error(
                                    `[graph visualize] Failed to write active project state: ${Core.getErrorMessage(error)}`
                                );
                            }
                        }

                        if (projectChanged) {
                            await stopOwnedGraphVisualizationLiveReloadSession(
                                this.#activeLiveReloadSession,
                                previousProjectRoot
                            );
                        }

                        const nextContext = await resolveGraphContext(nextOptions);
                        if (startupGeneration !== this.#activeServeStartupGeneration) {
                            return;
                        }
                        await ensureGraphIndexForServe(nextOptions, nextContext, false);
                        if (startupGeneration !== this.#activeServeStartupGeneration) {
                            return;
                        }

                        this.#activeContext = nextContext;
                        await this.#refreshActiveVisualizationArtifacts(
                            nextContext,
                            () => startupGeneration === this.#activeServeStartupGeneration
                        );
                        if (startupGeneration !== this.#activeServeStartupGeneration) {
                            return;
                        }
                        this.#activeStartupState = null;
                    } catch (error) {
                        if (startupGeneration !== this.#activeServeStartupGeneration) {
                            return;
                        }

                        this.#activeContext = null;
                        this.#activeVisualizationPayload = createEmptyGraphVisualizationData();
                        this.#activeProjectConfigurationCatalog = null;
                        this.#activeAutoGamePipeline = null;
                        this.#activeStartupState = createGraphVisualizationServeErrorState(
                            "Failed to load the selected project.",
                            Core.getErrorMessage(error, { fallback: "Unknown project loading error" })
                        );
                    } finally {
                        if (startupGeneration === this.#activeServeStartupGeneration) {
                            this.#markServeRevisionChanged();
                        }
                    }
                })();
            });

            return Object.freeze({
                changed:
                    previousPayloadString !== this.#safeStringifyVisualizationPayload() ||
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
                                const [inputGml, expectedGml] = await Promise.all([
                                    readFile(inputFilePath, "utf8"),
                                    existsSync(expectedFilePath)
                                        ? readFile(expectedFilePath, "utf8")
                                        : Promise.resolve(null)
                                ]);

                                let config: Record<string, unknown> = {};
                                if (existsSync(configPath)) {
                                    let source: string;
                                    try {
                                        source = await readFile(configPath, "utf8");
                                    } catch (error) {
                                        console.warn(
                                            `[graph visualize] Skipping playground fixture "${fixtureRoot.kind}/${caseId}": ` +
                                                `failed to read gmloop.json (${Core.getErrorMessage(error)}).`
                                        );
                                        return null;
                                    }
                                    try {
                                        config = parsePlaygroundFixtureConfig(source, configPath);
                                    } catch (error) {
                                        console.warn(
                                            `[graph visualize] Skipping playground fixture "${fixtureRoot.kind}/${caseId}": ${Core.getErrorMessage(error)}`
                                        );
                                        return null;
                                    }
                                }

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
                return discoveredFixtureGroups
                    .flat()
                    .filter((fixture): fixture is GraphVisualizationServerPlaygroundFixture => fixture !== null);
            } catch (error) {
                console.error("Failed to discover playground fixtures:", error);
                return [];
            }
        };

        const writeActiveProjectConfig = async (config: Readonly<Record<string, unknown>>) => {
            const projectRoot = this.#activeContext?.projectRoot ?? process.cwd();
            const configPath = path.join(projectRoot, "gmloop.json");
            await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
            const nextContext = await resolveGraphContext({
                ...this.#options,
                path: projectRoot
            });
            this.#activeContext = nextContext;
            await this.#refreshActiveVisualizationArtifacts(nextContext);
            this.#markServeRevisionChanged();
            return Object.freeze({ changed: true });
        };

        const server = await startGraphVisualizationServer({
            getUiRevision: () => this.#activeServeRevision,
            getPlaygroundFixtures: discoverPlaygroundFixtures,
            regenerate: async () => {
                const previousPayloadString = this.#safeStringifyVisualizationPayload();
                if (!this.#activeContext) {
                    return Object.freeze({ changed: false });
                }
                await ensureGraphIndexForServe(this.#options, this.#activeContext, true);
                await this.#refreshActiveVisualizationArtifacts(this.#activeContext);
                const nextPayloadString = this.#safeStringifyVisualizationPayload();
                this.#markServeRevisionChanged();
                return Object.freeze({ changed: previousPayloadString !== nextPayloadString });
            },
            createConfig: () => {
                return writeActiveProjectConfig(createDefaultGmloopProjectConfig());
            },
            saveConfig: ({ config }) => {
                return writeActiveProjectConfig(config);
            },
            initializeAutoGameAgentPack: async ({ agentTargets, includeGitIgnore, includeVSCode }) => {
                if (!this.#activeContext) {
                    throw new Error("Open a GameMaker project before initializing the Auto-Game agent pack.");
                }
                const result = await AgentPack.initializeAgentPack(this.#activeContext.projectRoot, {
                    agentTargets,
                    includeGitIgnore,
                    includeVSCode
                });
                await this.#refreshActiveVisualizationArtifacts(this.#activeContext);
                this.#markServeRevisionChanged();
                return Object.freeze({ changed: result.changed });
            },
            setAutoGameSkillEnabled: async ({ enabled, name }) => {
                if (!this.#activeContext) {
                    throw new Error("Open a GameMaker project before changing Auto-Game skills.");
                }
                const projectConfig = await setAutoGameProjectSkillEnabled(
                    this.#activeContext.projectRoot,
                    name,
                    enabled
                );
                this.#activeContext = Object.freeze({ ...this.#activeContext, projectConfig });
                await this.#refreshActiveVisualizationArtifacts(this.#activeContext);
                this.#markServeRevisionChanged();
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
                if (!this.#activeContext) {
                    throw new Error("Open a GameMaker project before running fixes.");
                }

                this.#activeFixProgressLogLines = [];
                this.#activeFixWorkflow = workflow;
                this.#isFixWorkflowRunning = true;
                this.#isFixCancelRequested = false;
                try {
                    const result = await runGraphVisualizationProjectWorkflow(
                        this.#activeContext,
                        this.#options.config,
                        workflow,
                        (logLine) => {
                            this.#activeFixProgressLogLines.push(logLine);
                        },
                        (childProcess) => {
                            this.#activeFixChildProcess = childProcess;
                        }
                    );
                    this.#activeLastFixRun = Object.freeze({
                        logLines: result.logLines,
                        projectRoot: this.#activeContext.projectRoot,
                        status: "success"
                    });
                    this.#activeFixProgressLogLines.push("Rebuilding SQLite graph index database...");
                    await ensureGraphIndexForServe(this.#options, this.#activeContext, true);
                    this.#activeFixProgressLogLines.push("Refreshing graph visualization artifacts...");
                    await this.#refreshActiveVisualizationArtifacts(this.#activeContext);
                    this.#activeFixProgressLogLines.push("Fix workflow post-processing complete.");
                    this.#markServeRevisionChanged();
                    return result;
                } catch (error) {
                    if (this.#isFixCancelRequested) {
                        const cancelledMessage = "Fix workflow was cancelled.";
                        this.#activeFixProgressLogLines.push(cancelledMessage);
                        throw new Error(cancelledMessage, { cause: error });
                    }
                    throw error;
                } finally {
                    this.#isFixWorkflowRunning = false;
                    this.#activeFixWorkflow = null;
                    this.#activeFixChildProcess = null;
                }
            },
            // This never awaits anything internally (killing the child process is
            // synchronous), so it stays a plain function returning a resolved promise
            // instead of `async`, satisfying both the `GraphVisualizationServerCancelFix`
            // contract and the require-await lint rule.
            cancelFix: () => {
                if (!this.#isFixWorkflowRunning || this.#activeFixChildProcess === null) {
                    return Promise.resolve(Object.freeze({ cancelled: false }));
                }

                this.#isFixCancelRequested = true;
                this.#activeFixProgressLogLines.push("Cancelling fix workflow...");
                this.#activeFixChildProcess.kill("SIGTERM");
                return Promise.resolve(Object.freeze({ cancelled: true }));
            },
            getFixProgress: () => {
                const localProgress = Object.freeze({
                    isRunning: this.#isFixWorkflowRunning,
                    logLines: Object.freeze([...this.#activeFixProgressLogLines]),
                    status: this.#isFixWorkflowRunning ? "running" : (this.#activeLastFixRun?.status ?? "idle"),
                    workflow: this.#activeFixWorkflow ?? undefined
                });
                if (localProgress.isRunning || this.#activeContext === null) {
                    return localProgress;
                }

                const sharedState = readProjectOperationState(this.#activeContext.projectRoot);
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
            },
            getSemanticIndexProgress: () => {
                const progressProjectRoot = this.#activeContext?.projectRoot ?? this.#createLoadedTarget().projectRoot;
                if (progressProjectRoot === "") {
                    return Object.freeze({
                        current: null,
                        isRunning: false,
                        logLines: Object.freeze([]),
                        operationId: null,
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
                        operationId: null,
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
                    // Identifies which build this snapshot describes. A different
                    // process (e.g. the LSP driving a background Tier 2 build for
                    // the same project) can start and finish a build between two
                    // polls; without a stable id the client can only detect
                    // completion by observing a running->success transition itself,
                    // which silently misses builds it never saw running.
                    operationId: operation.id,
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
                this.#activeFixProgressLogLines = [];
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
                let ast = "";
                let output = gml;
                let error: string | null = null;

                try {
                    let projectConfig = this.#activeContext?.projectConfig ?? null;
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
                            if (key === "parent" || key === "sourceRange") {
                                return;
                            }
                            return value;
                        },
                        2
                    );

                    if (refactor) {
                        output = await applySelectedPlaygroundCodemods(
                            output,
                            codemodIds,
                            this.#activeContext?.projectRoot ?? process.cwd(),
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
                }

                return Object.freeze({ ast, output, error });
            },
            startLiveReload: async (input) => {
                const liveReload = await this.#ensureLiveReloadSessionStarted(input);
                this.#markServeRevisionChanged();
                return liveReload;
            },
            stopLiveReload: async () => {
                await stopGraphVisualizationLiveReloadSession(
                    this.#activeLiveReloadSession,
                    this.#activeContext?.projectRoot ?? null
                );
                this.#markServeRevisionChanged();
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

        this.#initializeServeStateInBackground();
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
                statePathOption: this.#options.projectState
            });

        printGraphOutput(
            {
                command: "graph visualize",
                databasePath: this.#resolveActiveConfig()?.databasePath ?? "",
                ok: true,
                payload: { url: server.url },
                projectRoot: this.#activeContext?.projectRoot ?? "",
                toolsetRoot: this.#resolveActiveConfig()?.toolsetRoot ?? null
            },
            this.#options.json === true,
            `Serving graph visualization at ${server.url}`
        );
        if (this.#options.open) {
            openUrlInDefaultBrowser(server.url);
        }

        let serveShutdownInProgress = false;
        const stopOwnedLiveReloadSession = (): Promise<void> =>
            stopOwnedGraphVisualizationLiveReloadSession(
                this.#activeLiveReloadSession,
                this.#activeContext?.projectRoot ?? null
            );
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
}

type GraphVisualizationServeControllerLiveReloadModel = Awaited<
    ReturnType<typeof ensureGraphVisualizationLiveReloadSession>
>;

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

export { runGraphVisualizeAction };
