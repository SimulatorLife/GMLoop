import assert from "node:assert/strict";
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

type AutoMergeSummaryRow = Readonly<{
    check: string;
    result: string;
    details: ReadonlyArray<string>;
}>;

function isSha(value: string): boolean {
    return /^[0-9a-f]{40}$/u.test(value);
}

function escapeMarkdownTableCell(value: string): string {
    return value.replaceAll("|", String.raw`\|`).replaceAll("\n", " ");
}

function formatAutoMergeSummaryTable(summary: string): string {
    const lines = summary.split(/\r?\n/u).map((line) => line.trim());
    const heading = lines[0] === "### Trusted auto-merge evaluation" ? (lines.shift() ?? "") : "";
    while (lines[0] === "") lines.shift();
    const lead = lines.shift() ?? "";
    while (lines[0] === "") lines.shift();

    const rows: Array<AutoMergeSummaryRow> = [];
    const notes: Array<string> = [];
    let active: { check: string; result: string; details: Array<string> } | null = null;
    const flushActive = (): void => {
        if (!active) return;
        rows.push(
            Object.freeze({ check: active.check, result: active.result, details: Object.freeze(active.details) })
        );
        active = null;
    };

    for (const line of lines) {
        if (!line) continue;
        const section = line.match(/^\*\*(.+)\*\*$/u);
        if (section?.[1]) {
            flushActive();
            active = { check: section[1], result: "❌", details: [] };
            continue;
        }
        if (line.startsWith("- ")) {
            const detail = line.slice(2).trim();
            if (active) {
                active.details.push(detail);
                continue;
            }
            const separator = detail.indexOf(":");
            const check = separator === -1 ? detail : detail.slice(0, separator).trim();
            const value = separator === -1 ? "" : detail.slice(separator + 1).trim();
            const result = detail.includes("(informational;") ? "ℹ️" : lead.startsWith("✅") ? "✅" : "❌";
            rows.push(Object.freeze({ check, result, details: Object.freeze(value ? [value] : []) }));
            continue;
        }
        flushActive();
        notes.push(line);
    }
    flushActive();

    if (rows.length === 0) return summary.trim();
    const table = [
        "| Check | Result | Details |",
        "| --- | :---: | --- |",
        ...rows.map((row) => {
            const details = row.details.map(escapeMarkdownTableCell).join("<br>");
            return `| ${escapeMarkdownTableCell(row.check)} | ${row.result} | ${details} |`;
        })
    ];
    const output = [heading, "", lead, "", ...table];
    if (notes.length > 0) output.push("", ...notes);
    return output.join("\n").trim();
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
    const normalizedSummary = formatAutoMergeSummaryTable(String(summary || "").trim());
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

    const summaryComment = renderAutoMergeStateComment(
        {
            pr: 42,
            head: "a".repeat(40),
            base: "b".repeat(40),
            green: true,
            trusted: true,
            reason: "clean",
            retry: 0,
            runId: 123
        },
        [
            "### Trusted auto-merge evaluation",
            "",
            "✅ No new regressions were introduced.",
            "",
            "- Lint findings: 12 baseline → 12 merged; **0 new/upgraded**.",
            "- Test cases: 100 baseline → 100 merged; **net reduction 0/3 allowed**.",
            "- Canonical test files removed: **0** (informational; case-count budget is authoritative).",
            "- Newly failing / newly skipped test cases: **0 / 0**."
        ].join("\n")
    );
    assert.match(summaryComment, /\| Check \| Result \| Details \|/u);
    assert.match(summaryComment, /\| Lint findings \| ✅ \|/u);
    assert.match(summaryComment, /\| Canonical test files removed \| ℹ️ \|/u);

    const regressionComment = renderAutoMergeStateComment(
        {
            pr: 42,
            head: "a".repeat(40),
            base: "b".repeat(40),
            green: false,
            trusted: true,
            reason: "quality-regression",
            retry: 0,
            runId: 123
        },
        [
            "### Trusted auto-merge evaluation",
            "",
            "❌ The exact synthetic merge weakens the trusted quality baseline.",
            "",
            "**Net test-case reduction exceeds policy (37 removed; maximum 3)**",
            "- Test cases: 7652 baseline → 7615 merged.",
            "- src/runtime-wrapper/dist/test/index.test.js :: applyPatch handles closure patches"
        ].join("\n")
    );
    assert.match(regressionComment, /\| Net test-case reduction exceeds policy \(37 removed; maximum 3\) \| ❌ \|/u);
    assert.match(regressionComment, /7652 baseline → 7615 merged\.<br>src\/runtime-wrapper/u);

    process.stdout.write("ci-automerge state self-test passed\n");
}

if (
    process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) &&
    process.argv[2] === "self-test"
)
    selfTest();
