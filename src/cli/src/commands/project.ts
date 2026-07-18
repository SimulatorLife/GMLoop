import { access, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";
import { Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import * as AgentPack from "../modules/auto-game-agent-pack/index.js";
import { discoverAutoGameProjectSkills } from "../modules/auto-game-skills/index.js";
import { loadGameMakerCliCompanionCatalog } from "../modules/game-maker-cli/index.js";
import {
    getRunnerStateStore,
    readArtifactJson,
    resolveArtifactDirectory,
    type RunnerProjectBinder,
    type RunnerSnapshotReader,
    runSemanticIndexOperation
} from "../modules/runtime/index.js";
import { discoverProjectRoot, printProjectPayload, resolveCommandProjectContext } from "../workflow/project-root.js";

type ProjectCacheCleanOptions = Readonly<{
    config?: string;
    databasePath?: string;
    force?: boolean;
    ide?: boolean;
    json?: boolean;
    path?: string;
    project?: boolean;
    runner?: boolean;
    toolsetRoot?: string;
}>;

type ProjectReadinessOptions = Readonly<{
    config?: string;
    databasePath?: string;
    json?: boolean;
    path?: string;
    toolsetRoot?: string;
}>;

type ProjectEvidenceStatus = "fail" | "pass" | "unknown" | "warn";

type ProjectEvidenceRecord = Readonly<{
    artifacts: ReadonlyArray<string>;
    diagnostics: ReadonlyArray<string>;
    kind: string;
    nextActions: ReadonlyArray<string>;
    source: string;
    status: ProjectEvidenceStatus;
    summary: string;
}>;

type ProjectReadinessInspection = Readonly<{
    agentPack: Awaited<ReturnType<typeof AgentPack.readAgentPackProjectStatus>>;
    configuredOfficialMcp: Readonly<{
        available: boolean;
        serverId: string | null;
        sourcePath: string | null;
    }>;
    evidence: ReadonlyArray<ProjectEvidenceRecord>;
    gmCli: Readonly<{
        available: boolean;
        cliLeafCount: number;
        error: string | null;
        invocation: string | null;
        mcpToolCount: number;
        version: string | null;
    }>;
    gmloopConfig: Readonly<{
        path: string;
        present: boolean;
    }>;
    graph: Readonly<{
        databasePath: string | null;
        graphIds: ReadonlyArray<string>;
        ok: boolean;
        resourceKinds: Readonly<Record<string, number>>;
    }>;
    projectRoot: string;
    resources: Readonly<{
        count: number;
        manifestPath: string;
        resourceKinds: Readonly<Record<string, number>>;
    }>;
    skills: ReadonlyArray<Awaited<ReturnType<typeof discoverAutoGameProjectSkills>>[number]>;
    yypPath: string;
}>;

type PersistedTestRunSummary = Readonly<{
    exitCode: number;
    failed: number;
    passed: number;
    skipped: number;
}>;

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await access(filePath);
        return true;
    } catch {
        return false;
    }
}

function incrementCount(counts: Record<string, number>, key: string): void {
    counts[key] = (counts[key] ?? 0) + 1;
}

function readResourceKindFromPath(resourcePath: string): string {
    const [resourceDirectory] = resourcePath.split("/");
    return resourceDirectory && resourceDirectory.length > 0 ? resourceDirectory : "unknown";
}

async function collectGmlFilePaths(directory: string): Promise<ReadonlyArray<string>> {
    const entries = await Core.safeReaddirDirent({ readDir: readdir }, directory);
    const nested = await Promise.all(
        entries.map(async (entry) => {
            if (
                entry.name === ".git" ||
                entry.name === ".gmloop" ||
                entry.name === "node_modules" ||
                entry.name === "dist"
            ) {
                return [] as Array<string>;
            }
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return [...(await collectGmlFilePaths(absolutePath))];
            }
            return entry.isFile() && entry.name.toLowerCase().endsWith(".gml") ? [absolutePath] : [];
        })
    );
    return Object.freeze(nested.flat().sort((left, right) => left.localeCompare(right)));
}

