import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const AUTO_MERGE_STATE_MARKER = "automerge-state";
export const AUTO_MERGE_STATE_SCHEMA_VERSION = 1;
export const AUTO_MERGE_SUMMARY_COMMENT_MARKER = "<!-- automerge-pr-test-summary -->";
export const AUTO_MERGE_FINALIZER_RUN_PREFIX = "Finalize auto-merge validation run ";
export const AUTO_MERGE_STATE_REASONS = Object.freeze(
    new Set([
        "pending",
        "clean",
        "recovery",
        "trusted-ci-change",
        "policy-block",
        "build-failure",
        "quality-regression",
        "baseline-unavailable",
        "infrastructure",
        "stale",
        "pending-mergeability",
        "conflict",
        "merge-failed"
    ])
);

/** Durable machine-readable auto-merge decision state persisted on a PR. */
export type AutoMergeState = Readonly<{
    v: number;
    pr: number;
    head: string;
    base: string;
    green: boolean;
    trusted: boolean;
    reason: string;
    retry: number;
    runId: number;
    updatedAt: string;
}>;

export type AutoMergeValidationRunIdentity = Readonly<{
    pr: number;
    head: string;
}>;

type StateInput = Omit<AutoMergeState, "v" | "updatedAt"> & Readonly<{ updatedAt?: string }>;
export type AutoMergeIssueComment = Readonly<{
    id?: number;
    body?: string | null;
    created_at?: string | null;
    updated_at?: string | null;
    user?: Readonly<{ login?: string | null }> | null;
}>;

function isSha(value: string): boolean {
    return /^[0-9a-f]{40}$/u.test(value);
}

/** Normalize and validate the durable machine-readable auto-merge state. */
export function normalizeAutoMergeState(value: StateInput | AutoMergeState): AutoMergeState {
    const state: AutoMergeState = Object.freeze({
        v: AUTO_MERGE_STATE_SCHEMA_VERSION,
        pr: Number(value.pr),
        head: String(value.head || ""),
        base: String(value.base || ""),
        green: value.green === true,
        trusted: value.trusted === true,
        reason: String(value.reason || ""),
        retry: Number(value.retry || 0),
        runId: Number(value.runId || 0),
        updatedAt: String(value.updatedAt || new Date().toISOString())
    });
    if (!Number.isInteger(state.pr) || state.pr <= 0) throw new Error("Invalid PR number in auto-merge state.");
    if (!isSha(state.head) || (state.base !== "" && !isSha(state.base)))
        throw new Error("Invalid head/base SHA in auto-merge state.");
    if (!AUTO_MERGE_STATE_REASONS.has(state.reason)) throw new Error(`Unsupported auto-merge reason: ${state.reason}`);
    if (!Number.isInteger(state.retry) || state.retry < 0 || state.retry > 10)
        throw new Error("Invalid retry count in auto-merge state.");
    if (!Number.isInteger(state.runId) || state.runId < 0)
        throw new Error("Invalid workflow run ID in auto-merge state.");
    return state;
}

/** Serialize validated auto-merge state into the single durable PR-comment marker. */
export function serializeAutoMergeState(value: StateInput | AutoMergeState): string {
    return `<!-- ${AUTO_MERGE_STATE_MARKER} ${JSON.stringify(normalizeAutoMergeState(value))} -->`;
}

/** Render the canonical durable auto-merge summary comment. */
export function renderAutoMergeStateComment(value: StateInput | AutoMergeState, summary: string): string {
    const normalizedSummary = String(summary || "").trim();
    return `${AUTO_MERGE_SUMMARY_COMMENT_MARKER}\n${serializeAutoMergeState(value)}\n${normalizedSummary}`;
}

/** Parse a durable auto-merge state marker from a PR comment body. */
export function parseAutoMergeState(body: string | null | undefined): AutoMergeState | null {
    if (typeof body !== "string") return null;
    const match = body.match(/<!--\s*automerge-state\s+(\{[^\n]*\})\s*-->/u);
    if (!match?.[1]) return null;
    try {
        const raw = JSON.parse(match[1]) as Partial<AutoMergeState>;
        if (raw.v !== AUTO_MERGE_STATE_SCHEMA_VERSION) return null;
        return normalizeAutoMergeState(raw as AutoMergeState);
    } catch {
        return null;
    }
}

