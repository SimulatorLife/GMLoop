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
} from "../performance/index.js";

const PERFORMANCE_BUDGET_MULTIPLIER = 25;

function scaleBudget(milliseconds: number): number {
    return milliseconds * PERFORMANCE_BUDGET_MULTIPLIER;
}

void test(
    "optimize-math-expressions keeps repeated stile rewrites within the cached-normalization budget",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = await readFile(STILE_FIXTURE_URL, "utf8");
        const timedRun = lintSingleRuleWithTiming("gml/optimize-math-expressions", source, "stile.gml");

        assert.equal(timedRun.messages.length, 0);
        assert.equal(createOutputHash(timedRun.outputText), STILE_OPTIMIZE_MATH_OUTPUT_HASH);
        assert.ok(
            timedRun.ruleMilliseconds < scaleBudget(1000),
            `expected optimize-math-expressions runtime under 1000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "prefer-loop-invariant-expressions prunes deep invariant subtrees within the stress budget",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const source = buildLoopInvariantStressBatchSource(220, 60);
        const timedRun = lintSingleRuleWithTiming(
            "gml/prefer-loop-invariant-expressions",
            source,
            "optimized-autofix-performance.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.ok(
            timedRun.outputText.includes("var cached_value ="),
            "expected prefer-loop-invariant-expressions to keep hoisting loop-invariant subexpressions"
        );
        assert.ok(
            timedRun.ruleMilliseconds < scaleBudget(3000),
            `expected prefer-loop-invariant-expressions runtime under 3000ms, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
    }
);

void test(
    "optimize-math-expressions skips pathological giant candidates to stay within memory budget",
    SEQUENTIAL_PERFORMANCE_TEST_OPTIONS,
    async () => {
        const additiveTerms = Array.from({ length: 1200 }, (_, index) => `value_${index}`).join(" + ");
        const source = ["function stress_math() {", `    return (${additiveTerms}) / 3;`, "}", ""].join("\n");

        const timedRun = lintSingleRuleWithTiming(
            "gml/optimize-math-expressions",
            source,
            "optimized-autofix-giant-expression.gml"
        );

        assert.equal(timedRun.messages.length, 0);
        assert.equal(timedRun.outputText, source);
        assert.ok(
            timedRun.ruleMilliseconds < scaleBudget(1000),
            `expected optimize-math-expressions runtime under 1000ms for giant candidates, received ${timedRun.ruleMilliseconds.toFixed(2)}ms`
        );
    }
);
