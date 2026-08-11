import assert from "node:assert/strict";
import test from "node:test";

import {
    isKnownBaseTransition,
    isPendingStateExpired,
    isTrustedValidationProducer,
    planAutoMergePr,
    selectNewestValidationRuns,
    summarizeFinalizerRuns,
    type AutoMergeWorkflowRun
} from "../src/commands/ci-automerge-plan.js";
import { normalizeAutoMergeState } from "../src/commands/ci-automerge-state.js";

const HEAD = "a".repeat(40);
const BASE = "b".repeat(40);
const OLD_BASE = "c".repeat(40);
const NOW = Date.parse("2026-08-10T02:00:00Z");

function validationRun(
    id: number,
    status: string,
    createdAt: string,
    conclusion: string | null = null,
    base = BASE
): AutoMergeWorkflowRun {
    return {
        id,
        run_attempt: 1,
        validationPr: 42,
        validationHead: HEAD,
        status,
        conclusion,
        created_at: createdAt,
        path: ".github/workflows/automerge-prs.yml",
        event: "workflow_dispatch",
        head_branch: "main",
        head_sha: base
    };
}

void test("newest active generation suppresses an older completed validation", () => {
    const older = validationRun(100, "completed", "2026-08-10T01:00:00Z", "success");
    const newer = validationRun(101, "in_progress", "2026-08-10T01:01:00Z");
    const latest = selectNewestValidationRuns([older, newer]).get(`42:${HEAD}`) ?? null;
    assert.equal(latest?.id, 101);
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: null,
        newestValidation: latest,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "wait", retry: 0, reason: "validation-active" });
});

void test("latest completed generation is finalized before any new validation", () => {
    const latest = validationRun(101, "completed", "2026-08-10T01:01:00Z", "success");
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: null,
        newestValidation: latest,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "finalize", retry: 0, reason: "validation-completed" });
});

void test("exact terminal handoff finalizes immediately instead of waiting on pending timeout", () => {
    const latest = validationRun(101, "completed", "2026-08-10T01:59:00Z", "success");
    const pending = normalizeAutoMergeState({
        pr: 42,
        head: HEAD,
        base: BASE,
        green: false,
        trusted: false,
        reason: "pending",
        retry: 1,
        validationRunId: 101,
        handoffRetry: 0,
        runId: 0,
        updatedAt: "2026-08-10T01:59:59Z"
    });
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: pending,
        newestValidation: latest,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "finalize", retry: 0, reason: "validation-completed" });
});

void test("completed exact-run recovery finalizes without re-running validation", () => {
    const latest = validationRun(101, "completed", "2026-08-10T01:00:00Z", "success");
    const pending = normalizeAutoMergeState({
        pr: 42,
        head: HEAD,
        base: BASE,
        green: false,
        trusted: false,
        reason: "pending",
        retry: 1,
        validationRunId: 101,
        handoffRetry: 1,
        runId: 0,
        updatedAt: "2026-08-10T01:30:00Z"
    });
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: pending,
        newestValidation: latest,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "finalize", retry: 1, reason: "validation-completed" });
});

void test("completed evidence from an older main generation is revalidated without wasting a finalizer slot", () => {
    const stale = validationRun(101, "completed", "2026-08-10T01:00:00Z", "success", OLD_BASE);
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: normalizeAutoMergeState({
            pr: 42,
            head: HEAD,
            base: OLD_BASE,
            green: false,
            trusted: false,
            reason: "pending",
            retry: 0,
            validationRunId: 101,
            runId: 0
        }),
        newestValidation: stale,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "validate", retry: 0, reason: "stale-completed-validation" });
});

void test("only failed finalizer executions consume the finalizer execution retry budget", () => {
    const runs: ReadonlyArray<AutoMergeWorkflowRun> = [
        { id: 1, finalizerValidationRunId: 101, status: "completed", conclusion: "success" },
        { id: 2, finalizerValidationRunId: 101, status: "completed", conclusion: "failure" },
        { id: 3, finalizerValidationRunId: 101, status: "in_progress", conclusion: null }
    ];
    assert.deepEqual(summarizeFinalizerRuns(runs, 101), { active: true, failedAttempts: 1 });
});

void test("validation and finalizer-dispatch retry budgets remain independent", () => {
    const latest = validationRun(101, "completed", "2026-08-10T01:00:00Z", "success");
    const failedHandoff = normalizeAutoMergeState({
        pr: 42,
        head: HEAD,
        base: BASE,
        green: false,
        trusted: false,
        reason: "infrastructure",
        retry: 1,
        validationRunId: 101,
        handoffRetry: 1,
        runId: 0
    });
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: failedHandoff,
        newestValidation: latest,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "finalize", retry: 1, reason: "validation-completed" });
});

void test("known base changes reset retries but unknown or placeholder bases do not", () => {
    assert.equal(isKnownBaseTransition(OLD_BASE, BASE), true);
    assert.equal(isKnownBaseTransition("", BASE), false);
    assert.equal(isKnownBaseTransition("0".repeat(40), BASE), false);
});

void test("orphaned pending state becomes retryable after its bounded timeout", () => {
    const pending = normalizeAutoMergeState({
        pr: 42,
        head: HEAD,
        base: BASE,
        green: false,
        trusted: false,
        reason: "pending",
        retry: 0,
        runId: 0,
        updatedAt: "2026-08-10T01:30:00Z"
    });
    assert.equal(isPendingStateExpired(pending, NOW, 900000), true);
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: pending,
        newestValidation: null,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "validate", retry: 1, reason: "orphaned-pending-retry" });
});

void test("unknown-base infrastructure failures remain bounded instead of resetting forever", () => {
    const failed = normalizeAutoMergeState({
        pr: 42,
        head: HEAD,
        base: "",
        green: false,
        trusted: false,
        reason: "infrastructure",
        retry: 1,
        runId: 88
    });
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: failed,
        newestValidation: null,
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "wait", retry: 1, reason: "infrastructure" });
});

void test("current trusted green state is the only state that reaches merge planning", () => {
    const green = normalizeAutoMergeState({
        pr: 42,
        head: HEAD,
        base: BASE,
        green: true,
        trusted: true,
        reason: "clean",
        retry: 0,
        validationRunId: 101,
        runId: 101
    });
    assert.deepEqual(planAutoMergePr({
        head: HEAD,
        liveBase: BASE,
        state: green,
        newestValidation: validationRun(101, "completed", "2026-08-10T01:01:00Z", "success"),
        finalizer: { active: false, failedAttempts: 0 },
        maxInfrastructureRetries: 1,
        pendingTimeoutMs: 900000,
        nowMs: NOW
    }), { kind: "merge", retry: 0, reason: "trusted-green" });
});

void test("trusted producer verification rejects alternate refs and rerun attempts", () => {
    const good = validationRun(101, "completed", "2026-08-10T01:01:00Z", "success");
    assert.equal(isTrustedValidationProducer(good, BASE), true);
    assert.equal(isTrustedValidationProducer({ ...good, head_branch: "feature" }, BASE), false);
    assert.equal(isTrustedValidationProducer({ ...good, head_sha: OLD_BASE }, BASE), false);
    assert.equal(isTrustedValidationProducer({ ...good, run_attempt: 2 }, BASE), false);
});
