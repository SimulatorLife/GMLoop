import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "@gmloop/refactor";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import {
    createTopLevelNamingConventionFixture,
    measureMedianDurationMs
} from "./test-helpers/refactor-top-level-naming-performance.js";

const FUNCTION_COUNT = 2400;
const PERFORMANCE_THRESHOLD_MS = 700;

type RenameValidationCacheStats = {
    evictions: number;
    hits: number;
    misses: number;
    size: number;
};

type SemanticCacheStats = {
    evictions: number;
    hits: number;
    misses: number;
    size: number;
};

void test("refactor codemod runtime stays within the indexed semantic bridge threshold", async () => {
    const fixture = createTopLevelNamingConventionFixture();
    const executeStressRun = async () => {
        const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);
        let macroDependencyQueryCount = 0;
        const originalListMacroExpansionDependencies = semantic.listMacroExpansionDependencies.bind(semantic);

        semantic.listMacroExpansionDependencies = (...args) => {
            macroDependencyQueryCount += 1;
            return originalListMacroExpansionDependencies(...args);
        };

        const engine = new Refactor.RefactorEngine({ semantic });

        const result = await engine.executeConfiguredCodemods({
            projectRoot: fixture.projectRoot,
            targetPaths: [fixture.projectRoot],
            gmlFilePaths: [...fixture.sourceTexts.keys()],
            config: {
                codemods: {
                    namingConvention: {
                        rules: {
                            function: {
                                caseStyle: "camel"
                            }
                        }
                    }
                }
            },
            readFile: async (filePath) => fixture.sourceTexts.get(filePath) ?? "",
            dryRun: true,
            onlyCodemods: ["namingConvention"]
        });

        return {
            cacheStats: (
                engine as unknown as {
                    renameValidationCache: { getStats(): RenameValidationCacheStats };
                }
            ).renameValidationCache.getStats(),
            semanticCacheStats: (
                engine as unknown as {
                    getSemanticCacheStats(): SemanticCacheStats;
                }
            ).getSemanticCacheStats(),
            macroDependencyQueryCount,
            result
        };
    };

    await executeStressRun();
    const { durationMs, result } = await measureMedianDurationMs(3, executeStressRun);

    assert.equal(result.result.summaries.length, 1);
    assert.equal(result.result.summaries[0]?.id, "namingConvention");
    assert.equal(result.result.summaries[0]?.changed, true);
    assert.equal(result.result.appliedFiles.size, FUNCTION_COUNT + 1);
    assert.equal(result.cacheStats.evictions, 0);
    assert.equal(result.cacheStats.hits, 0);
    assert.equal(result.cacheStats.misses, FUNCTION_COUNT);
    assert.ok(
        result.semanticCacheStats.hits >= FUNCTION_COUNT,
        `Expected semantic cache reuse during batch planning, received ${result.semanticCacheStats.hits} hits`
    );
    assert.ok(
        result.semanticCacheStats.size > 0,
        "Expected semantic cache to retain batched symbol query results during codemod planning"
    );
    assert.equal(
        result.macroDependencyQueryCount,
        0,
        "Expected top-level naming codemods to skip macro dependency analysis when no symbol-local targets are selected"
    );
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected namingConvention codemod runtime to finish within ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});
