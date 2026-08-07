import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";

const FILE_COUNT = 500;
// Simulated per-call I/O latency. Real disk/network latency varies wildly
// across CI hardware, which makes wall-clock performance guards flaky when
// they depend on actual filesystem speed. Injecting a fixed, artificial delay
// into readFile/writeFile makes the "sequential vs. concurrent" gap the
// dominant, deterministic factor in the measured duration instead of host
// I/O speed, so the threshold below is portable across machines.
const SIMULATED_IO_LATENCY_MS = 4;
// A fully sequential read+transform+write loop over FILE_COUNT files pays the
// simulated latency twice (one read, one write) for every file with no
// overlap: FILE_COUNT * SIMULATED_IO_LATENCY_MS * 2. Bounding concurrency at
// SINGLE_FILE_TEXT_CODEMOD_IO_CONCURRENCY_LIMIT (8) overlaps that latency
// across up to 8 in-flight files at once, so the expected wall clock is close
// to (FILE_COUNT / 8) * SIMULATED_IO_LATENCY_MS * 2. The threshold sits
// comfortably between the two, so a regression back to one-file-at-a-time
// processing fails this test regardless of host speed.
const PERFORMANCE_THRESHOLD_MS = (FILE_COUNT * SIMULATED_IO_LATENCY_MS * 2) / 2;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSourceTextWithScientificNotation(index: number): string {
    return [
        `function demo_script_${index}(items) {`,
        `    var scaled_${index} = items * 1e2;`,
        `    return scaled_${index};`,
        "}",
        ""
    ].join("\n");
}

void test("refactor codemod --write processes independent files with overlapping I/O instead of one at a time", async () => {
    const filePaths = Array.from({ length: FILE_COUNT }, (_, index) => `scripts/script_${index}.gml`);
    const contentByPath = new Map(
        filePaths.map((filePath, index) => [filePath, buildSourceTextWithScientificNotation(index)])
    );

    let inFlightCount = 0;
    let peakInFlightCount = 0;
    const trackConcurrency = async <T>(work: () => Promise<T>): Promise<T> => {
        inFlightCount += 1;
        peakInFlightCount = Math.max(peakInFlightCount, inFlightCount);
        try {
            await delay(SIMULATED_IO_LATENCY_MS);
            return await work();
        } finally {
            inFlightCount -= 1;
        }
    };

    const engine = new Refactor.RefactorEngine();
    const startTime = performance.now();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: filePaths,
        config: { codemods: { scientificNotation: {} } },
        onlyCodemods: ["scientificNotation"],
        dryRun: false,
        readFile: (filePath) => trackConcurrency(async () => contentByPath.get(filePath) ?? ""),
        writeFile: (filePath, content) =>
            trackConcurrency(async () => {
                contentByPath.set(filePath, content);
            })
    });
    const durationMs = performance.now() - startTime;

    assert.equal(result.summaries.length, 1);
    assert.equal(result.summaries[0]?.id, "scientificNotation");
    assert.equal(
        result.summaries[0]?.changedFiles.length,
        FILE_COUNT,
        "Expected every synthetic file to require scientific-notation migration"
    );
    assert.ok(
        peakInFlightCount > 1,
        `Expected multiple files to be read/written concurrently, but the peak concurrent I/O count was ${peakInFlightCount}. ` +
            "This indicates the codemod regressed to processing files strictly one at a time."
    );
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected concurrent file I/O to keep the write-mode codemod under ${PERFORMANCE_THRESHOLD_MS}ms ` +
            `for ${FILE_COUNT} files with ${SIMULATED_IO_LATENCY_MS}ms simulated I/O latency, received ${durationMs.toFixed(2)}ms`
    );
});