/** Return the newest bot-authored comment containing valid auto-merge state. */
export function findLatestBotAutoMergeState(
    comments: ReadonlyArray<AutoMergeIssueComment>,
    login = "github-actions[bot]"
): AutoMergeState | null {
    const candidates = comments
        .filter((comment) => comment.user?.login === login)
        .map((comment) => ({ comment, state: parseAutoMergeState(comment.body) }))
        .filter((entry): entry is { comment: AutoMergeIssueComment; state: AutoMergeState } => entry.state !== null)
        .sort(
            (left, right) =>
                new Date(right.comment.updated_at || right.comment.created_at || 0).getTime() -
                new Date(left.comment.updated_at || left.comment.created_at || 0).getTime()
        );
    return candidates[0]?.state ?? null;
}

/** Find the single bot-owned summary comment used for durable auto-merge state. */
export function findBotAutoMergeSummaryComment(
    comments: ReadonlyArray<AutoMergeIssueComment>,
    login = "github-actions[bot]"
): AutoMergeIssueComment | null {
    return (
        comments.find(
            (comment) => comment.user?.login === login && comment.body?.includes(AUTO_MERGE_SUMMARY_COMMENT_MARKER)
        ) ?? null
    );
}

/** Parse the exact PR/head identity encoded in a validation worker run title. */
export function parseAutoMergeValidationRunTitle(
    title: string | null | undefined
): AutoMergeValidationRunIdentity | null {
    const match = String(title || "").match(/^Auto-merge PR #(\d+) @ ([0-9a-f]{40})$/u);
    if (!match) return null;
    const pr = Number(match[1]);
    if (!Number.isInteger(pr) || pr <= 0) return null;
    return Object.freeze({ pr, head: match[2] });
}

/** Parse the validation run ID encoded in a trusted finalizer run title. */
export function parseAutoMergeFinalizerRunTitle(title: string | null | undefined): number | null {
    const match = String(title || "").match(/^Finalize auto-merge validation run (\d+)$/u);
    if (!match) return null;
    const runId = Number(match[1]);
    return Number.isInteger(runId) && runId > 0 ? runId : null;
}

function extractJobBlock(workflow: string, jobName: string, nextJobName: string | null): string {
    const startMarker = `  ${jobName}:\n`;
    const start = workflow.indexOf(startMarker);
    assert.ok(start !== -1, `workflow must contain jobs.${jobName}`);
    if (!nextJobName) return workflow.slice(start);
    const end = workflow.indexOf(`\n  ${nextJobName}:\n`, start + startMarker.length);
    assert.ok(end > start, `workflow must contain jobs.${nextJobName} after jobs.${jobName}`);
    return workflow.slice(start, end);
}

/** Assert static trusted workflow invariants that actionlint cannot validate semantically. */
export function assertAutoMergeControlPlaneContract(
    reconcile: string,
    finalizer: string,
    reconcileAction: string,
    worker: string
): void {
    const discoverJob = extractJobBlock(reconcile, "discover", "reconcile");
    const analyzeJob = extractJobBlock(finalizer, "analyze", "merge");

    assert.match(
        discoverJob,
        /permissions:\n(?: {6}[^\n]+\n)* {6}pull-requests: write/u,
        "coordinator discover job must have PR-write permission"
    );
    assert.match(
        analyzeJob,
        /permissions:\n(?: {6}[^\n]+\n)* {6}pull-requests: write/u,
        "finalizer analyze job must have PR-write permission"
    );
    assert.match(reconcile, /workflow_id: 'automerge-finalize\.yml'/u);
    assert.match(
        reconcile,
        /expected_base: liveBase/u,
        "coordinator must pin every validation dispatch to the exact admitted main SHA"
    );
    assert.match(reconcile, /has no changed files yet; waiting for its first substantive synchronize event/u);
    assert.match(reconcile, /pendingTimeoutMs/u);
    assert.doesNotMatch(
        reconcile,
        /core\.setFailed\(`Auto-merge control-plane dispatch failure/u,
        "one PR's dispatch failure must not fail another PR's coordinator check"
    );

    const admissionAnchor = reconcile.indexOf("// Both prerequisite state surfaces must be writable before launching");
    const statusAt = reconcile.indexOf("await github.rest.repos.createCommitStatus", admissionAnchor);
    const persistedAt = reconcile.indexOf("await upsertState(pr, state", admissionAnchor);
    const dispatchedAt = reconcile.indexOf("workflow_id: 'automerge-prs.yml'", admissionAnchor);
    assert.ok(
        admissionAnchor !== -1 && statusAt > admissionAnchor && persistedAt > statusAt && dispatchedAt > persistedAt,
        "commit status and durable pending state must both succeed before validation dispatch"
    );

    assert.match(worker, /expected_base:\n/u);
    assert.match(worker, /EXPECTED_BASE: \$\{\{ inputs\.expected_base \}\}/u);
    assert.match(
        worker,
        /context\.sha !== expectedBase/u,
        "validation worker must execute from the exact admitted main commit"
    );
    assert.match(
        worker,
        /baseBranch\.commit\.sha !== expectedBase/u,
        "validation worker must reject a live-main change after admission"
    );
    assert.match(
        worker,
        /currentBase\.commit\.sha !== expectedBase/u,
        "validation worker must reject main movement while resolving the synthetic merge"
    );

    assert.match(finalizer, /workflow_dispatch:/u);
    assert.doesNotMatch(finalizer, /workflows:\s*\["Auto-merge PRs"\]/u);
    assert.match(finalizer, /run-id: \$\{\{ inputs\.validation_run_id \}\}/u);
    assert.match(finalizer, /validationRun\.head_branch !== 'main'/u);
    assert.match(finalizer, /validationRun\.run_attempt \|\| 1\) !== 1/u);
    assert.match(finalizer, /validationRun\.head_sha !== base/u);
    assert.match(finalizer, /parseAutoMergeValidationRunTitle/u);
    assert.match(
        finalizer,
        /base: process\.env\.BASE_SHA \|\| ''/u,
        "unknown validation bases must stay unknown rather than becoming a synthetic SHA"
    );

    assert.doesNotMatch(
        reconcileAction,
        /createWorkflowDispatch/u,
        "only the admission coordinator may dispatch expensive validation"
    );
    assert.doesNotMatch(reconcileAction, /workflow_id:\s*'automerge-prs\.yml'/u);
    assert.match(reconcileAction, /set\('revalidation-needed'\)/u);
}

function selfTest(): void {
    const marker = serializeAutoMergeState({
        pr: 42,
        head: "a".repeat(40),
        base: "b".repeat(40),
        green: false,
        trusted: true,
        reason: "infrastructure",
        retry: 0,
        runId: 123
    });
    assert.equal(parseAutoMergeState(marker)?.pr, 42);
    assert.equal(parseAutoMergeState("<!-- automerge-state nope -->"), null);
    assert.equal(
        findLatestBotAutoMergeState([
            { body: marker, updated_at: "2026-01-01", user: { login: "github-actions[bot]" } }
        ])?.reason,
        "infrastructure"
    );
    assert.deepEqual(parseAutoMergeValidationRunTitle(`Auto-merge PR #42 @ ${"a".repeat(40)}`), {
        pr: 42,
        head: "a".repeat(40)
    });
    assert.equal(parseAutoMergeFinalizerRunTitle(`${AUTO_MERGE_FINALIZER_RUN_PREFIX}123`), 123);

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
    const reconcile = fs.readFileSync(path.join(repoRoot, ".github/workflows/automerge-reconcile.yml"), "utf8");
    const finalizer = fs.readFileSync(path.join(repoRoot, ".github/workflows/automerge-finalize.yml"), "utf8");
    const reconcileAction = fs.readFileSync(
        path.join(repoRoot, ".github/actions/reconcile-automerge/action.yml"),
        "utf8"
    );
    const worker = fs.readFileSync(path.join(repoRoot, ".github/workflows/automerge-prs.yml"), "utf8");
    assertAutoMergeControlPlaneContract(reconcile, finalizer, reconcileAction, worker);
    process.stdout.write("ci-automerge state self-test passed\n");
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
    process.argv[2] === "self-test"
)
    selfTest();
