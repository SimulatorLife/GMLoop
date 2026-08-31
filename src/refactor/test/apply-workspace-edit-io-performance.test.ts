import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { Refactor } from "../index.js";

const FILE_COUNT = 96;
const IO_DELAY_MS = 4;
const PERFORMANCE_THRESHOLD_MS = 450;

function waitForDelay(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });
}

void test("applyWorkspaceEdit keeps large write batches below the bounded-I/O regression threshold", async () => {
    const engine = new Refactor.RefactorEngine();
    const workspace = new Refactor.WorkspaceEdit();
    const sourceByPath = new Map<string, string>();
    const writesByPath = new Map<string, string>();

    for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
        const filePath = `scripts/demo_${fileIndex}.gml`;
        const originalContent = `var old_name_${fileIndex} = ${fileIndex};\n`;
        const replacementContent = `var new_name_${fileIndex} = ${fileIndex};\n`;
        sourceByPath.set(filePath, originalContent);
        workspace.addEdit(filePath, 0, originalContent.length, replacementContent);
    }

    const startTime = performance.now();
    const applied = await engine.applyWorkspaceEdit(workspace, {
        dryRun: false,
        includeResultContent: true,
        readFile: async (filePath) => {
            await waitForDelay(IO_DELAY_MS);
            return sourceByPath.get(filePath) ?? "";
        },
        writeFile: async (filePath, content) => {
            await waitForDelay(IO_DELAY_MS);
            writesByPath.set(filePath, content);
        }
    });
    const durationMs = performance.now() - startTime;

    assert.equal(applied.size, FILE_COUNT);
    assert.equal(writesByPath.size, FILE_COUNT);
    assert.equal(
        writesByPath.get("scripts/demo_0.gml"),
        "var new_name_0 = 0;\n",
        "Expected write callback to receive rewritten file content"
    );
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected bounded-I/O applyWorkspaceEdit runtime <= ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});

void test("applyWorkspaceEdit honors an explicit ioConcurrency override", async () => {
    const engine = new Refactor.RefactorEngine();
    const workspace = new Refactor.WorkspaceEdit();
    const sourceByPath = new Map<string, string>();

    for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
        const filePath = `scripts/demo_${fileIndex}.gml`;
        const originalContent = `var old_name_${fileIndex} = ${fileIndex};\n`;
        const replacementContent = `var new_name_${fileIndex} = ${fileIndex};\n`;
        sourceByPath.set(filePath, originalContent);
        workspace.addEdit(filePath, 0, originalContent.length, replacementContent);
    }

    let concurrentReads = 0;
    let maxObservedConcurrentReads = 0;

    const startTime = performance.now();
    await engine.applyWorkspaceEdit(workspace, {
        dryRun: true,
        includeResultContent: false,
        ioConcurrency: 1,
        readFile: async (filePath) => {
            concurrentReads += 1;
            maxObservedConcurrentReads = Math.max(maxObservedConcurrentReads, concurrentReads);
            await waitForDelay(IO_DELAY_MS);
            concurrentReads -= 1;
            return sourceByPath.get(filePath) ?? "";
        }
    });
    const durationMs = performance.now() - startTime;

    assert.equal(maxObservedConcurrentReads, 1, "Expected ioConcurrency: 1 to force fully sequential file reads");
    assert.ok(
        durationMs >= FILE_COUNT * IO_DELAY_MS,
        `Expected sequential ioConcurrency: 1 runtime to reflect ${FILE_COUNT} serialized reads, received ${durationMs.toFixed(2)}ms`
    );
});
