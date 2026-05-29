/**
 * Shared fixtures for naming-convention codemod performance tests.
 *
 * Provides reusable factory functions that generate synthetic GML source text
 * paired with a `NamingConventionTarget` stub suitable for driving the
 * `PartialSemanticAnalyzer.listNamingConventionTargets` stub used across
 * performance regression tests.
 */
import { Refactor } from "../../index.js";
import type {
    ConfiguredCodemodRunResult,
    NamingConventionTarget,
    PartialSemanticAnalyzer,
    RefactorProjectConfig,
    SymbolOccurrence
} from "../../src/types.js";

export type SyntheticFileFixture = {
    sourceText: string;
    targets: Array<NamingConventionTarget>;
};

const DEFAULT_LOCAL_VARIABLE_NAMING_CONFIG: RefactorProjectConfig["codemods"]["namingConvention"] = {
    rules: {
        localVariable: {
            caseStyle: "camel"
        }
    }
};

/**
 * Build a minimal {@link PartialSemanticAnalyzer} stub that returns pre-built
 * naming targets for the given file-to-targets map.  Accepts an optional
 * callback that is invoked on every call, allowing callers to track
 * invocation counts or perform side effects per query.
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
 * Generate a single GML file fixture containing `targetsPerFile` paired
 * declaration+reference pairs using a unique `bad_name_{fileIndex}_{targetIndex}`
 * identifier.
 *
 * Each identifier produces exactly two occurrences:
 *   - a `DEFINITION` at the `var` declaration
 *   - a `REFERENCE` at the `show_debug_message` call
 *
 * By default, each identifier uses a distinct `scopeId` so no two targets share
 * a scope.  When a static `scopeId` is provided (e.g. `"shared_scope"`), all
 * targets share the same scope — useful for exercising duplicate-scope or
 * multi-declaration handling in the naming-convention planner hot path.
 *
 * @param filePath - Path for this fixture (used as the `path` field on targets).
 * @param fileIndex - Zero-based file index (used in generated identifier names).
 * @param targetsPerFile - Number of declaration+reference pairs to generate.
 * @param sharedScopeId - When provided, all targets receive this scopeId instead
 *                        of a per-target unique scope.  Intended for duplicate-scope
 *                        or multi-declaration test scenarios.
 */
/**
 * Build the occurrence array for a single declaration+reference pair.
 *
 * Used by both {@link createSyntheticLocalNamingFixture} and callers who
 * need to assemble duplicate-targets scenarios.  Keeps occurrence construction
 * consistent and eliminates the duplication that would otherwise appear in both
 * the base fixture and the duplicate-target builder.
 */
export function buildSingleTargetOccurrences(
    filePath: string,
    declarationStart: number,
    referenceStart: number,
    nameLength: number,
    scopeId: string
): Array<SymbolOccurrence> {
    return [
        {
            path: filePath,
            start: declarationStart,
            end: declarationStart + nameLength,
            kind: Refactor.OccurrenceKind.DEFINITION,
            scopeId
        },
        {
            path: filePath,
            start: referenceStart,
            end: referenceStart + nameLength,
            kind: Refactor.OccurrenceKind.REFERENCE,
            scopeId
        }
    ];
}

/**
 * Build the data for a single naming target used by both the base fixture and
 * the duplicate-target scenario builder.  Keeps the source-line assembly and
 * occurrence construction in one place so the two callers stay identical.
 */
export function buildSingleNamingTargetData(
    filePath: string,
    fileIndex: number,
    targetIndex: number,
    currentOffset: number,
    scopeId: string
): {
    name: string;
    declarationLine: string;
    referenceLine: string;
    declarationStart: number;
    referenceStart: number;
    newOffset: number;
    occurrences: Array<SymbolOccurrence>;
    target: NamingConventionTarget;
} {
    const name = `bad_name_${fileIndex}_${targetIndex}`;
    const declarationLine = `var ${name} = ${targetIndex};\n`;
    const referenceLine = `show_debug_message(${name});\n`;
    const declarationStart = currentOffset + declarationLine.indexOf(name);
    const referenceStart = currentOffset + declarationLine.length + referenceLine.indexOf(name);

    const occurrences = buildSingleTargetOccurrences(filePath, declarationStart, referenceStart, name.length, scopeId);

    return {
        name,
        declarationLine,
        referenceLine,
        declarationStart,
        referenceStart,
        newOffset: currentOffset + declarationLine.length + referenceLine.length,
        occurrences,
        target: {
            name,
            category: "localVariable",
            path: filePath,
            scopeId,
            symbolId: null,
            occurrences
        }
    };
}

export function createSyntheticLocalNamingFixture(
    filePath: string,
    fileIndex: number,
    targetsPerFile: number,
    sharedScopeId?: string
): SyntheticFileFixture {
    const lines: Array<string> = [];
    const targets: Array<NamingConventionTarget> = [];
    let offset = 0;

    for (let targetIndex = 0; targetIndex < targetsPerFile; targetIndex += 1) {
        const scopeId = sharedScopeId ?? `scope:${fileIndex}:${targetIndex}`;
        const data = buildSingleNamingTargetData(filePath, fileIndex, targetIndex, offset, scopeId);

        lines.push(data.declarationLine, data.referenceLine);
        targets.push(data.target);
        offset = data.newOffset;
    }

    return {
        sourceText: lines.join(""),
        targets
    };
}

/**
 * Default config used by the naming-convention codemod when no explicit override
 * is supplied to {@link buildNamingConventionCodemodExecutor}.
 */
export { DEFAULT_LOCAL_VARIABLE_NAMING_CONFIG };

/**
 * Build the {@link Refactor.RefactorEngine.executeConfiguredCodemods} executor
 * factory used across all naming-convention stress tests.  Each test supplies its
 * own engine, file list, and source-text map so the captured closure variables
 * differ, while the call-site shape is shared through this factory.
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
