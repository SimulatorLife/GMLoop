/**
 * Shared test helpers for naming-convention codemod performance tests.
 *
 * Factories and stubs that are duplicated across multiple performance test files
 * live here so each test stays focused on its own benchmark assertions rather
 * than re-implementing synthetic fixture construction.
 */

import { Refactor } from "../../index.js";
import type {
    ConfiguredCodemodRunResult,
    NamingConventionTarget,
    PartialSemanticAnalyzer,
    RefactorProjectConfig
} from "../../src/types.js";

/**
 * Default naming-convention config shared by all performance test fixtures.
 */
export const DEFAULT_LOCAL_VARIABLE_NAMING_CONFIG: RefactorProjectConfig["codemods"]["namingConvention"] = {
    rules: {
        localVariable: {
            caseStyle: "camel"
        }
    }
};

/**
 * A synthetic source file and its naming-convention targets produced by
 * `createSyntheticLocalNamingFixture`.
 */
export type SyntheticLocalNamingFixture = {
    sourceText: string;
    targets: Array<NamingConventionTarget>;
};

/**
 * Build a minimal {@link PartialSemanticAnalyzer} stub that returns pre-built
 * naming targets for the given file-to-targets map.  Accepts an optional
 * callback that is invoked on every `listNamingConventionTargets` call,
 * allowing callers to track invocation counts or perform side effects.
 */
export function buildNamingConventionSemanticStub(
    targetsByFile: Map<string, Array<NamingConventionTarget>>,
    onCall?: () => void
): PartialSemanticAnalyzer {
    return {
        listNamingConventionTargets: async (filePaths?: Array<string>) => {
            onCall?.();
            const selectedPaths = filePaths === undefined ? null : new Set(filePaths);
            const matchingTargets: Array<NamingConventionTarget> = [];

            for (const [filePath, targets] of targetsByFile.entries()) {
                const resourcePath = filePath.replace(/\.gml$/i, ".yy");
                if (selectedPaths !== null && !selectedPaths.has(filePath) && !selectedPaths.has(resourcePath)) {
                    continue;
                }

                matchingTargets.push(...targets);
            }

            return matchingTargets;
        },
        validateEdits: async () => ({
            errors: [],
            warnings: []
        })
    };
}

/**
 * Factory that constructs the {@link Refactor.RefactorEngine.executeConfiguredCodemods}
 * executor closure used by naming-convention performance tests.
 *
 * Each test supplies its own engine, file list, and source-text map so the
 * captured closure variables differ.  The factory is shared to reduce repeated
 * fixture-building boilerplate while keeping each test self-contained.
 */
export function buildNamingConventionCodemodExecutor(
    engine: InstanceType<typeof Refactor.RefactorEngine>,
    gmlFilePaths: Array<string>,
    sourceTexts: Map<string, string>,
    projectRoot: string,
    namingConfig?: RefactorProjectConfig["codemods"]["namingConvention"]
): () => Promise<ConfiguredCodemodRunResult> {
    const config: RefactorProjectConfig = {
        codemods: {
            namingConvention: namingConfig ?? DEFAULT_LOCAL_VARIABLE_NAMING_CONFIG
        }
    };

    return () =>
        engine.executeConfiguredCodemods({
            projectRoot,
            targetPaths: [projectRoot],
            gmlFilePaths,
            config,
            readFile: async (filePath) => sourceTexts.get(filePath) ?? "",
            dryRun: true
        });
}

/**
 * Build a synthetic GML source file with `targetsPerFile` local-variable
 * naming-convention targets, each with one definition and one reference
 * occurrence.
 */
export function createSyntheticLocalNamingFixture(
    filePath: string,
    fileIndex: number,
    targetsPerFile: number
): SyntheticLocalNamingFixture {
    const lines: Array<string> = [];
    const targets: Array<NamingConventionTarget> = [];
    let offset = 0;

    for (let targetIndex = 0; targetIndex < targetsPerFile; targetIndex += 1) {
        const currentName = `bad_name_${fileIndex}_${targetIndex}`;
        const declarationLine = `var ${currentName} = ${targetIndex};\n`;
        const referenceLine = `show_debug_message(${currentName});\n`;
        const declarationStart = offset + declarationLine.indexOf(currentName);
        const referenceStart = offset + declarationLine.length + referenceLine.indexOf(currentName);

        lines.push(declarationLine, referenceLine);
        targets.push({
            name: currentName,
            category: "localVariable",
            path: filePath,
            scopeId: `scope:${fileIndex}:${targetIndex}`,
            symbolId: null,
            occurrences: [
                {
                    path: filePath,
                    start: declarationStart,
                    end: declarationStart + currentName.length,
                    kind: Refactor.OccurrenceKind.DEFINITION,
                    scopeId: `scope:${fileIndex}:${targetIndex}`
                },
                {
                    path: filePath,
                    start: referenceStart,
                    end: referenceStart + currentName.length,
                    kind: Refactor.OccurrenceKind.REFERENCE,
                    scopeId: `scope:${fileIndex}:${targetIndex}`
                }
            ]
        });

        offset += declarationLine.length + referenceLine.length;
    }

    return {
        sourceText: lines.join(""),
        targets
    };
}
