import assert from "node:assert/strict";
import test from "node:test";

import {
    createInitialFixWorkflowLogLines,
    createRunningFixWorkflowLogLines
} from "../src/app/fix-workflow-progress.js";

void test("createInitialFixWorkflowLogLines includes an immediate in-progress status line", () => {
    const logLines = createInitialFixWorkflowLogLines();

    assert.deepEqual(logLines, ["Starting project fix workflow...", "Fix workflow is still running..."]);
});

void test("createRunningFixWorkflowLogLines reports elapsed seconds while the fix workflow is running", () => {
    const zeroSeconds = createRunningFixWorkflowLogLines(200);
    const oneSecond = createRunningFixWorkflowLogLines(1000);
    const threeSeconds = createRunningFixWorkflowLogLines(3200);

    assert.deepEqual(zeroSeconds, [
        "Starting project fix workflow...",
        "Fix workflow is still running (0 seconds elapsed)..."
    ]);
    assert.deepEqual(oneSecond, [
        "Starting project fix workflow...",
        "Fix workflow is still running (1 second elapsed)..."
    ]);
    assert.deepEqual(threeSeconds, [
        "Starting project fix workflow...",
        "Fix workflow is still running (3 seconds elapsed)..."
    ]);
});

void test("fix workflow progress names the selected individual workflow", () => {
    assert.deepEqual(createInitialFixWorkflowLogLines("format"), [
        "Starting project format workflow...",
        "Project format workflow is still running..."
    ]);
    assert.deepEqual(createRunningFixWorkflowLogLines(2100, "lint"), [
        "Starting project lint workflow...",
        "Project lint workflow is still running (2 seconds elapsed)..."
    ]);
});
