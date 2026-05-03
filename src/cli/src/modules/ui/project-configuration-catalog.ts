import { access, constants } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Refactor } from "@gmloop/refactor";

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
    level: string;
    options: Readonly<Record<string, unknown>>;
    ruleId: string;
}>;

type ProjectConfigurationRefactorCodemodEntry = Readonly<{
    config: unknown;
    description: string;
    enabled: boolean;
    id: string;
    requiresSemanticProjectIndex: boolean;
}>;

export type GraphVisualizationProjectConfigurationCatalog = Readonly<{
    format: Readonly<{
        entries: ReadonlyArray<ProjectConfigurationEntry>;
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
    ruleset: string | null;
}> {
    const lintRuleCatalogById = new Map(
        Lint.listLintRuleCatalogEntries().map((entry) => [entry.ruleId, entry] as const)
    );
    const lintRuleEntries = Lint.configs.projectConfig.createLintRuleEntriesFromProjectConfig(projectConfig);
    const rules = Object.entries(lintRuleEntries)
        .map(([ruleId, value]) => {
            const catalogEntry = lintRuleCatalogById.get(ruleId);
            const level = Array.isArray(value) ? value[0] : value;
            return Object.freeze({
                description: catalogEntry?.description ?? "No rule description is available.",
                fixable: catalogEntry?.fixable ?? null,
                level: String(level),
                options: normalizeLintRuleOptions(value),
                ruleId
            });
        })
        .sort((leftEntry, rightEntry) => leftEntry.ruleId.localeCompare(rightEntry.ruleId));

    return Object.freeze({
        rules,
        ruleset: typeof projectConfig.lintRuleset === "string" ? projectConfig.lintRuleset : null
    });
}

function createRefactorConfigurationEntries(
    projectConfig: Readonly<Record<string, unknown>>
): ReadonlyArray<ProjectConfigurationRefactorCodemodEntry> {
    const normalizedRefactorConfig = Refactor.normalizeRefactorProjectConfig(projectConfig.refactor);
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
    }>
): Promise<GraphVisualizationProjectConfigurationCatalog> {
    if (context === null) {
        return Object.freeze({
            format: Object.freeze({ entries: [] }),
            githubRepositoryUrl: GITHUB_REPOSITORY_URL,
            gmloop: Object.freeze({
                configPath: null,
                exists: false,
                projectRoot: "",
                rawConfig: Object.freeze({})
            }),
            lint: Object.freeze({
                rules: [],
                ruleset: null
            }),
            refactor: Object.freeze({
                codemods: []
            })
        });
    }

    const configPath = await resolveExistingConfigPath(context.projectRoot, options.config);
    const projectConfig = Core.isObjectLike(context.projectConfig) ? context.projectConfig : {};

    return Object.freeze({
        format: Object.freeze({
            entries: createFormatConfigurationEntries(projectConfig)
        }),
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
