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

const RENAME_COUNT = 64;
const VALIDATION_DELAY_MS = 20;
const PARALLEL_VALIDATION_THRESHOLD_MS = 520;

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
