import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";

const AGENT_CLI_TIMEOUT_MS = 30_000;

const agentCliCache = new Map<string, Promise<Readonly<{ installed: boolean; version: string | null }>>>();

/** Agent config targets supported by Auto-Game integration discovery. */
export type AgentConfigTargetId = "codex" | "gemini" | "qwen";

/** Selection modes accepted by agent-pack initialization. */
export type AgentConfigTargetSelection = AgentConfigTargetId | "all" | "detected" | "none";

/** Whether a supported agent target can be configured by GMLoop automatically. */
export type AgentIntegrationStatus = "cli-configurable" | "manual-required" | "unavailable";

/** A companion MCP server that Auto-Game expects coding agents to use. */
export type AgentCompanionMcpServerId = "gm-cli" | "gmloop" | "lsp" | "playwright";

/** Provider CLI command execution result. */
export type AgentCliCommandResult = Readonly<{
    exitCode: number;
    stderr: string;
    stdout: string;
}>;

/** Provider CLI command runner used by production code and tests. */
export type AgentCliCommandRunner = (
    command: string,
    args: ReadonlyArray<string>,
    options: Readonly<{ cwd: string }>
) => Promise<AgentCliCommandResult>;

/** Discovered integration state for one supported agent provider. */
export type AgentIntegrationTarget = Readonly<{
    cliInstalled: boolean;
    cliName: string;
    cliVersion: string | null;
    configDetected: boolean;
    configPaths: ReadonlyArray<string>;
    id: AgentConfigTargetId;
    label: string;
    manualInstructions: ReadonlyArray<string>;
    selectedByDefault: boolean;
    status: AgentIntegrationStatus;
    statusDetail: string;
}>;

/** Result of attempting provider-owned MCP setup through official CLIs. */
export type AgentIntegrationSetupSummary = Readonly<{
    configured: ReadonlyArray<AgentConfigTargetId>;
    failed: ReadonlyArray<Readonly<{ detail: string; id: AgentConfigTargetId }>>;
    manualRequired: ReadonlyArray<AgentConfigTargetId>;
    skipped: ReadonlyArray<Readonly<{ detail: string; id: AgentConfigTargetId }>>;
    unavailable: ReadonlyArray<AgentConfigTargetId>;
}>;

type SupportedAgentDefinition = Readonly<{
    cliName: string;
    configPaths: ReadonlyArray<string>;
    id: AgentConfigTargetId;
    label: string;
    manualInstructions: ReadonlyArray<string>;
}>;

const COMPANION_MCP_SERVER_IDS: ReadonlyArray<AgentCompanionMcpServerId> = Object.freeze([
    "gmloop",
    "lsp",
    "playwright",
    "gm-cli"
]);

const SUPPORTED_AGENT_DEFINITIONS: ReadonlyArray<SupportedAgentDefinition> = Object.freeze([
    Object.freeze({
        cliName: "qwen",
        configPaths: Object.freeze([".qwen/settings.json"]),
        id: "qwen",
        label: "Qwen Code",
        manualInstructions: Object.freeze([
            "Install Qwen Code, then run Auto-Game setup again so GMLoop can configure project-scoped MCP servers through `qwen mcp add --scope project`."
        ])
    }),
    Object.freeze({
        cliName: "codex",
        configPaths: Object.freeze([".codex/config.toml"]),
        id: "codex",
        label: "Codex",
        manualInstructions: Object.freeze([
            "Codex supports project `.codex/config.toml` MCP settings, but the verified `codex mcp add` command currently adds global entries only. Configure project MCP servers manually until Codex exposes project-scoped CLI setup."
        ])
    }),
    Object.freeze({
        cliName: "gemini",
        configPaths: Object.freeze([".gemini/settings.json", ".gemini/policies/tools.toml"]),
        id: "gemini",
        label: "Gemini / Antigravity",
        manualInstructions: Object.freeze([
            "Gemini/Antigravity MCP setup is manual until a verified project-scoped provider CLI command is available."
        ])
    })
]);

function createEmptyAgentIntegrationSetupSummary(): AgentIntegrationSetupSummary {
    return Object.freeze({
        configured: Object.freeze([]),
        failed: Object.freeze([]),
        manualRequired: Object.freeze([]),
        skipped: Object.freeze([]),
        unavailable: Object.freeze([])
    });
}

function normalizeVersionOutput(source: string): string | null {
    const firstLine = source
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    return firstLine ?? null;
}