async function collectParseEvidence(projectRoot: string): Promise<ProjectEvidenceRecord> {
    const gmlFilePaths = await collectGmlFilePaths(projectRoot);
    const diagnosticResults = await Promise.all(
        gmlFilePaths.map(async (filePath) => {
            try {
                const sourceText = await Core.readTextFile(filePath);
                Parser.GMLParser.parse(sourceText);
                return null;
            } catch (error) {
                return `${path.relative(projectRoot, filePath)}: ${Core.getErrorMessage(error)}`;
            }
        })
    );
    const diagnostics = diagnosticResults.filter((diagnostic): diagnostic is string => diagnostic !== null);

    return Object.freeze({
        artifacts: [],
        diagnostics: Object.freeze(diagnostics),
        kind: "parse",
        nextActions: diagnostics.length === 0 ? [] : ["Fix GML parse diagnostics before build or runtime proof."],
        source: "@gmloop/parser",
        status: diagnostics.length === 0 ? "pass" : "fail",
        summary: `${String(gmlFilePaths.length)} GML file(s) parsed.`
    });
}

async function collectTestEvidence(projectRoot: string): Promise<ProjectEvidenceRecord> {
    const latestPath = path.join(resolveArtifactDirectory(projectRoot, "test"), "latest.json");
    const latest = await readArtifactJson<PersistedTestRunSummary>(latestPath);
    if (latest === null) {
        return Object.freeze({
            artifacts: [],
            diagnostics: ["No persisted GMLoop test result artifact was found."],
            kind: "test-results",
            nextActions: ["Run the relevant test command and capture fresh results."],
            source: "gmloop test",
            status: "unknown",
            summary: "No test result evidence is available."
        });
    }

    return Object.freeze({
        artifacts: Object.freeze([latestPath]),
        diagnostics: Object.freeze(latest.failed > 0 ? [`${String(latest.failed)} test(s) failed.`] : []),
        kind: "test-results",
        nextActions: Object.freeze(latest.failed > 0 ? ["Fix failing tests and rerun the focused suite."] : []),
        source: "gmloop test",
        status: latest.failed > 0 || latest.exitCode !== 0 ? "fail" : "pass",
        summary: `${String(latest.passed)} passed, ${String(latest.failed)} failed, ${String(latest.skipped)} skipped.`
    });
}

function collectRunnerEvidence(projectRoot: string): ProjectEvidenceRecord {
    // Narrow the local binding to the role interfaces `collectRunnerEvidence`
    // actually exercises: project binding (to rehydrate from disk) and a
    // frozen snapshot read. Lifecycle, room, and log mutation capabilities
    // are intentionally outside this helper's contract.
    const runnerStateStore: RunnerProjectBinder & RunnerSnapshotReader = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    const snapshot = runnerStateStore.readSnapshot();
    return Object.freeze({
        artifacts: [],
        diagnostics: [],
        kind: "runner-state",
        nextActions: snapshot.state === "running" ? ["Use runner logs or runtime inspection for live evidence."] : [],
        source: "gmloop runner",
        status: "pass",
        summary: `Runner is ${snapshot.state}; ${String(snapshot.logCount)} log record(s) available.`
    });
}

function createEvidenceRecord(parameters: ProjectEvidenceRecord): ProjectEvidenceRecord {
    return Object.freeze({
        artifacts: Object.freeze([...parameters.artifacts]),
        diagnostics: Object.freeze([...parameters.diagnostics]),
        kind: parameters.kind,
        nextActions: Object.freeze([...parameters.nextActions]),
        source: parameters.source,
        status: parameters.status,
        summary: parameters.summary
    });
}

/**
 * Snapshot of the GameMaker project manifest and the kind counts derived from
 * its resources. Returned by `resolveProjectManifestResources` so the rest of
 * the readiness pipeline can reuse the resolved context without re-running
 * manifest I/O.
 */
type ResolvedProjectManifest = Readonly<{
    context: Awaited<ReturnType<typeof resolveCommandProjectContext>>;
    manifest: Awaited<ReturnType<typeof Refactor.resolveProjectManifestFile>>;
    manifestResources: ReturnType<typeof Refactor.getManifestResources>;
    resourceKindCounts: Record<string, number>;
}>;

/**
 * Snapshot of the locally-installed GMLoop / agent-pack / official gm-cli
 * tooling reachable from the resolved project root. Returned by
 * `loadProjectCompanionTooling` so the readiness pipeline can compose
 * downstream evidence records without re-loading any of these sources.
 */
type CompanionToolingSnapshot = Readonly<{
    agentPack: Awaited<ReturnType<typeof AgentPack.readAgentPackProjectStatus>>;
    gmloopConfigPath: string;
    gmloopConfigPresent: boolean;
    officialCatalog: Awaited<ReturnType<typeof loadGameMakerCliCompanionCatalog>>;
    skills: ReadonlyArray<Awaited<ReturnType<typeof discoverAutoGameProjectSkills>>[number]>;
}>;

