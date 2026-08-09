import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const AUTO_MERGE_STATE_MARKER = "automerge-state";
export const AUTO_MERGE_STATE_SCHEMA_VERSION = 1;
export const AUTO_MERGE_STATE_REASONS = Object.freeze(new Set([
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
]));

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

type StateInput = Omit<AutoMergeState, "v" | "updatedAt"> & Readonly<{ updatedAt?: string }>;
type IssueComment = Readonly<{
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
    if (!isSha(state.head) || (state.base !== "" && !isSha(state.base))) throw new Error("Invalid head/base SHA in auto-merge state.");
    if (!AUTO_MERGE_STATE_REASONS.has(state.reason)) throw new Error(`Unsupported auto-merge reason: ${state.reason}`);
    if (!Number.isInteger(state.retry) || state.retry < 0 || state.retry > 10) throw new Error("Invalid retry count in auto-merge state.");
    if (!Number.isInteger(state.runId) || state.runId < 0) throw new Error("Invalid workflow run ID in auto-merge state.");
    return state;
}

/** Serialize validated auto-merge state into the single durable PR-comment marker. */
export function serializeAutoMergeState(value: StateInput | AutoMergeState): string {
    return `<!-- ${AUTO_MERGE_STATE_MARKER} ${JSON.stringify(normalizeAutoMergeState(value))} -->`;
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
export function findLatestBotAutoMergeState(comments: ReadonlyArray<IssueComment>, login = "github-actions[bot]"): AutoMergeState | null {
    const candidates = comments
        .filter((comment) => comment.user?.login === login)
        .map((comment) => ({ comment, state: parseAutoMergeState(comment.body) }))
        .filter((entry): entry is { comment: IssueComment; state: AutoMergeState } => entry.state !== null)
        .sort((left, right) => new Date(right.comment.updated_at || right.comment.created_at || 0).getTime()
            - new Date(left.comment.updated_at || left.comment.created_at || 0).getTime());
    return candidates[0]?.state ?? null;
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
    assert.equal(findLatestBotAutoMergeState([{ body: marker, updated_at: "2026-01-01", user: { login: "github-actions[bot]" } }])?.reason, "infrastructure");
    process.stdout.write("ci-automerge state self-test passed\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2] === "self-test") selfTest();
