import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";

const FILE_COUNT = 300;
const LOCAL_PERFORMANCE_THRESHOLD_MS = 900;
const CI_PERFORMANCE_THRESHOLD_MS = 2500;

function resolvePerformanceThresholdMs(): number {
    // CI merge runners can be significantly noisier than local/dev runs.
    // Keep the tighter local guard while allowing a realistic CI ceiling.
    return process.env.CI ? CI_PERFORMANCE_THRESHOLD_MS : LOCAL_PERFORMANCE_THRESHOLD_MS;
}

const PERFORMANCE_THRESHOLD_MS = resolvePerformanceThresholdMs();

function createSourceText(fileIndex: number): string {
    return [`globalvar score_${fileIndex};`, `score_${fileIndex} += 1e2;`, ""].join("\n");
}

/**
 * Stress enough files to exceed the historical 256-entry write-through cache.
 * Before sizing the cache to the selected project, the second codemod pass
 * thrashed the cache and re-read every file that the first pass had just
 * rewritten.
 */
void test(`write-mode configured codemods reuse changed file content across passes (${FILE_COUNT} files)`, async () => {
    const filePaths = Array.from(
        { length: FILE_COUNT },
        (_, fileIndex) => `scripts/script_${String(fileIndex).padStart(4, "0")}.gml`
    );
    const contentByPath = new Map(filePaths.map((filePath, fileIndex) => [filePath, createSourceText(fileIndex)]));
    const engine = new Refactor.RefactorEngine();
    let readCount = 0;
    let writeCount = 0;

    const startTime = performance.now();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: filePaths,
        config: {
            codemods: {
                scientificNotation: {},
                globalvarToGlobal: {}
            }
        },
        onlyCodemods: ["scientificNotation", "globalvarToGlobal"],
        dryRun: false,
        readFile: async (filePath) => {
            readCount += 1;
            return contentByPath.get(filePath) ?? "";
        },
        writeFile: async (filePath, content) => {
            writeCount += 1;
            contentByPath.set(filePath, content);
        }
    });
    const durationMs = performance.now() - startTime;

    assert.equal(result.summaries.length, 2);
    assert.equal(result.summaries[0]?.changedFiles.length, FILE_COUNT);
    assert.equal(result.summaries[1]?.changedFiles.length, FILE_COUNT);
    assert.equal(writeCount, FILE_COUNT * 2);
    assert.equal(
        readCount,
        FILE_COUNT,
        "Expected the write-through cache to serve the second codemod pass without re-reading every file"
    );
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected write-mode codemod stress run to finish within ${PERFORMANCE_THRESHOLD_MS}ms, ` +
            `received ${durationMs.toFixed(2)}ms`
    );
});
