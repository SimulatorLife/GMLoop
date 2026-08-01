import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { GmlSemanticBridge } from "../src/modules/refactor/index.js";

const METADATA_EDIT_COUNT = 1200;
const PERFORMANCE_THRESHOLD_MS = 250;

function createSyntheticMetadataContent(resourceIndex: number): string {
    return JSON.stringify(
        {
            resourceType: "GMScript",
            resourceVersion: "2.0",
            name: `demo_script_${resourceIndex}`,
            tags: ["perf", "refactor", `idx_${resourceIndex}`],
            configDeltas: [],
            id: {
                name: `demo_script_${resourceIndex}`,
                path: `scripts/demo_script_${resourceIndex}/demo_script_${resourceIndex}.yy`
            }
        },
        null,
        2
    );
}

void test("stageWorkspaceEdit keeps metadata staging under the lazy-parse threshold", () => {
    const bridge = new GmlSemanticBridge({}, "/synthetic-project");
    const metadataEdits = Array.from({ length: METADATA_EDIT_COUNT }, (_, resourceIndex) => ({
        path: `scripts/demo_script_${resourceIndex}/demo_script_${resourceIndex}.yy`,
        content: createSyntheticMetadataContent(resourceIndex)
    }));

    const startTime = performance.now();
    bridge.stageWorkspaceEdit({
        metadataEdits
    });
    const durationMs = performance.now() - startTime;

    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected stageWorkspaceEdit to run under ${PERFORMANCE_THRESHOLD_MS}ms for ${METADATA_EDIT_COUNT} metadata edits, received ${durationMs.toFixed(2)}ms`
    );
});
