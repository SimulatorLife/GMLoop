import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
    buildLoopInvariantStressBatchSource,
    createOutputHash,
    lintSingleRuleWithTiming,
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    STILE_FIXTURE_URL,
    STILE_OPTIMIZE_MATH_OUTPUT_HASH
} from "./performance-test-helpers.js";

function buildNonMathAssignmentBatchSource(statementCount: number): string {
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index += 1) {
        lines.push(`field_${index} = other_${index};`);
    }

    lines.push("");
    return lines.join("\n");
}

function buildNonLogicalConditionBatchSource(statementCount: number): string {
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index += 1) {
        lines.push(`if (value_${index} > 0) {`, `    value_${index} = value_${index};`, "}");
    }

    lines.push("");
    return lines.join("\n");
}

function buildHeavyIfGuardBatchSource(statementCount: number): string {
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index += 1) {
        lines.push(
            `if (is_array(_arg_${index}) && !is_undefined(_arg_${index})) {`,
            `    _sum += array_length(_arg_${index});`,
            `    _flag = _flag || (_sum > ${index});`,
            "    _count += 1;",
            "}"
        );
    }

    lines.push("");
    return lines.join("\n");
}

function buildArithmeticChainBatchSource(statementCount: number): string {
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index += 1) {
        lines.push(`result_${index} = a_${index} * b_${index} + c_${index} * d_${index} + e_${index} * f_${index};`);
    }

    lines.push("");
    return lines.join("\n");
}

function buildAdditiveIdentifierBatchSource(statementCount: number): string {
    const lines: string[] = [];
    for (let index = 0; index < statementCount; index += 1) {
        lines.push(`sum_${index} = left_${index} + right_${index} + carry_${index};`);
    }

    lines.push("");
    return lines.join("\n");
}

function buildLoopHoistCollisionStressSource(loopCount: number, reservedHoistNameCount: number): string {
    const lines: string[] = ["var cached_value = 0;"];

    for (let index = 1; index <= reservedHoistNameCount; index += 1) {
        lines.push(`var cached_value_${index} = ${index};`);
    }

    lines.push("");

    for (let loopIndex = 0; loopIndex < loopCount; loopIndex += 1) {
        lines.push(
            `repeat (count_${loopIndex}) {`,
            `    total_${loopIndex} += (base_${loopIndex} + bias_${loopIndex}) * scale_${loopIndex};`,
            "}"
        );
    }

    lines.push("");
    return lines.join("\n");
}

