import assert from "node:assert/strict";
import test from "node:test";

import {
    findLatestBotAutoMergeState,
    normalizeAutoMergeState,
    parseAutoMergeState,
    serializeAutoMergeState
} from "../src/commands/ci-automerge-state.js";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);

void test("auto-merge state round-trips through its durable comment marker", () => {
    const marker = serializeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: true,
        trusted: true,
        reason: "clean",
        retry: 0,
        runId: 123
    });

    assert.deepEqual(parseAutoMergeState(marker), normalizeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: true,
        trusted: true,
        reason: "clean",
        retry: 0,
        runId: 123,
        updatedAt: parseAutoMergeState(marker)?.updatedAt
    }));
});

void test("latest trusted state only considers valid bot-authored markers", () => {
    const older = serializeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: false,
        trusted: false,
        reason: "pending",
        retry: 0,
        runId: 0
    });
    const newer = serializeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: true,
        trusted: true,
        reason: "clean",
        retry: 0,
        runId: 456
    });

    const state = findLatestBotAutoMergeState([
        { body: older, updated_at: "2026-08-08T20:00:00Z", user: { login: "github-actions[bot]" } },
        { body: newer, updated_at: "2026-08-08T20:01:00Z", user: { login: "github-actions[bot]" } },
        { body: older, updated_at: "2026-08-08T20:02:00Z", user: { login: "someone-else" } }
    ]);

    assert.equal(state?.green, true);
    assert.equal(state?.runId, 456);
});

void test("malformed or unsupported auto-merge state is rejected", () => {
    assert.equal(parseAutoMergeState("<!-- automerge-state nope -->"), null);
    assert.throws(() => normalizeAutoMergeState({
        pr: 42,
        head: "bad",
        base: BASE_SHA,
        green: false,
        trusted: true,
        reason: "infrastructure",
        retry: 0,
        runId: 1
    }));
});
