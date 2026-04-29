import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import type { FixtureAdapter } from "@gmloop/fixture-runner";

import { createPathSelectionMatcher } from "../src/codemods/naming-convention/path-selection.js";
import { normalizeRefactorProjectConfig } from "../src/project-config.js";
import { RefactorEngine } from "../src/refactor-engine.js";

type FixtureSymbolOccurrence = {
    path: string;
    start: number;
    end: number;
    kind: "definition" | "reference";
};

type FixtureNamingTarget = {
    name: string;
    category: "function";
    path: string;
    scopeId: string | null;
    symbolId: string;
    occurrences: Array<FixtureSymbolOccurrence>;
};

function escapeRegExp(source: string): string {
    return source.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function collectFunctionDeclarations(sourceText: string): Array<{ name: string; start: number }> {
    const declarations: Array<{ name: string; start: number }> = [];
    const declarationPattern = /function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match: RegExpExecArray | null = declarationPattern.exec(sourceText);

    while (match !== null) {
        const functionName = match[1] ?? "";
        const functionNameStart = (match.index ?? 0) + match[0].indexOf(functionName);
        declarations.push({
            name: functionName,
            start: functionNameStart
        });

        match = declarationPattern.exec(sourceText);
    }

    return declarations;
}

function collectNameOccurrences(sourceText: string, name: string): Array<{ start: number; end: number }> {
    const escapedName = escapeRegExp(name);
    const pattern = new RegExp(`(?<=^|[^A-Za-z0-9_])${escapedName}(?=[^A-Za-z0-9_]|$)`, "g");
    const hits: Array<{ start: number; end: number }> = [];
    let match: RegExpExecArray | null = pattern.exec(sourceText);

    while (match !== null) {
        const start = match.index ?? 0;
        hits.push({
            start,
            end: start + name.length
        });

        match = pattern.exec(sourceText);
    }

    return hits;
}

async function createFixtureSemanticAnalyzer(projectRoot: string, gmlFilePaths: ReadonlyArray<string>) {
    const sourceByPath = new Map<string, string>();
    const declarationIndex = new Map<string, { path: string; start: number }>();

    await Promise.all(
        gmlFilePaths.map(async (relativePath) => {
            const absolutePath = path.join(projectRoot, relativePath);
            const sourceText = await readFile(absolutePath, "utf8");
            sourceByPath.set(relativePath, sourceText);

            for (const declaration of collectFunctionDeclarations(sourceText)) {
                declarationIndex.set(declaration.name, {
                    path: relativePath,
                    start: declaration.start
                });
            }
        })
    );

    const occurrencesByName = new Map<string, Array<FixtureSymbolOccurrence>>();
    for (const functionName of declarationIndex.keys()) {
        const occurrences: Array<FixtureSymbolOccurrence> = [];
        for (const [relativePath, sourceText] of sourceByPath.entries()) {
            for (const hit of collectNameOccurrences(sourceText, functionName)) {
                const declaration = declarationIndex.get(functionName) ?? null;
                const isDefinition =
                    declaration !== null && declaration.path === relativePath && declaration.start === hit.start;

                occurrences.push({
                    path: relativePath,
                    start: hit.start,
                    end: hit.end,
                    kind: isDefinition ? "definition" : "reference"
                });
            }
        }

        occurrencesByName.set(functionName, occurrences);
    }

    const namingTargets: Array<FixtureNamingTarget> = [...declarationIndex.entries()].map(([name, declaration]) => ({
        name,
        category: "function",
        path: declaration.path,
        scopeId: null,
        symbolId: `gml/script/${name}`,
        occurrences: []
    }));

    return {
        listNamingConventionTargets(filePaths?: Array<string>) {
            if (!Array.isArray(filePaths) || filePaths.length === 0) {
                return namingTargets;
            }

            const isSelectedPath = createPathSelectionMatcher(projectRoot, filePaths, []);
            return namingTargets.filter((target) => isSelectedPath(target.path));
        },
        getSymbolOccurrences(symbolName: string) {
            return occurrencesByName.get(symbolName) ?? [];
        }
    };
}

async function collectProjectGmlFiles(projectRoot: string): Promise<Array<string>> {
    return await Core.listRelativeFilePathsRecursively(projectRoot, {
        includeFile: ({ entryName }) => entryName.endsWith(".gml")
    });
}

/**
 * Create the shared refactor-fixture adapter used by workspace and aggregate
 * fixture suites.
 *
 * @returns Refactor fixture adapter backed by the refactor workspace runtime API.
 */
export function createRefactorFixtureAdapter(): FixtureAdapter {
    return Object.freeze({
        workspaceName: "refactor",
        suiteName: "refactor fixtures",
        supports(kind: string) {
            return kind === "refactor";
        },
        async run({ config, workingProjectDirectoryPath, runProfiledStage }) {
            const normalizedConfig = normalizeRefactorProjectConfig(config.refactor);
            const projectRoot = workingProjectDirectoryPath ?? "";
            const gmlFilePaths = await collectProjectGmlFiles(projectRoot);
            const semantic = await createFixtureSemanticAnalyzer(projectRoot, gmlFilePaths);
            const engine = new RefactorEngine({ semantic });

            await runProfiledStage("refactor", async () => {
                await engine.executeConfiguredCodemods({
                    projectRoot,
                    targetPaths: [projectRoot],
                    gmlFilePaths,
                    config: normalizedConfig,
                    readFile: async (filePath) =>
                        await readFile(path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath), "utf8"),
                    writeFile: async (filePath, content) =>
                        await writeFile(
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
}