void test(
    "optimize-math-expressions skips non-math batches without runaway traversal cost",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildNonMathAssignmentBatchSource(1500);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/optimize-math-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.equal(timedRun.outputText, source);
        assert.ok(
            timedRun.ruleMilliseconds < 8000,
            `expected optimize-math-expressions rule runtime under 8000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 10_000,
            `expected total lint runtime under 10000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-logical-flow skips non-logical batches without deep clone overhead",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildNonLogicalConditionBatchSource(1200);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/optimize-logical-flow",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.equal(timedRun.outputText, source);
        assert.ok(
            timedRun.ruleMilliseconds < 5000,
            `expected optimize-logical-flow rule runtime under 5000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 8000,
            `expected total lint runtime under 8000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-logical-flow avoids deep-cloning large guard bodies that cannot be simplified",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildHeavyIfGuardBatchSource(300);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/optimize-logical-flow",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.equal(timedRun.outputText, source);
        assert.ok(
            timedRun.ruleMilliseconds < 7000,
            `expected optimize-logical-flow rule runtime under 7000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 9000,
            `expected total lint runtime under 9000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-math-expressions scales linearly for long arithmetic assignment batches",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildArithmeticChainBatchSource(250);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/optimize-math-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.ok(
            timedRun.outputText.includes("dot_product_3d"),
            "expected optimize-math-expressions to keep applying arithmetic normalization"
        );
        assert.ok(
            timedRun.ruleMilliseconds < 7000,
            `expected optimize-math-expressions rule runtime under 7000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 9000,
            `expected total lint runtime under 9000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-math-expressions keeps dot-product auto-fixes within bounded runtime on large batches",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildArithmeticChainBatchSource(1000);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/optimize-math-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.ok(
            timedRun.outputText.includes("dot_product_3d"),
            "expected optimize-math-expressions to keep rewriting product chains to dot_product_3d"
        );
        assert.ok(
            timedRun.ruleMilliseconds < 4500,
            `expected optimize-math-expressions rule runtime under 4500ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 12_000,
            `expected total lint runtime under 12000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-math-expressions skips additive identifier batches without clone-heavy normalization",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildAdditiveIdentifierBatchSource(2500);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/optimize-math-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.equal(timedRun.outputText, source);
        assert.ok(
            timedRun.ruleMilliseconds < 1200,
            `expected optimize-math-expressions additive fast-path runtime under 1200ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-math-expressions preserves stile fixes within the real-file runtime budget",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = await readFile(STILE_FIXTURE_URL, "utf8");
        const timedRun = await lintSingleRuleWithTiming("gml/optimize-math-expressions", source, "stile.gml");

        assert.equal(timedRun.messages.length, 0);
        assert.equal(createOutputHash(timedRun.outputText), STILE_OPTIMIZE_MATH_OUTPUT_HASH);
        assert.ok(
            timedRun.ruleMilliseconds < 900,
            `expected optimize-math-expressions stile runtime under 900ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "prefer-loop-invariant-expressions avoids repeated subtree analysis on deep invariant loop expressions",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildLoopInvariantStressBatchSource(60, 15);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/prefer-loop-invariant-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.ok(
            timedRun.outputText.includes("var cached_value ="),
            "expected prefer-loop-invariant-expressions to keep hoisting loop-invariant subexpressions"
        );
        assert.ok(
            timedRun.ruleMilliseconds < 1500,
            `expected prefer-loop-invariant-expressions rule runtime under 1500ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 3000,
            `expected total lint runtime under 3000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "prefer-loop-invariant-expressions keeps large hoist-name resolution workloads within bounded runtime",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildLoopInvariantStressBatchSource(160, 30);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/prefer-loop-invariant-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.ok(
            timedRun.outputText.includes("var cached_value ="),
            "expected prefer-loop-invariant-expressions to keep hoisting loop-invariant subexpressions"
        );
        assert.ok(
            timedRun.ruleMilliseconds < 3000,
            `expected prefer-loop-invariant-expressions rule runtime under 3000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 8500,
            `expected total lint runtime under 8500ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "prefer-loop-invariant-expressions keeps local hoist-name resolution bounded on collision-heavy files",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const reservedHoistNameCount = 320;
        const source = buildLoopHoistCollisionStressSource(220, reservedHoistNameCount);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/prefer-loop-invariant-expressions",
            source,
            "local-collision-performance-regression.gml"
        );

        assert.ok(
            timedRun.outputText.includes("var cached_value_321 ="),
            "expected prefer-loop-invariant-expressions to keep hoisting through local name collisions"
        );
        assert.ok(
            timedRun.ruleMilliseconds < 2500,
            `expected prefer-loop-invariant-expressions runtime under 2500ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 8000,
            `expected total lint runtime under 8000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "prefer-loop-invariant-expressions keeps very large hoist-name resolution workloads within bounded runtime",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildLoopInvariantStressBatchSource(320, 60);
        const timedRun = await lintSingleRuleWithTiming(
            "gml/prefer-loop-invariant-expressions",
            source,
            "performance-regression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.ok(
            timedRun.outputText.includes("var cached_value ="),
            "expected prefer-loop-invariant-expressions to keep hoisting loop-invariant subexpressions"
        );
        assert.ok(
            timedRun.ruleMilliseconds < 10_000,
            `expected prefer-loop-invariant-expressions rule runtime under 10000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
        assert.ok(
            timedRun.elapsedMilliseconds < 30_000,
            `expected total lint runtime under 30000ms, received ${timedRun.elapsedMilliseconds.toFixed(2)}ms`
        );
    }
);
