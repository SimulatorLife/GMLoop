import { type FixtureAdapter, FixtureRunner } from "@gmloop/fixture-runner";
import { Codemods } from "@gmloop/refactor";
import { ESLint } from "eslint";

import { createLintRuleEntriesFromProjectConfig } from "../../src/configs/index.js";
import { Lint } from "../../src/index.js";

function createRuleEntriesCacheKey(ruleEntries: Record<string, unknown>): string {
    const sortedRuleIds = Object.keys(ruleEntries).sort((left, right) => left.localeCompare(right));
    const serializedEntries = sortedRuleIds.map((ruleId) => [ruleId, ruleEntries[ruleId]]);
    return JSON.stringify(serializedEntries);
}

function createFixtureRuleConfig(config: Record<string, unknown>) {
    const ruleEntries = createLintRuleEntriesFromProjectConfig(config);
    const enabledRuleIds = Object.keys(ruleEntries);
    if (enabledRuleIds.length === 0) {
        throw new Error("Lint fixture config must enable at least one rule.");
    }

    return ruleEntries;
}

/**
 * Create the shared lint-fixture adapter used by workspace and aggregate
 * fixture suites.
 *
 * @returns Lint fixture adapter backed by the lint workspace runtime API.
 */
export function createLintFixtureAdapter(): FixtureAdapter {
    const eslintByRuleConfigKey = new Map<string, ESLint>();

    return Object.freeze({
        workspaceName: "lint",
        suiteName: "lint rule fixtures",
        supports(kind: string) {
            return kind === "lint";
        },
        async run({ fixtureCase, config, inputText, runProfiledStage }) {
            const ruleEntries = createFixtureRuleConfig(config);
            const cacheKey = createRuleEntriesCacheKey(ruleEntries);
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
            let lintedOutput = result.output ?? inputText ?? "";

            if (
                ruleEntries["gml/require-argument-separators"] &&
                ruleEntries["gml/require-argument-separators"] !== "off"
            ) {
                const repairResult =
                    Codemods.RepairArgumentSeparators.applyRepairArgumentSeparatorsCodemod(lintedOutput);
                if (repairResult.changed) {
                    lintedOutput = repairResult.outputText;
                }
            }

            if (
                ruleEntries["gml/normalize-operator-aliases"] &&
                ruleEntries["gml/normalize-operator-aliases"] !== "off"
            ) {
                const repairLogicalNotResult = await Codemods.RepairLogicalNot.applyRepairLogicalNotCodemod(
                    lintedOutput,
                    null
                );
                if (repairLogicalNotResult.changed) {
                    lintedOutput = repairLogicalNotResult.outputText;
                }
            }

            if (ruleEntries["gml/no-scientific-notation"] && ruleEntries["gml/no-scientific-notation"] !== "off") {
                const repairScientificResult = Codemods.ScientificNotation.applyScientificNotationCodemod(lintedOutput);
                if (repairScientificResult.changed) {
                    lintedOutput = repairScientificResult.outputText;
                }
            }

            return {
                resultKind: "text" as const,
                outputText: lintedOutput,
                changed: lintedOutput !== (inputText ?? "")
            };
        }
    });
}

/**
 * Create the canonical lint fixture suite definition shared by workspace and
 * aggregate fixture runs.
 *
 * @returns Lint fixture suite registration metadata.
 */
export function createLintFixtureSuiteDefinition() {
    return FixtureRunner.createFixtureSuiteDefinition({
        workspaceName: "lint",
        suiteName: "lint rule fixtures",
        compiledWorkspaceTestFilePath: "src/lint/dist/test/rules/rule-fixtures.test.js",
        moduleUrl: import.meta.url,
        sourceRelativeSegments: ["..", "fixtures"],
        distRelativeSegments: ["..", "..", "..", "test", "fixtures"],
        adapter: createLintFixtureAdapter()
    });
}
