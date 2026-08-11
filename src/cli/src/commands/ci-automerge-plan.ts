import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;

export type AutoMergeStateSnapshot = Readonly<{
    head: string;
    base: string;
    green: boolean;
    trusted: boolean;
    reason: string;
    retry: number;
    validationRunId: number;
    handoffRetry: number;
    runId: number;
    updatedAt: string;
}>;

/** Minimal API run shape plus coordinator-normalized identities. */
export type AutoMergeWorkflowRun = Readonly<{
    id: number;
    run_attempt?: number;
    status?: string | null;
    conclusion?: string | null;
    created_at?: string | null;
    path?: string | null;
    event?: string | null;
    head_branch?: string | null;
    head_sha?: string | null;
    validationPr?: number | null;
    validationHead?: string | null;
    finalizerValidationRunId?: number | null;
}>;

export type FinalizerRunState = Readonly<{
    active: boolean;
    failedAttempts: number;
}>;

export type AutoMergePlanDecision = Readonly<{
    kind: "validate" | "finalize" | "merge" | "wait" | "blocked";
    /** Operation-specific retry generation: validation for validate, handoff for finalize. */
    retry: number;
    reason: string;
}>;

export type AutoMergePlanInput = Readonly<{
    head: string;
    liveBase: string;
    state: AutoMergeStateSnapshot | null;
    newestValidation: AutoMergeWorkflowRun | null;
    finalizer: FinalizerRunState;
    maxInfrastructureRetries: number;
    pendingTimeoutMs: number;
    nowMs: number;
}>;

function runTimestamp(run: AutoMergeWorkflowRun): number {
    const parsed = Date.parse(String(run.created_at || ""));
    return Number.isFinite(parsed) ? parsed : 0;
}

function compareRunsNewestFirst(left: AutoMergeWorkflowRun, right: AutoMergeWorkflowRun): number {
    const timeDifference = runTimestamp(right) - runTimestamp(left);
    if (timeDifference !== 0) return timeDifference;
    const idDifference = right.id - left.id;
    if (idDifference !== 0) return idDifference;
    return Number(right.run_attempt || 1) - Number(left.run_attempt || 1);
}

/** Return the newest validation workflow generation for every exact normalized PR/head identity. */
export function selectNewestValidationRuns(runs: ReadonlyArray<AutoMergeWorkflowRun>): ReadonlyMap<string, AutoMergeWorkflowRun> {
    const selected = new Map<string, AutoMergeWorkflowRun>();
    for (const run of [...runs].sort(compareRunsNewestFirst)) {
        const pr = Number(run.validationPr || 0);
        const head = String(run.validationHead || "");
        if (!Number.isInteger(pr) || pr <= 0 || !SHA_PATTERN.test(head)) continue;
        const key = `${pr}:${head}`;
        if (!selected.has(key)) selected.set(key, run);
    }
    return selected;
}

/** Summarize actual finalizer executions without counting successful no-op runs as failures. */
export function summarizeFinalizerRuns(runs: ReadonlyArray<AutoMergeWorkflowRun>, validationRunId: number): FinalizerRunState {
    let active = false;
    let failedAttempts = 0;
    for (const run of runs) {
        if (run.finalizerValidationRunId !== validationRunId) continue;
        if (run.status === "queued" || run.status === "in_progress") active = true;
        else if (run.status === "completed" && run.conclusion !== "success") failedAttempts += 1;
    }
    return Object.freeze({ active, failedAttempts });
}

/** Verify that a completed validation worker itself executed from the exact trusted main commit it evaluated. */
export function isTrustedValidationProducer(run: AutoMergeWorkflowRun, expectedBase: string): boolean {
    return SHA_PATTERN.test(expectedBase)
        && run.path === ".github/workflows/automerge-prs.yml"
        && run.event === "workflow_dispatch"
        && run.status === "completed"
        && Number(run.run_attempt || 1) === 1
        && run.head_branch === "main"
        && run.head_sha === expectedBase;
}

/** Only a known, non-placeholder prior base may reset an infrastructure retry generation. */
export function isKnownBaseTransition(previousBase: string, liveBase: string): boolean {
    return SHA_PATTERN.test(previousBase)
        && previousBase !== "0".repeat(40)
        && SHA_PATTERN.test(liveBase)
        && previousBase !== liveBase;
}

/** Treat a pending state as expired after the configured bounded timeout. */
export function isPendingStateExpired(state: AutoMergeStateSnapshot, nowMs: number, pendingTimeoutMs: number): boolean {
    if (state.reason !== "pending" || pendingTimeoutMs <= 0) return false;
    const updatedAt = Date.parse(state.updatedAt);
    return Number.isFinite(updatedAt) && nowMs - updatedAt >= pendingTimeoutMs;
}

