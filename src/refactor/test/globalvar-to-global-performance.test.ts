/**
 * Performance regression guard for the globalvar-to-global codemod.
 *
 * Exercises `applyGlobalvarToGlobalCodemod` at a scale representative of
 * realistic GameMaker projects: 400 files where 10 declare globalvars,
 * 100 reference them, and 290 are irrelevant (no globalvar content at all).
 *
 * This test locks in three optimisations:
 *
 *   1. **Text-level fast-path skip** (`sourceContainsGlobalvarContent`):
 *      Files that contain neither the `globalvar` keyword nor any known
 *      globalvar name are skipped before the expensive AST parse, eliminating
 *      parse overhead for the majority of files in a typical project.
 *
 *   2. **Left-to-right string builder** (`applyEdits`):
 *      Edits are sorted ascending and assembled in a single forward pass
 *      instead of the previous descending-sort + repeated-slice pattern,
 *      avoiding O(n·m) intermediate string copies (~6-7× faster on files
 *      with many edits).
 *
 *   3. **Cross-file engine flow**: The engine's two-phase approach (collect
 *      declared names → rewrite references) is tested end-to-end via the
 *      public `applyGlobalvarToGlobalCodemod` API with a pre-built known-
 *      names set, matching the real `executeGlobalvarToGlobalCodemod` path.
 *
 * Baseline measurements (400-file mixed project, 5 sequential samples,
 * reported as per-sample median under test-runner load):
 *   After optimisation: ~168 ms median under test-runner load.
 *
 * Threshold is set to 1200 ms — calibrated for full-suite contention while
 * still catching algorithmic regressions such as accidental O(n²) edit
 * application, removal of the text-level fast-path, or redundant AST parses.
 */
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyGlobalvarToGlobalCodemod } = Refactor.GlobalvarToGlobal;

const DECLARING_FILE_COUNT = 10;
const REFERENCE_FILE_COUNT = 100;
const IRRELEVANT_FILE_COUNT = 290;
const GLOBALVARS_PER_DECLARING_FILE = 5;
const REFERENCES_PER_FILE = 15;
const VARIABLES_PER_IRRELEVANT_FILE = 40;
const PERFORMANCE_THRESHOLD_MS = 1200;

/** All globalvar names used across the synthetic project. */
const PROJECT_GLOBALVAR_NAMES: ReadonlyArray<string> = Array.from(
    { length: DECLARING_FILE_COUNT * GLOBALVARS_PER_DECLARING_FILE },
    (_, index) => `g_var_${index}`
);

const KNOWN_NAMES_SET: ReadonlySet<string> = new Set(PROJECT_GLOBALVAR_NAMES);

/**
 * Generate a GML file that declares globalvars and references them locally.
 * These files contain both the `globalvar` keyword and known identifiers, so
 * they exercise the full parse → traverse → edit → apply path.
 */
function generateDeclaringFile(fileIndex: number): string {
    const lines: Array<string> = [];
    const startNameIndex = fileIndex * GLOBALVARS_PER_DECLARING_FILE;

    for (let g = 0; g < GLOBALVARS_PER_DECLARING_FILE; g += 1) {
        const name = PROJECT_GLOBALVAR_NAMES[startNameIndex + g];
        lines.push(`globalvar ${name};`);
        for (let r = 0; r < REFERENCES_PER_FILE; r += 1) {
            lines.push(`${name} += ${r};`);
        }
    }

    return lines.join("\n");
}

/**
 * Generate a GML file that only references known globalvar names (no
 * declarations).  These files contain known identifiers but not the
 * `globalvar` keyword, so the fast-path correctly identifies them as relevant.
 */
function generateReferenceFile(_fileIndex: number): string {
    const lines: Array<string> = [];

    for (let g = 0; g < 3; g += 1) {
        const name = PROJECT_GLOBALVAR_NAMES[g % PROJECT_GLOBALVAR_NAMES.length];
        for (let r = 0; r < REFERENCES_PER_FILE; r += 1) {
            lines.push(`show_debug_message(${name});`);
        }
    }

    return lines.join("\n");
}

/**
 * Generate a GML file with no globalvar-related content at all.  The text-
 * level fast-path should skip these without parsing, which is the dominant
 * performance win on large projects.
 */
function generateIrrelevantFile(fileIndex: number): string {
    const lines: Array<string> = [];

    for (let v = 0; v < VARIABLES_PER_IRRELEVANT_FILE; v += 1) {
        const varName = `local_${fileIndex}_${v}`;
        lines.push(`var ${varName} = ${v};`, `show_debug_message(${varName});`);
    }

    return lines.join("\n");
}

void test("applyGlobalvarToGlobalCodemod stress test stays within the regression threshold (400 mixed-project files)", () => {
    const declaringFiles = Array.from({ length: DECLARING_FILE_COUNT }, (_, index) => generateDeclaringFile(index));
    const referenceFiles = Array.from({ length: REFERENCE_FILE_COUNT }, (_, index) => generateReferenceFile(index));
    const irrelevantFiles = Array.from({ length: IRRELEVANT_FILE_COUNT }, (_, index) => generateIrrelevantFile(index));
    const allFiles = [...declaringFiles, ...referenceFiles, ...irrelevantFiles];

    // Warm up JIT and module caches before the timed measurement.
    for (let warmupIndex = 0; warmupIndex < 10; warmupIndex += 1) {
        applyGlobalvarToGlobalCodemod(allFiles[warmupIndex] ?? "", KNOWN_NAMES_SET);
    }

    const SAMPLE_COUNT = 5;
    const samples: Array<number> = [];
    let lastChangedCount = 0;

    for (let sampleIndex = 0; sampleIndex < SAMPLE_COUNT; sampleIndex += 1) {
        const startTime = performance.now();
        let changedCount = 0;

        for (const file of allFiles) {
            const result = applyGlobalvarToGlobalCodemod(file, KNOWN_NAMES_SET);
            if (result.changed) {
                changedCount += 1;
            }
        }

        samples.push(performance.now() - startTime);
        lastChangedCount = changedCount;
    }

    samples.sort((left, right) => left - right);
    const medianSampleIndex = Math.floor(samples.length / 2);
    const medianDurationMs = samples[medianSampleIndex];

    // Declaring files + reference files should be changed; irrelevant files
    // should remain unchanged because the text-level fast-path skips them.
    const expectedChangedCount = DECLARING_FILE_COUNT + REFERENCE_FILE_COUNT;
    assert.equal(
        lastChangedCount,
        expectedChangedCount,
        `Expected ${expectedChangedCount} files to be changed ` +
            `(${DECLARING_FILE_COUNT} declaring + ${REFERENCE_FILE_COUNT} reference), ` +
            `received ${lastChangedCount}`
    );

    assert.ok(
        medianDurationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected globalvar-to-global stress test to finish within ${PERFORMANCE_THRESHOLD_MS} ms, ` +
            `received ${medianDurationMs.toFixed(2)} ms (median of ${SAMPLE_COUNT} samples)`
    );
});