/**
 * Inputs required to assemble the per-source readiness evidence records.
 * `collectProjectReadinessEvidenceRecords` owns only the *shape* of each
 * record; producing the underlying values is the responsibility of the
 * upstream helpers.
 */
type ProjectReadinessEvidenceInputs = Readonly<{
    agentPack: CompanionToolingSnapshot["agentPack"];
    gmloopConfigPath: CompanionToolingSnapshot["gmloopConfigPath"];
    gmloopConfigPresent: CompanionToolingSnapshot["gmloopConfigPresent"];
    graphSummary: ProjectReadinessInspection["graph"];
    manifest: ResolvedProjectManifest["manifest"];
    manifestResources: ResolvedProjectManifest["manifestResources"];
    officialCatalog: CompanionToolingSnapshot["officialCatalog"];
}>;

/**
 * Resolve the project context, load the GameMaker manifest, and aggregate a
 * resource-kind histogram. Owns only the manifest I/O and counting; downstream
 * helpers reuse the returned `context` to avoid redundant resolution.
 */
async function resolveProjectManifestResources(options: ProjectReadinessOptions): Promise<ResolvedProjectManifest> {
    const context = await resolveCommandProjectContext(options);
    const manifest = await Refactor.resolveProjectManifestFile(context.projectRoot);
    const manifestDocument = await Refactor.readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = Refactor.getManifestResources(manifestDocument);
    const resourceKindCounts: Record<string, number> = {};
    for (const resource of manifestResources) {
        incrementCount(resourceKindCounts, readResourceKindFromPath(resource.id.path));
    }

    return Object.freeze({
        context,
        manifest,
        manifestResources,
        resourceKindCounts
    });
}

/**
 * Load the locally-installed tooling reachable from the project root:
 * gmloop.json presence, agent-pack install state, project skills, and the
 * gm-cli / ResourceTool MCP companion catalog. The three independent I/O
 * sources fan out concurrently because none of them depends on the others.
 */
async function loadProjectCompanionTooling(
    context: ResolvedProjectManifest["context"]
): Promise<CompanionToolingSnapshot> {
    const gmloopConfigPath = path.join(context.projectRoot, "gmloop.json");
    const gmloopConfigPresent = await fileExists(gmloopConfigPath);
    const [agentPack, skills, officialCatalog] = await Promise.all([
        AgentPack.readAgentPackProjectStatus(context.projectRoot),
        discoverAutoGameProjectSkills(context.projectRoot, context.projectConfig),
        loadGameMakerCliCompanionCatalog({ projectRoot: context.projectRoot })
    ]);

    return Object.freeze({
        agentPack,
        gmloopConfigPath,
        gmloopConfigPresent,
        officialCatalog,
        skills
    });
}

/**
 * Build the graph index and produce the graph summary used by the readiness
 * evidence. Owns only the graph projection and a single recovery path that
 * records a `fail` summary when the index cannot be produced; any other
 * failure still propagates so callers can react to genuine runtime faults.
 */
async function buildGraphInspectionSummary(
    options: ProjectReadinessOptions,
    context: ResolvedProjectManifest["context"]
): Promise<ProjectReadinessInspection["graph"]> {
    try {
        const graphIndex = await runSemanticIndexOperation(context.projectRoot, (onProgress) =>
            Semantic.buildGraphIndex({
                databasePath: options.databasePath,
                onProgress,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                toolsetRoot: options.toolsetRoot
            })
        );
        const searchResults = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results;
        const graphKinds: Record<string, number> = {};
        for (const result of searchResults) {
            incrementCount(graphKinds, result.kind);
        }
        return Object.freeze({
            databasePath: graphIndex.databasePath,
            graphIds: Object.freeze([...graphIndex.graphIds].sort()),
            ok: true,
            resourceKinds: Object.freeze({ ...graphKinds })
        });
    } catch {
        return Object.freeze({
            databasePath: null,
            graphIds: Object.freeze([]),
            ok: false,
            resourceKinds: Object.freeze({})
        });
    }
}

/**
 * Evidence record describing whether `gmloop.json` exists at the project
 * root. Owns only the configuration-presence concern; companion tools and
 * graph state are reported by their own dedicated records below.
 */
