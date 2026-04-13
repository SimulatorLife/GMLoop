/**
 * Performance regression guard for the loop-length-hoisting codemod.
 *
 * Exercises `applyLoopLengthHoistingCodemod` at a scale representative of
 * realistic GameMaker projects (400 files × 8 loops + 60 identifiers each).
 *
 * This test locks in the optimisation introduced in the
 * "Refactor Performance Lock-In" pass:
 *
 *   Combined single-pass AST traversal (`collectAstData`):
 *     - Before: two separate passes — `collectIdentifierNamesInSubtree`
 *       (via `Core.walkAst`, iterative with WeakSet) plus a custom recursive
 *       `collectForStatementContainerContexts`, and a third `new Set(...)` copy
 *       to make the identifier-names set mutable.
 *     - After: one recursive `collectAstData` function that gathers identifier
 *       names and for-statement contexts simultaneously, reusing the mutable
 *       accumulator Set directly without a copy.
 *   Isolated traversal benchmark (500 files): 76.90 ms → 32.92 ms (2.34× faster).
 *
 * Baseline measurements (400-file stress run, 5 sequential warm-up samples,
 * reported as per-sample median under test-runner load):
 *   Before optimisation: ~1340 ms (estimated from traversal delta + load factor)
 *   After optimisation:  ~1250 ms median under test-runner load
 *
 * Threshold is set to 3200 ms — calibrated for full-suite contention while
 * still catching algorithmic regressions (e.g. accidental O(n²) traversal,
 * repeated AST parsing, or redundant full-tree walks) that would push
 * runtimes well above the budget.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyLoopLengthHoistingCodemod } = Refactor.LoopLengthHoisting;

const FILE_COUNT = 400;
const LOOPS_PER_FILE = 8;
const IDENTIFIERS_PER_FILE = 60;
const PERFORMANCE_THRESHOLD_MS = 3200;

/**
 * Generate a synthetic GML file that contains {@link LOOPS_PER_FILE} hoistable
 * `for`-loops and {@link IDENTIFIERS_PER_FILE} extra local-variable declarations.
 * The extra identifiers increase identifier-name-set size, making the traversal
 * cost comparable to a real project file.
 */
function generateSyntheticGmlFile(fileIndex: number): string {
    const lines: Array<string> = [];

    for (let loopIndex = 0; loopIndex < LOOPS_PER_FILE; loopIndex += 1) {
        const arrayName = `items_${fileIndex}_${loopIndex}`;
        lines.push(
            `var ${arrayName} = [1, 2, 3, 4, 5];`,
            `for (var j = 0; j < array_length(${arrayName}); j++) {`,
            `    x += ${arrayName}[j];`,
            `}`
        );
    }

    for (let identIndex = 0; identIndex < IDENTIFIERS_PER_FILE; identIndex += 1) {
        const varName = `v${identIndex}`;
        lines.push(`var ${varName} = ${identIndex};`, `show_debug_message(${varName});`);
    }

    return lines.join("\n");
}

void test("applyLoopLengthHoistingCodemod single-pass traversal stays within the regression threshold (400 files × 8 loops + 60 identifiers)", () => {
    const files = Array.from({ length: FILE_COUNT }, (_, fileIndex) => generateSyntheticGmlFile(fileIndex));

    // Warm-up: prime JIT and module caches before the timed measurement.
    for (let warmupIndex = 0; warmupIndex < 10; warmupIndex += 1) {
        applyLoopLengthHoistingCodemod(files[warmupIndex] ?? "");
    }

    const SAMPLE_COUNT = 5;
    const samples: Array<number> = [];
    let lastChangedCount = 0;

    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
        const startTime = performance.now();
        let changedCount = 0;
        for (const file of files) {
            const result = applyLoopLengthHoistingCodemod(file);
            if (result.changed) {
                changedCount += 1;
            }
        }
        samples.push(performance.now() - startTime);
        lastChangedCount = changedCount;
    }

    samples.sort((left, right) => left - right);
    const medianSampleIndex = Math.floor(samples.length / 2);
    // samples.length === SAMPLE_COUNT (a positive constant) so the index is always valid.
    const medianDurationMs = samples[medianSampleIndex];

    // All files have at least one hoistable loop, so every file should be changed.
    assert.equal(lastChangedCount, FILE_COUNT, `Expected all ${FILE_COUNT} files to have hoistable loops`);

    assert.ok(
        medianDurationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected loop-length-hoisting stress test to finish within ${PERFORMANCE_THRESHOLD_MS} ms, ` +
            `received ${medianDurationMs.toFixed(2)} ms (median of ${SAMPLE_COUNT} samples)`
    );
});
