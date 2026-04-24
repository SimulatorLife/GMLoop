import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { type FixtureAdapter, FixtureRunner } from "@gmloop/fixture-runner";
import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Refactor } from "@gmloop/refactor";
import { ESLint } from "eslint";

import { createIntegrationFixtureSuiteDefinition } from "./integration-fixture-suite-definition.js";
import {
    collectRefactorProjectGmlFiles,
    createRefactorFixtureSemanticAnalyzer
} from "./refactor-fixture-semantic-analyzer.js";

export interface FixtureSuiteRegistration {
    workspaceName: string;
    suiteName: string;
    compiledWorkspaceTestFilePath: string;
    fixtureRoot: string;
    adapter: FixtureAdapter;
}

type LintRuleEntries = ReturnType<typeof Lint.configs.projectConfig.createLintRuleEntriesFromProjectConfig>;
function resolveFixtureRoot(
    moduleUrl: string,
    sourceRelativeSegments: Array<string>,
    distRelativeSegments: Array<string>
): string {
    return FixtureRunner.resolveFixtureDirectoryFromModuleUrl({
        moduleUrl,
        sourceRelativeSegments,
        distRelativeSegments
    });
}

function createFormatFixtureSuiteRegistration(): FixtureSuiteRegistration {
    const adapter: FixtureAdapter = Object.freeze({
        workspaceName: "format",
        suiteName: "formatter fixtures",
        supports(kind: string) {
            return kind === "format";
        },
        async run({ config, inputText, runProfiledStage }) {
            const formatOptions = Format.extractProjectFormatOptions(config);
            const formatted = await runProfiledStage("format", async () =>
                Format.format(inputText ?? "", formatOptions)
            );

            return {
                resultKind: "text" as const,
                outputText: formatted,
                changed: formatted !== (inputText ?? "")
            };
        }
    });

    return Object.freeze({
        workspaceName: "format",
        suiteName: "formatter fixtures",
        compiledWorkspaceTestFilePath: "src/format/dist/test/formatter-fixtures.test.js",
        fixtureRoot: resolveFixtureRoot(
            import.meta.url,
            ["..", "src", "format", "test", "fixtures"],
            ["..", "..", "src", "format", "test", "fixtures"]
        ),
        adapter
    });
}

function createLintRuleEntriesCacheKey(ruleEntries: LintRuleEntries): string {
    const sortedRuleIds = Object.keys(ruleEntries).sort((left, right) => left.localeCompare(right));
    const serializedEntries = sortedRuleIds.map((ruleId) => [ruleId, ruleEntries[ruleId]]);
    return JSON.stringify(serializedEntries);
}

function createSingleRuleFixtureConfig(config: Record<string, unknown>): LintRuleEntries {
    const ruleEntries = Lint.configs.projectConfig.createLintRuleEntriesFromProjectConfig(config);
    const enabledRuleIds = Object.keys(ruleEntries);
    if (enabledRuleIds.length !== 1) {
        throw new Error(`Lint fixture config must enable exactly one rule, received ${enabledRuleIds.length}.`);
    }

    return ruleEntries;
}

function createLintFixtureSuiteRegistration(): FixtureSuiteRegistration {
    const eslintByRuleConfigKey = new Map<string, ESLint>();
    const lintAdapter: FixtureAdapter = Object.freeze({
        workspaceName: "lint",
        suiteName: "lint rule fixtures",
        supports(kind: string) {
            return kind === "lint";
        },
        async run({ fixtureCase, config, inputText, runProfiledStage }) {
            const ruleEntries = createSingleRuleFixtureConfig(config);
            const cacheKey = createLintRuleEntriesCacheKey(ruleEntries);
            const cachedEslint = eslintByRuleConfigKey.get(cacheKey);
            const eslint =
                cachedEslint ??
                new ESLint({
                    overrideConfigFile: true,
                    fix: true,
                    overrideConfig: [
                        {
                            files: ["**/*.gml"],
                            plugins: {
                                gml: Lint.plugin,
                                feather: Lint.featherPlugin
                            },
                            language: "gml/gml",
                            languageOptions: {
                                recovery: "limited"
                            },
                            rules: ruleEntries
                        }
                    ]
                });

            if (!cachedEslint) {
                eslintByRuleConfigKey.set(cacheKey, eslint);
            }

            const [result] = await runProfiledStage("lint", async () =>
                eslint.lintText(inputText ?? "", {
                    filePath: `${fixtureCase.caseId}.gml`
                })
            );
            const lintedOutput = result.output ?? inputText ?? "";

            return {
                resultKind: "text" as const,
                outputText: lintedOutput,
                changed: lintedOutput !== (inputText ?? "")
            };
        }
    });

    return Object.freeze({
        workspaceName: "lint",
        suiteName: "lint rule fixtures",
        compiledWorkspaceTestFilePath: "src/lint/dist/test/rules/rule-fixtures.test.js",
        fixtureRoot: resolveFixtureRoot(
            import.meta.url,
            ["..", "src", "lint", "test", "fixtures"],
            ["..", "..", "src", "lint", "test", "fixtures"]
        ),
        adapter: lintAdapter
    });
}

function createRefactorFixtureSuiteRegistration(): FixtureSuiteRegistration {
    const adapter: FixtureAdapter = Object.freeze({
        workspaceName: "refactor",
        suiteName: "refactor fixtures",
        supports(kind: string) {
            return kind === "refactor";
        },
        async run({ config, workingProjectDirectoryPath, runProfiledStage }) {
            const normalizedConfig = Refactor.normalizeRefactorProjectConfig(config.refactor);
            const projectRoot = workingProjectDirectoryPath ?? "";
            const gmlFilePaths = await collectRefactorProjectGmlFiles(projectRoot);
            const semantic = await createRefactorFixtureSemanticAnalyzer(projectRoot, gmlFilePaths);
            const engine = new Refactor.RefactorEngine({ semantic });

            await runProfiledStage("refactor", async () => {
                await engine.executeConfiguredCodemods({
                    projectRoot,
                    targetPaths: [projectRoot],
                    gmlFilePaths,
                    config: normalizedConfig,
                    readFile: async (filePath) =>
                        readFile(path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath), "utf8"),
                    writeFile: async (filePath, content) =>
                        writeFile(
                            path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath),
                            content,
                            "utf8"
                        ),
                    dryRun: false
                });
            });

            return {
                resultKind: "project-tree" as const,
                outputDirectoryPath: projectRoot,
                changed: true
            };
        }
    });

    return Object.freeze({
        workspaceName: "refactor",
        suiteName: "refactor fixtures",
        compiledWorkspaceTestFilePath: "src/refactor/dist/test/refactor-fixtures.test.js",
        fixtureRoot: resolveFixtureRoot(
            import.meta.url,
            ["..", "src", "refactor", "test", "fixtures"],
            ["..", "..", "src", "refactor", "test", "fixtures"]
        ),
        adapter
    });
}

/**
 * Create the canonical fixture suite registry shared by workspace, aggregate,
 * and profiling fixture runs.
 *
 * @returns Ordered fixture suite registrations for all fixture-owning areas.
 */
export function createFixtureSuiteRegistry(): ReadonlyArray<FixtureSuiteRegistration> {
    return Object.freeze([
        createFormatFixtureSuiteRegistration(),
        createLintFixtureSuiteRegistration(),
        createRefactorFixtureSuiteRegistration(),
        createIntegrationFixtureSuiteDefinition()
    ]);
}