/** Plan one PR using only typed state and workflow snapshots; API mutation stays in the coordinator workflow. */
export function planAutoMergePr(input: AutoMergePlanInput): AutoMergePlanDecision {
    const { head, liveBase, state, newestValidation, finalizer, maxInfrastructureRetries, pendingTimeoutMs, nowMs } = input;
    if (!SHA_PATTERN.test(head) || !SHA_PATTERN.test(liveBase)) {
        return Object.freeze({ kind: "blocked", retry: 0, reason: "invalid-ref" });
    }

    if (newestValidation) {
        if (newestValidation.status === "queued" || newestValidation.status === "in_progress") {
            return Object.freeze({ kind: "wait", retry: state?.retry ?? 0, reason: "validation-active" });
        }
        if (newestValidation.status === "completed") {
            const finalized = state?.head === head && state.runId === newestValidation.id;
            if (!finalized) {
                // There is no value finalizing evidence that is already stale. Re-admit the
                // same PR head against current main immediately and save a finalizer slot.
                if (SHA_PATTERN.test(String(newestValidation.head_sha || ""))
                    && newestValidation.head_sha !== liveBase) {
                    return Object.freeze({ kind: "validate", retry: 0, reason: "stale-completed-validation" });
                }

                const exactHandoff = state?.head === head && state.validationRunId === newestValidation.id;
                const handoffRetry = exactHandoff ? state.handoffRetry : 0;
                if (finalizer.active) {
                    return Object.freeze({ kind: "wait", retry: handoffRetry, reason: "finalizer-active" });
                }
                // terminal_handoff wakes the coordinator, not the finalizer. Once the exact
                // worker is completed, coordinator recovery must finalize it immediately;
                // waiting here would recreate the pending-status stall this handoff fixes.
                if (finalizer.failedAttempts > maxInfrastructureRetries || handoffRetry > maxInfrastructureRetries) {
                    return Object.freeze({
                        kind: "blocked",
                        retry: Math.max(finalizer.failedAttempts, handoffRetry),
                        reason: "finalizer-retry-exhausted"
                    });
                }
                return Object.freeze({ kind: "finalize", retry: handoffRetry, reason: "validation-completed" });
            }
        }
    }

    if (state?.head === head && state.green && state.trusted && state.base === liveBase) {
        return Object.freeze({ kind: "merge", retry: state.retry, reason: "trusted-green" });
    }

    if (!state || state.head !== head) return Object.freeze({ kind: "validate", retry: 0, reason: "new-head" });

    if ((state.reason === "infrastructure" || state.reason === "baseline-unavailable")
        && isKnownBaseTransition(state.base, liveBase)) {
        return Object.freeze({ kind: "validate", retry: 0, reason: "new-base-generation" });
    }
    if ((state.reason === "infrastructure" || state.reason === "baseline-unavailable")
        && state.retry < maxInfrastructureRetries) {
        return Object.freeze({ kind: "validate", retry: state.retry + 1, reason: "infrastructure-retry" });
    }
    if (state.reason === "stale" || (state.green && state.base !== liveBase)) {
        return Object.freeze({ kind: "validate", retry: 0, reason: "stale-base" });
    }
    if (state.reason === "pending" && isKnownBaseTransition(state.base, liveBase)) {
        return Object.freeze({ kind: "validate", retry: 0, reason: "pending-old-base" });
    }
    if (state.reason === "pending" && isPendingStateExpired(state, nowMs, pendingTimeoutMs)) {
        if (state.validationRunId > 0) {
            // A durable run ID means validation already existed. If the coordinator cannot
            // resolve it, retrying validation is safer than leaving a permanent pending check.
            if (state.retry < maxInfrastructureRetries) {
                return Object.freeze({ kind: "validate", retry: state.retry + 1, reason: "orphaned-run-retry" });
            }
            return Object.freeze({ kind: "blocked", retry: state.retry, reason: "pending-retry-exhausted" });
        }
        if (state.retry < maxInfrastructureRetries) {
            return Object.freeze({ kind: "validate", retry: state.retry + 1, reason: "orphaned-pending-retry" });
        }
        return Object.freeze({ kind: "blocked", retry: state.retry, reason: "pending-retry-exhausted" });
    }

    return Object.freeze({ kind: "wait", retry: state.retry, reason: state.reason });
}

function selfTest(): void {
    const head = "a".repeat(40);
    const base = "b".repeat(40);
    const active: AutoMergeWorkflowRun = {
        id: 20,
        validationPr: 42,
        validationHead: head,
        status: "in_progress",
        created_at: "2026-08-10T01:01:00Z"
    };
    const older: AutoMergeWorkflowRun = {
        id: 19,
        validationPr: 42,
        validationHead: head,
        status: "completed",
        conclusion: "success",
        created_at: "2026-08-10T01:00:00Z"
    };
    assert.equal(selectNewestValidationRuns([older, active]).get(`42:${head}`)?.id, 20);
    assert.equal(isKnownBaseTransition("", base), false);
    assert.equal(isKnownBaseTransition("0".repeat(40), base), false);
    assert.equal(isKnownBaseTransition("c".repeat(40), base), true);
    assert.equal(isTrustedValidationProducer({
        id: 1,
        run_attempt: 1,
        path: ".github/workflows/automerge-prs.yml",
        event: "workflow_dispatch",
        status: "completed",
        head_branch: "main",
        head_sha: base
    }, base), true);
    process.stdout.write("ci-automerge plan self-test passed\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "self-test") selfTest();
