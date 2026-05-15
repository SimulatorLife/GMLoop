import { access, constants } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Refactor } from "@gmloop/refactor";

import { type GameMakerCliCompanionCatalog, loadGameMakerCliCompanionCatalog } from "../game-maker-cli/index.js";

const { createLintRuleEntriesFromProjectConfigOrNull } = Lint.configs;

type ConfigurationSource = "configured" | "default";

type GraphProjectConfigurationContext = Readonly<{
    projectConfig: Record<string, unknown>;
    projectRoot: string;
}>;

type ProjectConfigurationEntry = Readonly<{
    description: string;
    name: string;
    source: ConfigurationSource;
    value: unknown;
}>;

type ProjectConfigurationLintRuleEntry = Readonly<{
    description: string;
    fixable: "code" | "whitespace" | null;
    level: "error" | "off" | "warn";
    options: Readonly<Record<string, unknown>>;
    ruleId: string;
}>;

type ProjectConfigurationLintRulesetEntry = Readonly<{
    name: string;
    ruleIds: ReadonlyArray<string>;
}>;

type LintConfigRuleList = ReadonlyArray<
    Readonly<{
        rules: Readonly<Record<string, unknown>>;
    }>
>;

type ProjectConfigurationRefactorCodemodEntry = Readonly<{
    config: unknown;
    description: string;
    enabled: boolean;
    id: string;
    requiresSemanticProjectIndex: boolean;
}>;

type ProjectConfigurationExternalToolParameter = Readonly<{
    choices: ReadonlyArray<string>;
    description: string;
    kind: "argument" | "flag";
    multiple: boolean;
    name: string;
    required: boolean;
    syntax: string;
    valueType: "boolean" | "string";
}>;

type ProjectConfigurationGameMakerCliCommandEntry = Readonly<{
    commandPath: ReadonlyArray<string>;
    description: string;
    displayName: string;
    parameters: ReadonlyArray<ProjectConfigurationExternalToolParameter>;
    usageLines: ReadonlyArray<string>;
}>;

type ProjectConfigurationGameMakerCliMcpToolEntry = Readonly<{
    description: string;
    fields: ReadonlyArray<ProjectConfigurationExternalToolParameter>;
    name: string;
}>;

export type GraphVisualizationProjectConfigurationCatalog = Readonly<{
    format: Readonly<{
        entries: ReadonlyArray<ProjectConfigurationEntry>;
    }>;
    gameMakerCli: Readonly<{
        available: boolean;
        cliCommands: ReadonlyArray<ProjectConfigurationGameMakerCliCommandEntry>;
        error: string | null;
        invocation: string | null;
        mcpServer: Readonly<{
            available: boolean;
            error: string | null;
            name: string | null;
            projectPath: string | null;
            serverId: string | null;
            sourcePath: string | null;
            version: string | null;
        }>;
        mcpTools: ReadonlyArray<ProjectConfigurationGameMakerCliMcpToolEntry>;
        version: string | null;
    }>;
    githubRepositoryUrl: string;
    gmloop: Readonly<{
        configPath: string | null;
        exists: boolean;
        projectRoot: string;
        rawConfig: Readonly<Record<string, unknown>>;
    }>;
    lint: Readonly<{
        rules: ReadonlyArray<ProjectConfigurationLintRuleEntry>;
        rulesets: ReadonlyArray<ProjectConfigurationLintRulesetEntry>;
        ruleset: string | null;
    }>;
    refactor: Readonly<{
        codemods: ReadonlyArray<ProjectConfigurationRefactorCodemodEntry>;
    }>;
}>;

const GITHUB_REPOSITORY_URL = "https://github.com/SimulatorLife/GMLoop";

async function resolveExistingConfigPath(
    projectRoot: string,
    configPathOption: string | undefined
): Promise<string | null> {
    const candidatePath = configPathOption ? path.resolve(configPathOption) : path.join(projectRoot, "gmloop.json");

    try {
        await access(candidatePath, constants.R_OK);
        return candidatePath;
    } catch {
        return null;
    }
}

