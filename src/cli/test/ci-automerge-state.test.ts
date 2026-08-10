import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";

import {
    assertAutoMergeControlPlaneContract,
    AUTO_MERGE_SUMMARY_COMMENT_MARKER,
    findBotAutoMergeSummaryComment,
    findLatestBotAutoMergeState,
    normalizeAutoMergeState,
    parseAutoMergeFinalizerRunTitle,
    parseAutoMergeState,
    parseAutoMergeValidationRunTitle,
    renderAutoMergeStateComment,
    serializeAutoMergeState
} from "../src/commands/ci-automerge-state.js";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const REPO_ROOT = process.cwd();

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

    assert.deepEqual(
        parseAutoMergeState(marker),
        normalizeAutoMergeState({
            pr: 42,
            head: HEAD_SHA,
            base: BASE_SHA,
            green: true,
            trusted: true,
            reason: "clean",
            retry: 0,
            runId: 123,
            updatedAt: parseAutoMergeState(marker)?.updatedAt
        })
    );
});

void test("unknown base is represented explicitly rather than with a placeholder SHA", () => {
    const state = normalizeAutoMergeState({
        pr: 42,
        head: HEAD_SHA,
        base: "",
        green: false,
        trusted: false,
        reason: "infrastructure",
        retry: 1,
        runId: 123
    });
    assert.equal(state.base, "");
});

void test("canonical summary rendering and lookup share one durable marker", () => {
    const body = renderAutoMergeStateComment(
        {
            pr: 42,
            head: HEAD_SHA,
            base: BASE_SHA,
            green: false,
            trusted: false,
            reason: "pending",
            retry: 0,
            runId: 0
        },
        "### Trusted auto-merge evaluation\n\nWaiting for validation."
    );

    assert.match(body, new RegExp(AUTO_MERGE_SUMMARY_COMMENT_MARKER.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`), "u"));
    assert.equal(parseAutoMergeState(body)?.reason, "pending");
    assert.equal(
        findBotAutoMergeSummaryComment([
            { id: 7, body, user: { login: "github-actions[bot]" } },
            { id: 8, body, user: { login: "someone-else" } }
        ])?.id,
        7
    );
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
    assert.equal(parseAutoMergeFinalizerRunTitle("Finalize auto-merge validation run 123456"), 123_456);
    assert.equal(parseAutoMergeFinalizerRunTitle("Finalize auto-merge"), null);
});

void test("control-plane workflow contract checks exact privileged jobs, worker base pinning, and queue ownership", () => {
    const reconcile = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/automerge-reconcile.yml"), "utf8");
    const finalizer = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/automerge-finalize.yml"), "utf8");
    const reconcileAction = fs.readFileSync(
        path.join(REPO_ROOT, ".github/actions/reconcile-automerge/action.yml"),
        "utf8"
    );
    const worker = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/automerge-prs.yml"), "utf8");
    assertAutoMergeControlPlaneContract(reconcile, finalizer, reconcileAction, worker);
});

void test("malformed or unsupported auto-merge state is rejected", () => {
    assert.equal(parseAutoMergeState("<!-- automerge-state nope -->"), null);
    assert.throws(() =>
        normalizeAutoMergeState({
            pr: 42,
            head: "bad",
            base: BASE_SHA,
            green: false,
            trusted: true,
            reason: "infrastructure",
            retry: 0,
            runId: 1
        })
    );
});