async function pathExists(candidatePath: string): Promise<boolean> {
    try {
        await access(candidatePath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function detectAgentCli(
    cliName: string,
    projectRoot: string,
    commandRunner: AgentCliCommandRunner
): Promise<Readonly<{ installed: boolean; version: string | null }>> {
    const isDefaultRunner = commandRunner === runAgentCliCommand;
    if (isDefaultRunner) {
        const cached = agentCliCache.get(cliName);
        if (cached) {
            return cached;
        }
    }

    const promise = (async () => {
        const result = await commandRunner(cliName, ["--version"], { cwd: projectRoot });
        if (result.exitCode === 0) {
            return Object.freeze({
                installed: true,
                version: normalizeVersionOutput(result.stdout) ?? normalizeVersionOutput(result.stderr)
            });
        }
        return Object.freeze({
            installed: result.exitCode !== -1,
            version: null
        });
    })();

    if (isDefaultRunner) {
        agentCliCache.set(cliName, promise);
    }

    return promise;
}

function resolveAgentIntegrationStatus(
    input: Readonly<{
        cliInstalled: boolean;
        configDetected: boolean;
        id: AgentConfigTargetId;
    }>
): AgentIntegrationStatus {
    if (input.id === "qwen" && input.cliInstalled) {
        return "cli-configurable";
    }
    if (input.cliInstalled || input.configDetected) {
        return "manual-required";
    }
    return "unavailable";
}

function describeAgentIntegrationStatus(
    input: Readonly<{
        cliInstalled: boolean;
        configDetected: boolean;
        id: AgentConfigTargetId;
        status: AgentIntegrationStatus;
    }>
): string {
    if (input.status === "cli-configurable") {
        return "Project-scoped MCP setup is available through the provider CLI.";
    }
    if (input.status === "manual-required") {
        return input.id === "qwen"
            ? "Qwen config was detected, but the Qwen CLI is unavailable."
            : "GMLoop will not edit this provider config directly; manual setup is required.";
    }
    return "No supported project config or provider CLI was detected.";
}

/** Run a provider CLI command without invoking a shell. */
export async function runAgentCliCommand(
    command: string,
    args: ReadonlyArray<string>,
    options: Readonly<{ cwd: string }>
): Promise<AgentCliCommandResult> {
    return await new Promise((resolve) => {
        execFile(command, [...args], { cwd: options.cwd, timeout: AGENT_CLI_TIMEOUT_MS }, (error, stdout, stderr) => {
            if (error === null) {
                resolve(Object.freeze({ exitCode: 0, stderr, stdout }));
                return;
            }
            const code = typeof error.code === "number" ? error.code : -1;
            resolve(Object.freeze({ exitCode: code, stderr, stdout }));
        });
    });
}

/** Discover provider CLI and project config state for every supported Auto-Game agent. */
export async function discoverAgentIntegrationTargets(
    projectRoot: string,
    commandRunner: AgentCliCommandRunner = runAgentCliCommand
): Promise<ReadonlyArray<AgentIntegrationTarget>> {
    return Object.freeze(
        await Promise.all(
            SUPPORTED_AGENT_DEFINITIONS.map(async (definition) => {
                const [cli, detectedConfigPaths] = await Promise.all([
                    detectAgentCli(definition.cliName, projectRoot, commandRunner),
                    Promise.all(
                        definition.configPaths.map(async (configPath) =>
                            (await pathExists(path.join(projectRoot, ...configPath.split("/")))) ? configPath : null
                        )
                    )
                ]);
                const configPaths = detectedConfigPaths.filter(
                    (configPath): configPath is string => configPath !== null
                );
                const status = resolveAgentIntegrationStatus({
                    cliInstalled: cli.installed,
                    configDetected: configPaths.length > 0,
                    id: definition.id
                });
                return Object.freeze({
                    cliInstalled: cli.installed,
                    cliName: definition.cliName,
                    cliVersion: cli.version,
                    configDetected: configPaths.length > 0,
                    configPaths: Object.freeze(configPaths),
                    id: definition.id,
                    label: definition.label,
                    manualInstructions: definition.manualInstructions,
                    selectedByDefault: status === "cli-configurable" && configPaths.length > 0,
                    status,
                    statusDetail: describeAgentIntegrationStatus({
                        cliInstalled: cli.installed,
                        configDetected: configPaths.length > 0,
                        id: definition.id,
                        status
                    })
                });
            })
        )
    );
}

/** Parse and validate agent target selections from CLI, server, or UI callers. */
export function parseAgentConfigTargetSelections(source: string): ReadonlyArray<AgentConfigTargetSelection> {
    const selections = source
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    const validSelections = new Set<AgentConfigTargetSelection>(["all", "codex", "detected", "gemini", "none", "qwen"]);
    if (
        selections.length === 0 ||
        selections.some((selection) => !validSelections.has(selection as AgentConfigTargetSelection))
    ) {
        throw new Error("Agent target selection must be one of detected, all, none, codex, gemini, or qwen.");
    }
    if (
        selections.length > 1 &&
        selections.some((selection) => selection === "all" || selection === "detected" || selection === "none")
    ) {
        throw new Error("Agent target modes all, detected, and none cannot be combined with other selections.");
    }
    return Object.freeze(selections as ReadonlyArray<AgentConfigTargetSelection>);
}

function resolveSelectedAgentTargets(
    targets: ReadonlyArray<AgentIntegrationTarget>,
    selections: ReadonlyArray<AgentConfigTargetSelection>
): ReadonlyArray<AgentIntegrationTarget> {
    const [selectionMode] = selections;
    if (selectionMode === "none") {
        return Object.freeze([]);
    }
    if (selectionMode === "all") {
        return targets;
    }
    if (selectionMode === "detected") {
        return Object.freeze(targets.filter((target) => target.selectedByDefault));
    }
    const selectedIds = new Set(selections);
    return Object.freeze(targets.filter((target) => selectedIds.has(target.id)));
}

function createQwenMcpAddArguments(serverId: AgentCompanionMcpServerId): ReadonlyArray<string> {
    if (serverId === "gmloop") {
        return Object.freeze(["mcp", "add", "--scope", "project", "--trust", "gmloop", "gmloop", "mcp"]);
    }
    if (serverId === "lsp") {
        return Object.freeze(["mcp", "add", "--scope", "project", "--trust", "lsp", "pnpm", "exec", "lsp-mcp-server"]);
    }
    if (serverId === "playwright") {
        return Object.freeze([
            "mcp",
            "add",
            "--scope",
            "project",
            "--trust",
            "--exclude-tools",
            "browser_run_code_unsafe",
            "playwright",
            "npx",
            "-y",
            "@playwright/mcp@latest"
        ]);
    }
    return Object.freeze(["mcp", "add", "--scope", "project", "--trust", "gm-cli", "gmloop", "gm-cli", "mcp"]);
}

async function configureQwenMcpServers(
    projectRoot: string,
    commandRunner: AgentCliCommandRunner
): Promise<ReadonlyArray<AgentCliCommandResult>> {
    const results = await COMPANION_MCP_SERVER_IDS.reduce<Promise<ReadonlyArray<AgentCliCommandResult>>>(
        async (previousResultsPromise, serverId) => {
            const previousResults = await previousResultsPromise;
            const result = await commandRunner("qwen", createQwenMcpAddArguments(serverId), { cwd: projectRoot });
            return Object.freeze([...previousResults, result]);
        },
        Promise.resolve(Object.freeze([]))
    );
    return Object.freeze(results);
}

function summarizeQwenSetupResults(results: ReadonlyArray<AgentCliCommandResult>): string {
    return results
        .filter((result) => result.exitCode !== 0)
        .map((result) => result.stderr.trim() || result.stdout.trim() || `exit ${String(result.exitCode)}`)
        .join("; ");
}

/** Configure selected provider integrations only through official provider CLIs. */
export async function configureSelectedAgentIntegrations(
    projectRoot: string,
    selections: ReadonlyArray<AgentConfigTargetSelection>,
    commandRunner: AgentCliCommandRunner = runAgentCliCommand
): Promise<Readonly<{ setup: AgentIntegrationSetupSummary; targets: ReadonlyArray<AgentIntegrationTarget> }>> {
    const targets = await discoverAgentIntegrationTargets(projectRoot, commandRunner);
    const selectedTargets = resolveSelectedAgentTargets(targets, selections);
    const setupFragments = await Promise.all(
        selectedTargets.map((target) => configureSelectedAgentIntegration(projectRoot, target, commandRunner))
    );
    const setup = mergeAgentIntegrationSetupSummaries(setupFragments);

    return Object.freeze({ setup, targets });
}

async function configureSelectedAgentIntegration(
    projectRoot: string,
    target: AgentIntegrationTarget,
    commandRunner: AgentCliCommandRunner
): Promise<AgentIntegrationSetupSummary> {
    if (target.status === "unavailable") {
        return Object.freeze({
            ...createEmptyAgentIntegrationSetupSummary(),
            unavailable: Object.freeze([target.id])
        });
    }
    if (target.status === "manual-required") {
        return Object.freeze({
            ...createEmptyAgentIntegrationSetupSummary(),
            manualRequired: Object.freeze([target.id]),
            skipped: Object.freeze([
                {
                    detail: target.statusDetail,
                    id: target.id
                }
            ])
        });
    }

    const qwenResults = await configureQwenMcpServers(projectRoot, commandRunner);
    const failureDetail = summarizeQwenSetupResults(qwenResults);
    if (failureDetail.length > 0) {
        return Object.freeze({
            ...createEmptyAgentIntegrationSetupSummary(),
            failed: Object.freeze([
                {
                    detail: failureDetail,
                    id: target.id
                }
            ])
        });
    }
    return Object.freeze({
        ...createEmptyAgentIntegrationSetupSummary(),
        configured: Object.freeze([target.id])
    });
}

function mergeAgentIntegrationSetupSummaries(
    summaries: ReadonlyArray<AgentIntegrationSetupSummary>
): AgentIntegrationSetupSummary {
    return Object.freeze({
        configured: Object.freeze(summaries.flatMap((summary) => summary.configured)),
        failed: Object.freeze(summaries.flatMap((summary) => summary.failed)),
        manualRequired: Object.freeze(summaries.flatMap((summary) => summary.manualRequired)),
        skipped: Object.freeze(summaries.flatMap((summary) => summary.skipped)),
        unavailable: Object.freeze(summaries.flatMap((summary) => summary.unavailable))
    });
}

export const __agentIntegrationTest__ = Object.freeze({
    createQwenMcpAddArguments,
    parseAgentConfigTargetSelections
});