function createEmptyGameMakerCliCatalog(error: string | null = null): GameMakerCliCompanionCatalog {
    return Object.freeze({
        available: false,
        cliCommands: [],
        error,
        invocation: null,
        mcpServer: Object.freeze({
            available: false,
            error,
            name: null,
            projectPath: null,
            serverId: null,
            sourcePath: null,
            version: null
        }),
        mcpTools: [],
        version: null
    });
}

function normalizeLintRuleOptions(value: unknown): Readonly<Record<string, unknown>> {
    if (!Array.isArray(value) || value.length < 2) {
        return Object.freeze({});
    }

    const optionsValue = value[1];
    if (!optionsValue || typeof optionsValue !== "object" || Array.isArray(optionsValue)) {
        return Object.freeze({});
    }

    return Object.freeze({ ...(optionsValue as Record<string, unknown>) });
}

function createFormatConfigurationEntries(
    projectConfig: Readonly<Record<string, unknown>>
): ReadonlyArray<ProjectConfigurationEntry> {
    const configuredOptions = Format.extractProjectFormatOptions(projectConfig);

    return Format.listProjectFormatOptionCatalogEntries().map((entry) =>
        Object.freeze({
            description: entry.description,
            name: entry.name,
            source: Object.hasOwn(configuredOptions, entry.name) ? "configured" : "default",
            value: Object.hasOwn(configuredOptions, entry.name) ? configuredOptions[entry.name] : entry.defaultValue
        })
    );
}

function createLintConfigurationEntries(projectConfig: Readonly<Record<string, unknown>>): Readonly<{
    rules: ReadonlyArray<ProjectConfigurationLintRuleEntry>;
    rulesets: ReadonlyArray<ProjectConfigurationLintRulesetEntry>;
    ruleset: string | null;
}> {
    const lintRulesets = createLintRulesetEntries();
    const normalizedRulesOrNull = Lint.configs.normalizeLintRulesConfigOrNull(projectConfig);
    if (normalizedRulesOrNull === null) {
        // Invalid `lintRules` or `lintRuleset` in gmloop.json; return an empty
        // rules list rather than crashing the UI during project-open.
        return Object.freeze({
            rules: [],
            rulesets: lintRulesets,
            ruleset: null
        });
    }
    const lintRuleEntries = createLintRuleEntriesFromProjectConfigOrNull(projectConfig) ?? {};
    const rules = Lint.listLintRuleCatalogEntries()
        .map((catalogEntry) => {
            const ruleEntry = lintRuleEntries[catalogEntry.ruleId];
            return Object.freeze({
                description: catalogEntry.description,
                fixable: catalogEntry.fixable,
                level: normalizedRulesOrNull[catalogEntry.ruleId] ?? "off",
                options: normalizeLintRuleOptions(ruleEntry),
                ruleId: catalogEntry.ruleId
            });
        })
        .sort((leftEntry, rightEntry) => leftEntry.ruleId.localeCompare(rightEntry.ruleId));

    return Object.freeze({
        rules,
        rulesets: lintRulesets,
        ruleset: typeof projectConfig.lintRuleset === "string" ? projectConfig.lintRuleset : null
    });
}

function createLintRulesetEntries(): ReadonlyArray<ProjectConfigurationLintRulesetEntry> {
    return Object.entries(Lint.configs)
        .flatMap(([name, configEntries]) => {
            if (!isLintConfigRuleList(configEntries)) {
                return [];
            }

            return [
                Object.freeze({
                    name,
                    ruleIds: Object.freeze(
                        [...new Set(configEntries.flatMap((configEntry) => Object.keys(configEntry.rules)))].sort(
                            (leftRuleId, rightRuleId) => leftRuleId.localeCompare(rightRuleId)
                        )
                    )
                })
            ];
        })
        .sort((leftEntry, rightEntry) => leftEntry.name.localeCompare(rightEntry.name));
}

