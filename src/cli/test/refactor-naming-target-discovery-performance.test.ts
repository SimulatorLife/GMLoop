import assert from "node:assert/strict";
import test from "node:test";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import {
    createTopLevelNamingConventionFixture,
    measureMedianDurationMs
} from "./test-helpers/refactor-top-level-naming-performance.js";

const PERFORMANCE_THRESHOLD_MS = 250;

void test("refactor naming target discovery skips reference-only files and stays within the threshold", async () => {
    const fixture = createTopLevelNamingConventionFixture();
    const expectedTargetCount = Object.values(fixture.files).filter(
        (fileRecord) => fileRecord.declarations.length > 0
    ).length;

    const executeStressRun = async () => {
        const semantic = new GmlSemanticBridge(fixture.projectIndex, fixture.projectRoot);
        return semantic.listNamingConventionTargets([...fixture.sourceTexts.keys()]);
    };

    await executeStressRun();
    const { durationMs, result } = await measureMedianDurationMs(3, executeStressRun);

    assert.equal(result.length, expectedTargetCount);
    assert.ok(
        durationMs <= PERFORMANCE_THRESHOLD_MS,
        `Expected naming target discovery under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
    );
});
