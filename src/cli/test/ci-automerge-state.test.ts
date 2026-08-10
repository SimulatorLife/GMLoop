import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    AUTO_MERGE_FINALIZER_RUN_PREFIX,
    AUTO_MERGE_SUMMARY_COMMENT_MARKER,
    assertAutoMergeControlPlaneContract,
    findBotAutoMergeSummaryComment,
    findLatestBotAutoMergeState,
    normalizeAutoMergeState,
    parseAutoMergeFinalizerRunTitle,
    parseAutoMergeState,
    parseAutoMergeValidationRunTitle,
    renderAutoMergeStateComment,
    serializeAutoMergeState,
    validationRunNeedsFinalization
} from "../src/commands/ci-automerge-state.js";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

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

void test("canonical summary rendering and lookup share one durable marker", () => {
    const body = renderAutoMergeStateComment({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: false,
        trusted: false,
        reason: "pending",
        retry: 0,
        runId: 0
    }, "### Trusted auto-merge evaluation\n\nWaiting for validation.");

    assert.match(body, new RegExp(AUTO_MERGE_SUMMARY_COMMENT_MARKER.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(parseAutoMergeState(body)?.reason, "pending");
    assert.equal(findBotAutoMergeSummaryComment([
        { id: 7, body, user: { login: "github-actions[bot]" } },
        { id: 8, body, user: { login: "someone-else" } }
    ])?.id, 7);
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

void test("validation and finalizer run titles have strict machine-readable identities", () => {
    assert.deepEqual(parseAutoMergeValidationRunTitle(`Auto-merge PR #42 @ ${HEAD_SHA}`), {
        pr: 42,
        head: HEAD_SHA
    });
    assert.equal(parseAutoMergeValidationRunTitle(`prefix Auto-merge PR #42 @ ${HEAD_SHA}`), null);
    assert.equal(parseAutoMergeFinalizerRunTitle(`${AUTO_MERGE_FINALIZER_RUN_PREFIX}123456`), 123456);
    assert.equal(parseAutoMergeFinalizerRunTitle("Finalize auto-merge"), null);
});

void test("completed validation finalization is idempotent and monotonic", () => {
    const pending = normalizeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: false,
        trusted: false,
        reason: "pending",
        retry: 0,
        runId: 0
    });
    const finalized = normalizeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: BASE_SHA,
        green: true,
        trusted: true,
        reason: "clean",
        retry: 0,
        runId: 200
    });

    assert.equal(validationRunNeedsFinalization(null, 100, HEAD_SHA), true);
    assert.equal(validationRunNeedsFinalization(pending, 100, HEAD_SHA), true);
    assert.equal(validationRunNeedsFinalization(finalized, 200, HEAD_SHA), false);
    assert.equal(validationRunNeedsFinalization(finalized, 199, HEAD_SHA), false);
    assert.equal(validationRunNeedsFinalization(finalized, 201, HEAD_SHA), true);
    assert.equal(validationRunNeedsFinalization(finalized, 201, "c".repeat(40)), true);
    assert.equal(validationRunNeedsFinalization(finalized, 0, HEAD_SHA), false);
});

void test("control-plane workflow contract prevents orphan workers and implicit finalizer chaining", () => {
    const reconcile = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/automerge-reconcile.yml"), "utf8");
    const finalizer = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/automerge-finalize.yml"), "utf8");
    assertAutoMergeControlPlaneContract(reconcile, finalizer);
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