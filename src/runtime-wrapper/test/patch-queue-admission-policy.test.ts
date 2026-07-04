import assert from "node:assert/strict";
import test from "node:test";

import {
    evaluatePatchQueueAdmission,
    PATCH_QUEUE_COMPACTION_THRESHOLD_MULTIPLIER
} from "../src/browser/websocket/patch-queue-admission-policy.js";

void test("policy admits a patch when the live depth is below capacity", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 4,
        headIndex: 0,
        maxSize: 10
    });

    assert.deepEqual(decision, { action: "admit" });
});

void test("policy admits a patch when the live depth equals capacity minus one", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 9,
        headIndex: 0,
        maxSize: 10
    });

    assert.deepEqual(decision, { action: "admit" });
});

void test("policy requires eviction when the live depth equals capacity", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 10,
        headIndex: 0,
        maxSize: 10
    });

    assert.deepEqual(decision, {
        action: "drop-oldest",
        newHeadIndex: 1,
        compactUnderlyingArray: false
    });
});

void test("policy reports compaction once the post-eviction cursor reaches the compaction threshold", () => {
    const maxSize = 10;
    const compactionThreshold = maxSize * PATCH_QUEUE_COMPACTION_THRESHOLD_MULTIPLIER;

    const justBeforeThreshold = evaluatePatchQueueAdmission({
        effectiveSize: maxSize,
        headIndex: compactionThreshold - 2,
        maxSize
    });

    assert.deepEqual(justBeforeThreshold, {
        action: "drop-oldest",
        newHeadIndex: compactionThreshold - 1,
        compactUnderlyingArray: false
    });

    const atThreshold = evaluatePatchQueueAdmission({
        effectiveSize: maxSize,
        headIndex: compactionThreshold - 1,
        maxSize
    });

    assert.deepEqual(atThreshold, {
        action: "drop-oldest",
        newHeadIndex: compactionThreshold,
        compactUnderlyingArray: true
    });
});

void test("policy always advances the cursor by exactly one on eviction", () => {
    for (const headIndex of [0, 1, 5, 9, 100, 1000]) {
        const decision = evaluatePatchQueueAdmission({
            effectiveSize: 10,
            headIndex,
            maxSize: 10
        });

        assert.equal(decision.action, "drop-oldest");
        if (decision.action === "drop-oldest") {
            assert.equal(decision.newHeadIndex, headIndex + 1);
        }
    }
});

void test("policy never compacts on admission paths", () => {
    for (const effectiveSize of [0, 1, 5, 9]) {
        const decision = evaluatePatchQueueAdmission({
            effectiveSize,
            headIndex: 0,
            maxSize: 10
        });

        assert.equal(decision.action, "admit");
    }
});

void test("policy handles the smallest meaningful queue ceiling", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 1,
        headIndex: 0,
        maxSize: 1
    });

    assert.deepEqual(decision, {
        action: "drop-oldest",
        newHeadIndex: 1,
        compactUnderlyingArray: false
    });
});

void test("policy compacts the array when the cursor reaches twice the ceiling", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 1,
        headIndex: 1,
        maxSize: 1
    });

    assert.deepEqual(decision, {
        action: "drop-oldest",
        newHeadIndex: 2,
        compactUnderlyingArray: true
    });
});

void test("policy admits the first patch into an empty queue", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 0,
        headIndex: 0,
        maxSize: 10
    });

    assert.deepEqual(decision, { action: "admit" });
});

void test("policy admits when the cursor has drifted but live depth is below capacity", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 5,
        headIndex: 25,
        maxSize: 10
    });

    assert.deepEqual(decision, { action: "admit" });
});

void test("policy does not compact until the post-eviction cursor reaches the threshold", () => {
    const decision = evaluatePatchQueueAdmission({
        effectiveSize: 10,
        headIndex: 9,
        maxSize: 10
    });

    assert.deepEqual(decision, {
        action: "drop-oldest",
        newHeadIndex: 10,
        compactUnderlyingArray: false
    });
});
