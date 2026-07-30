import assert from "node:assert/strict";
import test from "node:test";

import {
    createSemanticIndexProgressController,
    normalizeProjectSemanticIndexBuildSummary,
    normalizeProjectSemanticIndexProgress,
    type SemanticIndexLeaseBinding,
    type SemanticIndexMutableRecord
} from "../src/modules/runtime/semantic-index-progress.js";

function createBindingHarness(initial?: SemanticIndexMutableRecord): {
    binding: SemanticIndexLeaseBinding;
    state: { completed: boolean; persistedCount: number; record: SemanticIndexMutableRecord };
} {
    const initialRecord: SemanticIndexMutableRecord = initial ?? {
        phase: "starting",
        semanticIndex: null,
        updatedAt: 0
    };
    const state = {
        completed: false as boolean,
        persistedCount: 0,
        record: initialRecord
    };
    const binding: SemanticIndexLeaseBinding = {
        getCurrentRecord: () => state.record,
        isCompleted: () => state.completed,
        persist: () => {
            state.persistedCount += 1;
        },
        refreshCurrentRecord: () => undefined,
        setCurrentRecord: (next) => {
            state.record = next;
        }
    };
    return { binding, state };
}

void test("semantic-index progress: update flips phase, sets progress, and persists", () => {
    const { binding, state } = createBindingHarness();
    const controller = createSemanticIndexProgressController(binding);

    controller.update({ current: 2, stage: "gml-parse", total: 8 });

    assert.equal(state.record.phase, "semantic-index");
    assert.deepEqual(state.record.semanticIndex, { current: 2, stage: "gml-parse", total: 8 });
    assert.ok(state.record.updatedAt > 0);
    assert.equal(state.persistedCount, 1);
});

void test("semantic-index progress: complete stage always persists", () => {
    const { binding, state } = createBindingHarness();
    const controller = createSemanticIndexProgressController(binding);

    controller.update({
        stage: "complete",
        summary: {
            cacheHitCount: 4,
            cacheMissCount: 1,
            slowestFiles: [{ durationMs: 12, relativePath: "scripts/player.gml" }],
            totalDurationMs: 240
        }
    });

    assert.equal(state.record.semanticIndex?.stage, "complete");
    assert.equal(state.persistedCount, 1);
});

void test("semantic-index progress: clear removes the progress field and persists", () => {
    const { binding, state } = createBindingHarness({
        phase: "semantic-index",
        semanticIndex: { current: 5, stage: "gml-parse", total: 10 },
        updatedAt: 1
    });
    state.persistedCount = 0;
    const controller = createSemanticIndexProgressController(binding);

    controller.clear();

    assert.equal(state.record.semanticIndex, null);
    assert.ok(state.record.updatedAt > 1);
    assert.equal(state.persistedCount, 1);
});

void test("semantic-index progress: updates on a completed lease are ignored", () => {
    const { binding, state } = createBindingHarness();
    state.completed = true;
    const controller = createSemanticIndexProgressController(binding);

    controller.update({ current: 1, stage: "gml-parse", total: 2 });
    controller.clear();

    assert.equal(state.record.phase, "starting");
    assert.equal(state.record.semanticIndex, null);
    assert.equal(state.persistedCount, 0);
});

void test("semantic-index progress: refresh re-reads the record before applying the update", () => {
    const { binding, state } = createBindingHarness();
    const externalRecord: SemanticIndexMutableRecord = {
        phase: "linting",
        semanticIndex: null,
        updatedAt: 42
    };
    binding.refreshCurrentRecord = () => {
        binding.setCurrentRecord(externalRecord);
    };
    const controller = createSemanticIndexProgressController(binding);

    controller.update({ current: 3, stage: "gml-parse", total: 4 });

    assert.equal(state.record.phase, "semantic-index");
    assert.deepEqual(state.record.semanticIndex, { current: 3, stage: "gml-parse", total: 4 });
});

void test("normalizeProjectSemanticIndexProgress rejects invalid shapes", () => {
    assert.equal(normalizeProjectSemanticIndexProgress(null), null);
    assert.equal(normalizeProjectSemanticIndexProgress("not an object"), null);
    assert.equal(normalizeProjectSemanticIndexProgress({ stage: "other" }), null);
    assert.equal(normalizeProjectSemanticIndexProgress({ current: -1, stage: "gml-parse", total: 4 }), null);
    assert.equal(normalizeProjectSemanticIndexProgress({ current: 1.5, stage: "gml-parse", total: 2 }), null);
    assert.deepEqual(normalizeProjectSemanticIndexProgress({ current: 3, stage: "gml-parse", total: 8 }), {
        current: 3,
        stage: "gml-parse",
        total: 8
    });
});

void test("normalizeProjectSemanticIndexProgress accepts complete stage with valid summary", () => {
    const progress = normalizeProjectSemanticIndexProgress({
        stage: "complete",
        summary: {
            cacheHitCount: 1,
            cacheMissCount: 2,
            slowestFiles: [],
            totalDurationMs: 100
        }
    });
    assert.deepEqual(progress, {
        stage: "complete",
        summary: {
            cacheHitCount: 1,
            cacheMissCount: 2,
            slowestFiles: [],
            totalDurationMs: 100
        }
    });
});

void test("normalizeProjectSemanticIndexProgress rejects complete stage with bad summary", () => {
    assert.equal(
        normalizeProjectSemanticIndexProgress({
            stage: "complete",
            summary: { cacheHitCount: "nope", cacheMissCount: 0, slowestFiles: [], totalDurationMs: 0 }
        }),
        null
    );
});

void test("normalizeProjectSemanticIndexBuildSummary filters malformed slowestFiles entries", () => {
    const summary = normalizeProjectSemanticIndexBuildSummary({
        cacheHitCount: 0,
        cacheMissCount: 0,
        slowestFiles: [
            { durationMs: 10, relativePath: "a.gml" },
            { durationMs: "nope", relativePath: "b.gml" },
            null,
            { relativePath: "c.gml" }
        ],
        totalDurationMs: 10
    });
    assert.deepEqual(summary, {
        cacheHitCount: 0,
        cacheMissCount: 0,
        slowestFiles: [{ durationMs: 10, relativePath: "a.gml" }],
        totalDurationMs: 10
    });
});
