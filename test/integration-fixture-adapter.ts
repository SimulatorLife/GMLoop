import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Format } from "@gmloop/format";
import { Lint } from "@gmloop/lint";
import { Refactor } from "@gmloop/refactor";
import { ESLint } from "eslint";

function createRuleEntriesCacheKey(ruleEntries: Record<string, unknown>): string {
    const sortedRuleIds = Object.keys(ruleEntries).sort((left, right) => left.localeCompare(right));
    const serializedEntries = sortedRuleIds.map((ruleId) => [ruleId, ruleEntries[ruleId]]);
    return JSON.stringify(serializedEntries);
}

function hasConfiguredRefactorStage(config: Record<string, unknown>): boolean {
    return Object.hasOwn(config, "refactor") && config.refactor !== undefined;
}

function resolveIntegrationWorkspaceFilePath(temporaryProjectDirectoryPath: string): string {
    return path.join(temporaryProjectDirectoryPath, "input.gml");
}

async function createIntegrationRefactorWorkspace(inputText: string): Promise<string> {
    const temporaryProjectDirectoryPath = await mkdtemp(path.join(os.tmpdir(), "gmloop-integration-fixture-"));
    await writeFile(resolveIntegrationWorkspaceFilePath(temporaryProjectDirectoryPath), inputText, "utf8");
    return temporaryProjectDirectoryPath;
}

async function runConfiguredIntegrationRefactorStage(
    config: Record<string, unknown>,
    temporaryProjectDirectoryPath: string
): Promise<string> {
    const projectFilePath = resolveIntegrationWorkspaceFilePath(temporaryProjectDirectoryPath);
    const engine = new Refactor.RefactorEngine();

    await engine.executeConfiguredCodemods({
        projectRoot: temporaryProjectDirectoryPath,
        targetPaths: ["input.gml"],
        gmlFilePaths: ["input.gml"],
        config: Refactor.normalizeRefactorProjectConfig(config.refactor),
        readFile: async (filePath) =>
            readFile(path.isAbsolute(filePath) ? filePath : path.join(temporaryProjectDirectoryPath, filePath), "utf8"),
        writeFile: async (filePath, content) =>
            writeFile(
                path.isAbsolute(filePath) ? filePath : path.join(temporaryProjectDirectoryPath, filePath),
                content,
                "utf8"
            ),
        dryRun: false
    });

    return readFile(projectFilePath, "utf8");
}

export function createIntegrationFixtureAdapter() {
    const eslintByRuleConfigKey = new Map<string, ESLint>();

    return Object.freeze({
        workspaceName: "integration",
        suiteName: "cross-module integration fixtures",
        supports(kind: string) {
            return kind === "integration";
        },
        async run({ fixtureCase, config, inputText, runProfiledStage }) {
            const formatOptions = Format.extractProjectFormatOptions(config);
            const lintRuleEntries = Lint.configs.createLintRuleEntriesFromProjectConfig(config);
            let temporaryRefactorWorkspacePath: string | null = null;

            try {
                const refactoredText = hasConfiguredRefactorStage(config)
                    ? await runProfiledStage("refactor", async () => {
                          temporaryRefactorWorkspacePath = await createIntegrationRefactorWorkspace(inputText ?? "");
                          return runConfiguredIntegrationRefactorStage(config, temporaryRefactorWorkspacePath);
                      })
                    : (inputText ?? "");

                const cacheKey = createRuleEntriesCacheKey(lintRuleEntries);
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
                                rules: lintRuleEntries
                            }
                        ]
                    });

                if (!cachedEslint) {
                    eslintByRuleConfigKey.set(cacheKey, eslint);
                }

                const [result] = await runProfiledStage("lint", async () =>
                    eslint.lintText(refactoredText, {
                        filePath: `${fixtureCase.caseId}.gml`
                    })
                );
                const lintedOutput = result.output ?? refactoredText;
                const outputText = await runProfiledStage("format", async () =>
                    Format.format(lintedOutput, formatOptions)
                );

                return {
                    resultKind: "text" as const,
                    outputText,
                    changed: outputText !== (inputText ?? "")
                };
            } finally {
                if (temporaryRefactorWorkspacePath !== null) {
                    await rm(temporaryRefactorWorkspacePath, { recursive: true, force: true });
                }
            }
        }
    });
}