function isLintConfigRuleList(value: unknown): value is LintConfigRuleList {
    return (
        Array.isArray(value) &&
        value.every(
            (entry) => Core.isObjectLike(entry) && Core.isObjectLike((entry as Readonly<Record<string, unknown>>).rules)
        )
    );
}

function createRefactorConfigurationEntries(
    projectConfig: Readonly<Record<string, unknown>>
): ReadonlyArray<ProjectConfigurationRefactorCodemodEntry> {
    const rawRefactor = projectConfig.refactor;
    const normalizedRefactorConfig = Refactor.normalizeRefactorProjectConfigOrNull(rawRefactor);
    if (normalizedRefactorConfig === null) {
        // Unknown keys or invalid codemod entries in gmloop.json; return an empty
        // codemod list rather than crashing the UI during project-open.
        return [];
    }
    const configuredCodemods = normalizedRefactorConfig.codemods ?? {};
    const semanticIndexDependentCodemodIds = new Set(Refactor.listSemanticProjectIndexDependentCodemodIds());

    return Refactor.listRegisteredCodemods()
        .map((codemod) =>
            Object.freeze({
                config: configuredCodemods[codemod.id] ?? null,
                description: codemod.description,
                enabled: configuredCodemods[codemod.id] !== false,
                id: codemod.id,
                requiresSemanticProjectIndex: semanticIndexDependentCodemodIds.has(codemod.id)
            })
        )
        .sort((leftEntry, rightEntry) => leftEntry.id.localeCompare(rightEntry.id));
}

/**
 * Build the code-sourced project configuration catalog displayed by the UI.
 */
export async function createGraphVisualizationProjectConfigurationCatalog(
    context: GraphProjectConfigurationContext | null,
    options: Readonly<{
        config?: string;
    }>,
    dependencies: Readonly<{
        loadGameMakerCliCatalog?: typeof loadGameMakerCliCompanionCatalog;
    }> = {}
): Promise<GraphVisualizationProjectConfigurationCatalog> {
    const loadGameMakerCliCatalog = dependencies.loadGameMakerCliCatalog ?? loadGameMakerCliCompanionCatalog;

    if (context === null) {
        const gameMakerCliCatalog = await loadGameMakerCliCatalog({
            projectRoot: null
        }).catch((error) => createEmptyGameMakerCliCatalog(error instanceof Error ? error.message : String(error)));

        return Object.freeze({
            format: Object.freeze({ entries: [] }),
            gameMakerCli: gameMakerCliCatalog,
            githubRepositoryUrl: GITHUB_REPOSITORY_URL,
            gmloop: Object.freeze({
                configPath: null,
                exists: false,
                projectRoot: "",
                rawConfig: Object.freeze({})
            }),
            lint: Object.freeze({
                rules: [],
                rulesets: createLintRulesetEntries(),
                ruleset: null
            }),
            refactor: Object.freeze({
                codemods: []
            })
        });
    }

    const configPath = await resolveExistingConfigPath(context.projectRoot, options.config);
    const projectConfig = Core.isObjectLike(context.projectConfig) ? context.projectConfig : {};
    const gameMakerCliCatalog = await loadGameMakerCliCatalog({
        projectRoot: context.projectRoot
    }).catch((error) => createEmptyGameMakerCliCatalog(error instanceof Error ? error.message : String(error)));

    return Object.freeze({
        format: Object.freeze({
            entries: createFormatConfigurationEntries(projectConfig)
        }),
        gameMakerCli: gameMakerCliCatalog,
        githubRepositoryUrl: GITHUB_REPOSITORY_URL,
        gmloop: Object.freeze({
            configPath,
            exists: configPath !== null,
            projectRoot: context.projectRoot,
            rawConfig: Object.freeze({ ...projectConfig })
        }),
        lint: createLintConfigurationEntries(projectConfig),
        refactor: Object.freeze({
            codemods: createRefactorConfigurationEntries(projectConfig)
        })
    });
}
