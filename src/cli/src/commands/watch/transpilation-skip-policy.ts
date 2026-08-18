/**
 * Pure policy evaluator for the watch command's transpilation-skip heuristic.
 *
 * The watch command receives filesystem change events that are not always a
 * signal of meaningful source modification: editors perform no-op saves, build
 * tools touch files to bump mtimes, and the same change event can be re-emitted
 * after restarts. To avoid paying the full transpile cost for those events the
 * watcher layers two guards:
 *
 *   1. A cheap mtime comparison — when the new mtime is not strictly newer
 *      than the cached one, the event is treated as a duplicate and skipped.
 *   2. A content-hash comparison — when mtime advanced but the bytes are
 *      byte-for-byte identical (e.g. a redundant editor save), the event is
 *      treated as no-op and skipped.
 *
 * These guards were previously inlined in `handleFileChange` (and partially
 * duplicated in `handleResourceFileChange`), which made them difficult to
 * exercise in isolation and easy to drift apart on future edits. This module
 * lifts the decision into a single, named policy that both callers can depend
 * on, leaving the mechanism (cache writes, transpilation, broadcast) in the
 * call sites.
 */

import { createHash } from "node:crypto";

/**
 * Reasons a file-change event can be treated as a no-op by the policy.
 *
 * - `mtime-unchanged` — the new modification time is not strictly newer than
 *   the cached one. Typically signals a duplicate event for an unchanged file.
 * - `content-unchanged` — the mtime advanced but the content hash matches the
 *   cached value. Typically signals a no-op save or `touch`-style update.
 */
export type TranspilationSkipReason = "mtime-unchanged" | "content-unchanged";

/**
 * Inputs to the transpilation-skip policy.
 */
export interface TranspilationSkipPolicyInput {
    /**
     * Modification time of the file for the current change event, in
     * milliseconds since the epoch.
     */
    currentMtimeMs: number;

    /**
     * Modification time previously recorded for the file, or `undefined` when
     * the file has not been observed yet (e.g. first change event after
     * startup or after a cleanup pass).
     */
    previousMtimeMs: number | undefined;

    /**
     * Current source content read for the change event. The policy hashes
     * this value when a previous hash is available so it can decide whether
     * the bytes actually changed.
     */
    currentContent: string;

    /**
     * Previously cached content hash for the file, or `undefined` when the
     * file has not been hashed yet. The policy returns `process` with a fresh
     * hash so the mechanism can seed its cache when this is missing.
     */
    previousContentHash: string | undefined;
}

/**
 * Decision returned by the policy evaluator.
 *
 * - `skip` — the mechanism must short-circuit; no transpilation, no cache
 *   writes. The reason surfaces why the event was treated as a no-op.
 * - `process` — the mechanism must continue with the normal pipeline and
 *   store the returned `contentHash` in its cache before invoking the
 *   transpiler.
 */
export type TranspilationSkipPolicyDecision =
    { action: "skip"; reason: TranspilationSkipReason } | { action: "process"; contentHash: string };

/**
 * Decide whether a watch file-change event represents meaningful new work.
 *
 * The evaluator is intentionally pure: it does not read or write the watch
 * cache, and it does not invoke the transpiler. Callers feed it the previous
 * cache state and the current observation, then apply the decision.
 *
 * Order of evaluation mirrors the original inline guard so behaviour is
 * preserved exactly:
 *
 *   1. mtime check — when the cached mtime exists and is not strictly older
 *      than the new one, return `skip` with `mtime-unchanged`. This is the
 *      cheapest signal and short-circuits before any hashing.
 *   2. content-hash check — when a previous hash is cached, hash the current
 *      content and compare. A match returns `skip` with `content-unchanged`;
 *      a mismatch returns `process` with the freshly computed hash.
 *   3. first observation — when no previous hash is cached, return `process`
 *      with the freshly computed hash so the mechanism can seed the cache
 *      for the next event.
 *
 * @param input - Current and previously observed file state.
 * @returns Side-effect-free decision the mechanism must apply.
 */
export function evaluateTranspilationSkipPolicy(input: TranspilationSkipPolicyInput): TranspilationSkipPolicyDecision {
    if (input.previousMtimeMs !== undefined && input.currentMtimeMs <= input.previousMtimeMs) {
        return { action: "skip", reason: "mtime-unchanged" };
    }

    if (input.previousContentHash !== undefined) {
        const currentContentHash = hashSourceContent(input.currentContent);
        if (currentContentHash === input.previousContentHash) {
            return { action: "skip", reason: "content-unchanged" };
        }
        return { action: "process", contentHash: currentContentHash };
    }

    return { action: "process", contentHash: hashSourceContent(input.currentContent) };
}

/**
 * Compute the deterministic digest used by the skip policy.
 *
 * Centralised here so the algorithm (currently MD5 — fast, non-cryptographic,
 * sufficient for change detection) lives next to the policy that depends on
 * it. Tests that want to assert the exact bytes a caller stores in its cache
 * can call this directly without standing up a watcher.
 */
function hashSourceContent(content: string): string {
    return createHash("md5").update(content, "utf8").digest("hex");
}