function createGmloopConfigEvidenceRecord(
    gmloopConfigPath: string,
    gmloopConfigPresent: boolean
): ProjectEvidenceRecord {
    return createEvidenceRecord({
        artifacts: gmloopConfigPresent ? [gmloopConfigPath] : [],
        diagnostics: gmloopConfigPresent ? [] : ["No gmloop.json was found at the project root."],
        kind: "gmloop-config",
        nextActions: gmloopConfigPresent
            ? []
            : ["Create gmloop.json when project-specific GMLoop settings are needed."],
        source: "gmloop project",
        status: gmloopConfigPresent ? "pass" : "warn",
        summary: gmloopConfigPresent ? "Project configuration is present." : "Project configuration is absent."
    });
}

/**
 * Evidence record describing whether the graph index could be built for the
 * resolved project. Owns only the graph-availability concern.
 */
function createGraphIndexEvidenceRecord(graphSummary: ProjectReadinessInspection["graph"]): ProjectEvidenceRecord {
    const indexedNodeCount = Object.values(graphSummary.resourceKinds).reduce((sum, count) => sum + count, 0);
    return createEvidenceRecord({
        artifacts: [],
        diagnostics: graphSummary.ok ? [] : ["Graph index could not be built."],
        kind: "graph-index",
        nextActions: graphSummary.ok ? [] : ["Run graph doctor or inspect parse/resource diagnostics."],
        source: "@gmloop/semantic",
        status: graphSummary.ok ? "pass" : "fail",
        summary: graphSummary.ok ? `${String(indexedNodeCount)} graph node(s) indexed.` : "Graph index is unavailable."
    });
}

/**
 * Evidence record describing the size of the resource inventory declared in
 * the GameMaker project manifest. Owns only the resource-inventory concern.
 */
function createResourceInventoryEvidenceRecord(
    manifestAbsolutePath: string,
    manifestResourceCount: number
): ProjectEvidenceRecord {
    const isEmpty = manifestResourceCount === 0;
    return createEvidenceRecord({
        artifacts: [manifestAbsolutePath],
        diagnostics: isEmpty ? ["Project manifest contains no resources."] : [],
        kind: "resource-inventory",
        nextActions: isEmpty ? ["Create resources through official ResourceTool MCP or GMLoop companion tools."] : [],
        source: "GameMaker project manifest",
        status: isEmpty ? "warn" : "pass",
        summary: `${String(manifestResourceCount)} resource(s) declared in the project manifest.`
    });
}

/**
 * Evidence record describing the install state of the agent-pack guidance
 * package for the resolved project. Owns only the agent-pack concern.
 */
function createAgentPackEvidenceRecord(agentPack: CompanionToolingSnapshot["agentPack"]): ProjectEvidenceRecord {
    return createEvidenceRecord({
        artifacts: [],
        diagnostics: agentPack.status === "current" ? [] : [`Agent pack status is ${agentPack.status}.`],
        kind: "agent-pack",
        nextActions:
            agentPack.status === "current" ? [] : ["Run gmloop agent-pack init for project-local Auto-Game guidance."],
        source: "@gmloop/agent-pack",
        status: agentPack.status === "current" ? "pass" : "warn",
        summary:
            agentPack.installedVersion === null
                ? "Agent pack is not installed."
                : `Agent pack ${agentPack.installedVersion} installed; latest is ${agentPack.availableVersion}.`
    });
}

/**
 * Evidence record describing whether the official `gm-cli` companion tool
 * is reachable from the resolved project. Owns only the official gm-cli
 * concern; the companion ResourceTool MCP is reported separately.
 */
function createOfficialGmCliEvidenceRecord(
    officialCatalog: CompanionToolingSnapshot["officialCatalog"]
): ProjectEvidenceRecord {
    return createEvidenceRecord({
        artifacts: [],
        diagnostics: officialCatalog.available ? [] : [officialCatalog.error ?? "gm-cli is unavailable."],
        kind: "official-gm-cli",
        nextActions: officialCatalog.available
            ? []
            : ["Install or configure official gm-cli for GameMaker lifecycle operations."],
        source: "gm-cli",
        status: officialCatalog.available ? "pass" : "warn",
        summary: officialCatalog.available
            ? `Official gm-cli ${officialCatalog.version ?? "unknown version"} is available.`
            : "Official gm-cli is unavailable."
    });
}

/**
 * Evidence record describing whether the official gm-cli ResourceTool MCP
 * server is reachable from the resolved project. Owns only the
 * official-ResourceTool-MCP concern; the parent gm-cli is reported
 * separately.
 */
