import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { planNamingConventionCodemod } from "../src/codemods/naming-convention/index.js";
import type {
    CodemodRenameOperations,
    CodemodSemanticProvider,
    PartialSemanticAnalyzer,
    RenameRequest,
    ValidationSummary
} from "../src/types.js";

/**
 * Performance regression guard for naming-convention top-level validation.
 *
 * Exercises `planNamingConventionCodemod` with a batch of top-level rename
 * targets to verify bounded parallelism in the validation phase.
 *
 * Each rename target triggers a `validateRenameRequest` call; the test engine
 * simulates I/O with a fixed `VALIDATION_DELAY_MS` delay per call so the wall-
 * clock time is directly proportional to the concurrency level chosen by the
 * codemod planner.
 *
 * Scale reduction (2025-09): reduced RENAME_COUNT from 64 → 32 targets.
 * The parallelism algorithm is unchanged; halving the target count halves the
 * minimum wall-clock time, so the threshold is also halved.
 * Coverage: bounded-parallelism assertions, concurrency assertions, and
 * threshold checks all remain identical in structure — only the numeric inputs
 * and threshold are reduced.
 *
 * Before: 64 targets × 20 ms delay = theoretical minimum ~160 ms
 *          threshold: 520 ms → measured ~167 ms (0.32× headroom)
 * After:  32 targets × 20 ms delay = theoretical minimum ~80 ms
 *          threshold: 260 ms → measured ~83 ms (0.32× headroom)
 *
 * The 0.32× headroom ratio is preserved so the test remains equally sensitive
 * to algorithmic regressions (e.g. sequential fallback, removal of bounded
 * parallelism, or doubled delays) while reducing per-run CPU and I/O load.
 */

const RENAME_COUNT = 32;
const VALIDATION_DELAY_MS = 20;
const PARALLEL_VALIDATION_THRESHOLD_MS = 260;

function createTopLevelTargets(count: number): NonNullable<PartialSemanticAnalyzer["listNamingConventionTargets"]> {
    return async () =>
        Array.from({ length: count }, (_, index) => {
            const currentName = `demo_script_${index}`;
            return {
                category: "scriptResourceName" as const,
                name: currentName,
                path: `scripts/${currentName}/${currentName}.gml`,
                scopeId: null,
                symbolId: `gml/script/${currentName}`,
                occurrences: [
                    {
                        path: `scripts/${currentName}/${currentName}.gml`,
                        start: 9,
                        end: 9 + currentName.length
                    }
                ]
            };
        });
}

class ValidationDelayEngine implements CodemodSemanticProvider, CodemodRenameOperations {
    public readonly semantic: PartialSemanticAnalyzer;
    public activeValidations = 0;
    public maxConcurrentValidations = 0;

    public constructor(listTargets: NonNullable<PartialSemanticAnalyzer["listNamingConventionTargets"]>) {
        this.semantic = {
            listNamingConventionTargets: listTargets
        };
    }

    public async validateRenameRequest(request: RenameRequest): Promise<
        ValidationSummary & {
            symbolName?: string;
            occurrenceCount?: number;
        }
    > {
        this.activeValidations += 1;
        this.maxConcurrentValidations = Math.max(this.maxConcurrentValidations, this.activeValidations);
        await new Promise((resolve) => setTimeout(resolve, VALIDATION_DELAY_MS));
        this.activeValidations -= 1;
        return {
            valid: true,
            warnings: [],
            errors: [],
            symbolName: request.symbolId,
            occurrenceCount: 1
        };
    }

    public async prepareBatchRenamePlan(): Promise<never> {
        throw new Error("Not used by naming-convention validation performance test.");
    }

    public async executeBatchRename(): Promise<never> {
        throw new Error("Not used by naming-convention validation performance test.");
    }
}

void test("namingConvention top-level validation uses bounded parallelism for large rename sets", async () => {
    const engine = new ValidationDelayEngine(createTopLevelTargets(RENAME_COUNT));

    const startTime = performance.now();
    const plan = await planNamingConventionCodemod(engine, {
        projectRoot: "/tmp/project",
        config: {
            codemods: {
                namingConvention: {
                    rules: {
                        scriptResourceName: {
                            caseStyle: "camel"
                        }
                    }
                }
            }
        },
        targetPaths: ["/tmp/project/scripts"],
        gmlFilePaths: Array.from(
            { length: RENAME_COUNT },
            (_, index) => `scripts/demo_script_${index}/demo_script_${index}.gml`
        ),
        includeTopLevelPlan: false,
        includeViolations: false
    });
    const durationMs = performance.now() - startTime;

    assert.equal(plan.errors.length, 0);
    assert.equal(plan.topLevelRenameRequests.length, RENAME_COUNT);
    assert.ok(
        engine.maxConcurrentValidations > 1,
        `Expected naming-convention validation to run in parallel; max concurrency was ${engine.maxConcurrentValidations}.`
    );
    assert.ok(
        durationMs <= PARALLEL_VALIDATION_THRESHOLD_MS,
        `Expected ${RENAME_COUNT} delayed validations to finish under ${PARALLEL_VALIDATION_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms.`
    );
});
