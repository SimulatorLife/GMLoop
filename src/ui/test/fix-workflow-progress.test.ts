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
    const afterOneSecond = createRunningFixWorkflowLogLines(1000);
    const afterThreeSeconds = createRunningFixWorkflowLogLines(3200);

    assert.deepEqual(afterOneSecond, [
        "Starting project fix workflow...",
        "Fix workflow is still running (1 second elapsed)..."
    ]);
    assert.deepEqual(afterThreeSeconds, [
        "Starting project fix workflow...",
        "Fix workflow is still running (3 seconds elapsed)..."
    ]);
});
