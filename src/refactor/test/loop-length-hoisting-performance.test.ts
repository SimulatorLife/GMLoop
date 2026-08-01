import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { applyLoopLengthHoistingCodemod } from "../src/codemods/loop-length-hoisting/index.js";

const SPARSE_FILE_COUNT = 10_000;
const SPARSE_PERFORMANCE_THRESHOLD_MS = 120;

function buildSparseSourceText(index: number): string {
    return [
        `function sparse_script_${index}(values) {`,
        "    var total = 0;",
        "    for (var i = 0; i < values.length; i++) {",
        "        total += values[i];",
        "    }",
        "    return total;",
        "}",
        ""
    ].join("\n");
}

void test("loopLengthHoisting skips parser work on large sparse projects", () => {
    const sources = Array.from({ length: SPARSE_FILE_COUNT }, (_, index) => buildSparseSourceText(index));

    const startTime = performance.now();
    let changedCount = 0;
    for (const sourceText of sources) {
        const result = applyLoopLengthHoistingCodemod(sourceText);
        if (result.changed) {
            changedCount += 1;
        }
    }
    const durationMs = performance.now() - startTime;

    assert.equal(changedCount, 0);
    assert.ok(
        durationMs <= SPARSE_PERFORMANCE_THRESHOLD_MS,
        `Expected sparse loop-length hoisting scan under ${SPARSE_PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});