function createOfficialResourceToolMcpEvidenceRecord(
    officialCatalog: CompanionToolingSnapshot["officialCatalog"]
): ProjectEvidenceRecord {
    const { mcpServer } = officialCatalog;
    return createEvidenceRecord({
        artifacts: mcpServer.sourcePath === null ? [] : [mcpServer.sourcePath],
        diagnostics: mcpServer.available
            ? []
            : [mcpServer.error ?? "ResourceTool MCP is not configured or not reachable."],
        kind: "official-resourcetool-mcp",
        nextActions: mcpServer.available
            ? []
            : ["Configure gm-cli ResourceTool MCP for official resource mutations when needed."],
        source: "gm-cli ResourceTool MCP",
        status: mcpServer.available ? "pass" : "warn",
        summary: mcpServer.available
            ? `ResourceTool MCP '${mcpServer.serverId ?? "configured"}' is available.`
            : "ResourceTool MCP is unavailable."
    });
}

/**
 * Compose the readiness evidence records from the manifest, companion
 * tooling, and graph summary snapshots. Each per-source record owns a
 * single change-triggering concern (configuration presence, graph
 * availability, resource inventory, agent pack state, official gm-cli,
 * official ResourceTool MCP); the records are sorted by `kind` so
 * downstream callers receive a stable ordering regardless of evaluation
 * order.
 */
function collectProjectReadinessEvidenceRecords(
    inputs: ProjectReadinessEvidenceInputs
): ReadonlyArray<ProjectEvidenceRecord> {
    return [
        createGmloopConfigEvidenceRecord(inputs.gmloopConfigPath, inputs.gmloopConfigPresent),
        createGraphIndexEvidenceRecord(inputs.graphSummary),
        createResourceInventoryEvidenceRecord(inputs.manifest.absolutePath, inputs.manifestResources.length),
        createAgentPackEvidenceRecord(inputs.agentPack),
        createOfficialGmCliEvidenceRecord(inputs.officialCatalog),
        createOfficialResourceToolMcpEvidenceRecord(inputs.officialCatalog)
    ].sort((left, right) => left.kind.localeCompare(right.kind));
}

async function createProjectReadinessInspection(options: ProjectReadinessOptions): Promise<ProjectReadinessInspection> {
    const resolvedManifest = await resolveProjectManifestResources(options);
    const [companionTooling, graphSummary] = await Promise.all([
        loadProjectCompanionTooling(resolvedManifest.context),
        buildGraphInspectionSummary(options, resolvedManifest.context)
    ]);
    const evidence = collectProjectReadinessEvidenceRecords({
        agentPack: companionTooling.agentPack,
        gmloopConfigPath: companionTooling.gmloopConfigPath,
        gmloopConfigPresent: companionTooling.gmloopConfigPresent,
        graphSummary,
        manifest: resolvedManifest.manifest,
        manifestResources: resolvedManifest.manifestResources,
        officialCatalog: companionTooling.officialCatalog
    });

    return Object.freeze({
        agentPack: companionTooling.agentPack,
        configuredOfficialMcp: Object.freeze({
            available: companionTooling.officialCatalog.mcpServer.available,
            serverId: companionTooling.officialCatalog.mcpServer.serverId,
            sourcePath: companionTooling.officialCatalog.mcpServer.sourcePath
        }),
        evidence: Object.freeze(evidence),
        gmCli: Object.freeze({
            available: companionTooling.officialCatalog.available,
            cliLeafCount: companionTooling.officialCatalog.cliCommands.length,
            error: companionTooling.officialCatalog.error,
            invocation: companionTooling.officialCatalog.invocation,
            mcpToolCount: companionTooling.officialCatalog.mcpTools.length,
            version: companionTooling.officialCatalog.version
        }),
        gmloopConfig: Object.freeze({
            path: companionTooling.gmloopConfigPath,
            present: companionTooling.gmloopConfigPresent
        }),
        graph: graphSummary,
        projectRoot: resolvedManifest.context.projectRoot,
        resources: Object.freeze({
            count: resolvedManifest.manifestResources.length,
            manifestPath: resolvedManifest.manifest.absolutePath,
            resourceKinds: Object.freeze({ ...resolvedManifest.resourceKindCounts })
        }),
        skills: Object.freeze([...companionTooling.skills]),
        yypPath: resolvedManifest.manifest.absolutePath
    });
}

