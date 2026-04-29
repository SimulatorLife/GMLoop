import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

type RefactorFixtureSymbolOccurrence = {
    path: string;
    start: number;
    end: number;
    kind: "definition" | "reference";
};

type RefactorFixtureNamingTarget = {
    name: string;
    category: "function";
    path: string;
    scopeId: string | null;
    symbolId: string;
    occurrences: Array<RefactorFixtureSymbolOccurrence>;
};

type RefactorFixtureSemanticAnalyzer = {
    listNamingConventionTargets(filePaths?: Array<string>): Array<RefactorFixtureNamingTarget>;
    getSymbolOccurrences(symbolName: string): Array<RefactorFixtureSymbolOccurrence>;
};

function escapeRegularExpression(source: string): string {
    return source.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function collectFunctionDeclarations(sourceText: string): Array<{ name: string; start: number }> {
    const declarations: Array<{ name: string; start: number }> = [];
    const declarationPattern = /function\s+(?<name>[A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match: RegExpExecArray | null = declarationPattern.exec(sourceText);

    while (match !== null) {
        const functionName = match.groups?.name ?? "";
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
    const escapedName = escapeRegularExpression(name);
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

/**
 * Build the semantic analyzer contract used by refactor fixture runs from raw
 * fixture project source files.
 *
 * @param projectRoot Root directory containing the fixture project files.
 * @param gmlFilePaths Relative GML file paths discovered in the fixture project.
 * @returns Semantic analyzer implementation backed by discovered fixture symbols.
 */
export async function createRefactorFixtureSemanticAnalyzer(
    projectRoot: string,
    gmlFilePaths: ReadonlyArray<string>
): Promise<RefactorFixtureSemanticAnalyzer> {
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

    const occurrencesByName = new Map<string, Array<RefactorFixtureSymbolOccurrence>>();
    for (const functionName of declarationIndex.keys()) {
        const occurrences: Array<RefactorFixtureSymbolOccurrence> = [];
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

    const namingTargets: Array<RefactorFixtureNamingTarget> = [...declarationIndex.entries()].map(
        ([name, declaration]) => ({
            name,
            category: "function",
            path: declaration.path,
            scopeId: null,
            symbolId: `gml/script/${name}`,
            occurrences: []
        })
    );

    return {
        listNamingConventionTargets(filePaths?: Array<string>) {
            if (!Array.isArray(filePaths) || filePaths.length === 0) {
                return namingTargets;
            }

            const selectedPaths = new Set(filePaths.map((entry) => path.resolve(projectRoot, entry)));
            return namingTargets.filter((target) => selectedPaths.has(path.resolve(projectRoot, target.path)));
        },
        getSymbolOccurrences(symbolName: string) {
            return occurrencesByName.get(symbolName) ?? [];
        }
    } satisfies RefactorFixtureSemanticAnalyzer;
}

/**
 * Recursively collect relative `.gml` file paths for a fixture project.
 *
 * @param projectRoot Root directory of the fixture project tree.
 * @returns Sorted list of `.gml` file paths relative to `projectRoot`.
 */
export async function collectRefactorProjectGmlFiles(projectRoot: string): Promise<Array<string>> {
    const relativePaths: Array<string> = [];

    async function walk(currentPath: string): Promise<void> {
        const entries = await readdir(currentPath, { withFileTypes: true });
        await Promise.all(
            entries.map(async (entry) => {
                const entryPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    await walk(entryPath);
                    return;
                }

                if (!entry.isFile() || !entry.name.endsWith(".gml")) {
                    return;
                }

                relativePaths.push(path.relative(projectRoot, entryPath).split(path.sep).join("/"));
            })
        );
    }

    await walk(projectRoot);
    return relativePaths.sort((left, right) => left.localeCompare(right));
}