async function runProjectCacheCleanAction(options: ProjectCacheCleanOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.path
    });
    const targets = [
        options.project ? path.join(projectRoot, ".gmloop", "cache") : null,
        options.ide ? path.join(projectRoot, ".idea") : null,
        options.runner ? path.join(projectRoot, "runner") : null
    ].filter((entry): entry is string => entry !== null);

    if (options.force === true) {
        await Promise.all(targets.map((target) => rm(target, { force: true, recursive: true })));
    }

    printProjectPayload({
        command: "project cache clean",
        mode: options.force === true ? "apply" : "dry-run",
        ok: true,
        payload: {
            projectRoot,
            targets
        }
    });
}

async function runProjectInspectAction(options: ProjectReadinessOptions): Promise<void> {
    const inspection = await createProjectReadinessInspection(options);
    printProjectPayload({
        command: "project inspect",
        ok: true,
        payload: {
            agentPack: inspection.agentPack,
            configuredOfficialMcp: inspection.configuredOfficialMcp,
            gmCli: inspection.gmCli,
            gmloopConfig: inspection.gmloopConfig,
            graph: inspection.graph,
            projectRoot: inspection.projectRoot,
            recommendedNextActions: [...new Set(inspection.evidence.flatMap((entry) => entry.nextActions))].sort(),
            resources: inspection.resources,
            skills: inspection.skills,
            yypPath: inspection.yypPath
        }
    });
}

async function runProjectValidateAction(options: ProjectReadinessOptions): Promise<void> {
    const inspection = await createProjectReadinessInspection(options);
    const parseEvidence = await collectParseEvidence(inspection.projectRoot);
    const testEvidence = await collectTestEvidence(inspection.projectRoot);
    const runnerEvidence = collectRunnerEvidence(inspection.projectRoot);
    const evidence = [...inspection.evidence, parseEvidence, testEvidence, runnerEvidence].sort((left, right) =>
        left.kind.localeCompare(right.kind)
    );
    const failedCount = evidence.filter((entry) => entry.status === "fail").length;
    const warningCount = evidence.filter((entry) => entry.status === "warn").length;
    const unknownCount = evidence.filter((entry) => entry.status === "unknown").length;
    printProjectPayload({
        command: "project validate",
        ok: failedCount === 0,
        payload: {
            evidence,
            nextActions: [...new Set(evidence.flatMap((entry) => entry.nextActions))].sort(),
            projectRoot: inspection.projectRoot,
            summary: {
                failed: failedCount,
                passed: evidence.filter((entry) => entry.status === "pass").length,
                unknown: unknownCount,
                warnings: warningCount
            },
            yypPath: inspection.yypPath
        }
    });
}

function addProjectReadinessOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--json", "Emit JSON output.");
}

export function createProjectCommand(): Command {
    const command = applyStandardCommandOptions(new Command("project")).description(
        "Inspect, validate, and clean GMLoop project state."
    );
    const inspect = addProjectReadinessOptions(
        applyStandardCommandOptions(new Command("inspect")).description(
            "Inspect Auto-Game readiness, skills, resources, graph state, and official companion tooling."
        )
    );
    inspect.action(async function projectInspectAction() {
        try {
            await runProjectInspectAction(this.opts<ProjectReadinessOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });

    const validate = addProjectReadinessOptions(
        applyStandardCommandOptions(new Command("validate")).description(
            "Aggregate GMLoop-owned readiness evidence for autonomous GameMaker creation."
        )
    );
    validate.action(async function projectValidateAction() {
        try {
            await runProjectValidateAction(this.opts<ProjectReadinessOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });

    const cache = applyStandardCommandOptions(new Command("cache")).description("Project cache operations.");
    const clean = applyStandardCommandOptions(new Command("clean"))
        .description("Clean project caches.")
        .addOption(createPathOption())
        .option("--project", "Include .gmloop cache.")
        .option("--ide", "Include IDE cache/artifacts under project tree.")
        .option("--runner", "Include local runner cache/artifacts under project tree.")
        .option("--force", "Apply deletion. Without this flag, returns dry-run plan.")
        .option("--json", "Emit JSON output.");
    clean.action(async function projectCacheCleanAction() {
        await runProjectCacheCleanAction(this.opts<ProjectCacheCleanOptions>());
    });
    cache.addCommand(clean);
    command.addCommand(inspect);
    command.addCommand(validate);
    command.addCommand(cache);
    return command;
}
