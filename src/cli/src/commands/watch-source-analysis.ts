/**
 * Stateless source-file analysis utilities for the watch command.
 *
 * These pure functions handle file extension matching, content hashing, line
 * counting, concurrency resolution, retry scheduling, and latency statistics.
 * They carry no mutable state and are safe to call from any context, making
 * them independently testable and reusable across the watch lifecycle without
 * coupling to the command's internal runtime context.
 *
 * Extracted from watch.ts to keep the command orchestration module focused on
 * lifecycle coordination while analysis primitives live in a dedicated module.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Core } from "@gmloop/core";

import { normalizeExtensions } from "../workflow/extension-normalizer.js";

const { getLineBreakCount } = Core;

// ---------------------------------------------------------------------------
// Extension matching
// ---------------------------------------------------------------------------

/**
 * Contract for matching file extensions during the watch scan.
 */
export interface ExtensionMatcher {
    extensions: ReadonlySet<string>;
    matches: (fileName: string) => boolean;
}

/**
 * Creates a matcher for file extensions that normalizes case and ensures each
 * entry begins with a leading dot. The matcher exposes the normalized set for
 * logging while providing a case-insensitive predicate for incoming filenames.
 */
export function createExtensionMatcher(extensions: ReadonlyArray<string>): ExtensionMatcher {
    const normalized = normalizeExtensions(extensions);
    const normalizedSet = new Set(normalized);

    return {
        extensions: normalizedSet,
        matches: (fileName: string) => {
            const extension = resolveLowercaseExtension(fileName);
            return extension === "" ? false : normalizedSet.has(extension);
        }
    };
}

/**
 * Resolves the lowercase extension for a filename/path without allocating via
 * node:path. The behavior intentionally matches path.extname semantics:
 * dotfiles such as ".gml" are treated as extension-less.
 */
function resolveLowercaseExtension(fileName: string): string {
    const lastForwardSlashIndex = fileName.lastIndexOf("/");
    const lastBackwardSlashIndex = fileName.lastIndexOf("\\");
    const lastPathSeparatorIndex = Math.max(lastForwardSlashIndex, lastBackwardSlashIndex);
    const lastDotIndex = fileName.lastIndexOf(".");

    if (lastDotIndex <= lastPathSeparatorIndex + 1) {
        return "";
    }

    return fileName.slice(lastDotIndex).toLowerCase();
}

// ---------------------------------------------------------------------------
// Source content analysis
// ---------------------------------------------------------------------------

/**
 * Counts the number of source lines in a string, honoring CRLF and Unicode line breaks.
 *
 * @param {string} source - Source text to inspect.
 * @returns {number} Number of lines represented by the source string.
 */
export function countSourceLines(source: string): number {
    if (source.length === 0) {
        return 1;
    }

    return getLineBreakCount(source) + 1;
}

/**
 * Computes a compact digest of source text for change-detection purposes.
 *
 * MD5 is intentionally used here because this hash is not security-sensitive:
 * we only need a fast, deterministic fingerprint to skip redundant transpilation
 * when file bytes are unchanged. A 128-bit digest keeps memory overhead low while
 * reducing per-change CPU cost versus SHA-256 in the watch hot path.
 *
 * @param {string} source - Source text to hash.
 * @returns {string} 32-character hex digest.
 */
export function hashSourceContent(source: string): string {
    return createHash("md5").update(source, "utf8").digest("hex");
}

// ---------------------------------------------------------------------------
// Concurrency resolution
// ---------------------------------------------------------------------------

/**
 * Resolves concurrency for unknown watcher event scans.
 *
 * Unknown events require probing tracked files to find changes on platforms
 * that omit filenames. Keep probes bounded to avoid unbounded stat storms.
 *
 * @param {number} configuredMaximum - User-configured max concurrent directory reads.
 * @returns {number} Safe unknown scan concurrency value (minimum 1).
 */
export function resolveUnknownScanConcurrency(configuredMaximum: number): number {
    return Math.max(1, Math.trunc(configuredMaximum));
}

/**
 * Resolves concurrency for dependent script retranspilation.
 *
 * Dependent retranspilation happens on the hot-reload critical path and should
 * remain bounded so large dependency fans do not create unbounded I/O bursts
 * or event-loop pressure. Reuse the watch command's concurrency cap to keep
 * throughput high while controlling latency variance.
 *
 * @param {number} configuredMaximum - User-configured concurrency ceiling.
 * @returns {number} Safe retranspile concurrency value (minimum 1).
 */
export function resolveDependentRetranspileConcurrency(configuredMaximum: number): number {
    return resolveUnknownScanConcurrency(configuredMaximum);
}

// ---------------------------------------------------------------------------
// File read retry
// ---------------------------------------------------------------------------

/**
 * Waits before retrying a transient empty-file read and supports abort-driven teardown.
 *
 * @param durationMs - Delay duration in milliseconds.
 * @param abortSignal - Optional signal used to cancel the pending retry timer.
 * @returns Promise that resolves to true when delay elapsed, or false when aborted.
 */
export function delayFileReadRetry(durationMs: number, abortSignal?: AbortSignal): Promise<boolean> {
    if (abortSignal?.aborted) {
        return Promise.resolve(false);
    }

    return new Promise((resolve) => {
        const handleAbort = () => {
            clearTimeout(timeoutId);
            abortSignal?.removeEventListener("abort", handleAbort);
            resolve(false);
        };

        const timeoutId = setTimeout(() => {
            abortSignal?.removeEventListener("abort", handleAbort);
            resolve(true);
        }, durationMs);

        abortSignal?.addEventListener("abort", handleAbort, { once: true });
    });
}

/**
 * Filesystem watch events can fire while an editor is still writing.
 * Retry briefly when the file is observed as empty so we do not treat
 * transient truncation windows as a permanent transpilation failure.
 */
export async function readSourceFileWithTransientEmptyRetry(
    filePath: string,
    retryCount: number,
    retryDelayMs: number,
    abortSignal?: AbortSignal
): Promise<string | null> {
    const readAttempt = async (attempt: number): Promise<string> => {
        const content = await readFile(filePath, "utf8");
        const isFinalAttempt = attempt >= retryCount - 1;
        if (content.length > 0 || isFinalAttempt) {
            return content;
        }

        const shouldRetry = await delayFileReadRetry(retryDelayMs, abortSignal);
        if (!shouldRetry) {
            return content;
        }

        return readAttempt(attempt + 1);
    };

    if (abortSignal?.aborted) {
        return null;
    }

    return await readAttempt(0);
}

// ---------------------------------------------------------------------------
// Latency statistics
// ---------------------------------------------------------------------------

/**
 * Computes average and 95th-percentile hot-reload latency from a metrics window.
 *
 * Only patches that have a recorded `hotReloadLatencyMs` value (i.e., those
 * triggered by a live file-change event rather than the initial scan) contribute
 * to the result. Returns `undefined` for both values when no latency data is available.
 *
 * @param metrics - The bounded metrics window from the runtime context.
 * @returns Object with `avg` and `p95` in milliseconds, or `undefined` when unavailable.
 */
export function computeHotReloadLatencyStats(
    metrics: ReadonlyArray<{ hotReloadLatencyMs?: number }>
): { avg: number; p95: number } | undefined {
    const latencies: Array<number> = [];

    for (const metric of metrics) {
        if (typeof metric.hotReloadLatencyMs === "number") {
            latencies.push(metric.hotReloadLatencyMs);
        }
    }

    if (latencies.length === 0) {
        return undefined;
    }

    const sum = latencies.reduce((acc, val) => acc + val, 0);
    const avg = sum / latencies.length;

    // Sort a copy for p95 computation to avoid mutating the input array.
    const sorted = latencies.slice().sort((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    const p95 = sorted.at(p95Index) ?? sorted.at(-1) ?? 0;

    return { avg, p95 };
}

// ---------------------------------------------------------------------------
// Initial file cache
// ---------------------------------------------------------------------------

/**
 * Pre-read source text and AST cached during the initial startup scan.
 */
export interface InitialFileData {
    content: string;
    ast: unknown;
}

/**
 * Returns and removes cached startup data for a file.
 *
 * The watch command only needs the pre-read source text and AST once during the
 * initial scan. Deleting the cache entry immediately after retrieval reduces the
 * peak memory footprint of large startup scans without changing the transpilation
 * work performed for each file.
 *
 * @param fileDataCache - Startup cache keyed by absolute file path.
 * @param filePath - File whose cached source text and AST should be consumed.
 * @returns Cached startup data when present.
 */
export function takeInitialFileData(
    fileDataCache: Map<string, InitialFileData> | undefined,
    filePath: string
): InitialFileData | undefined {
    if (!fileDataCache) {
        return undefined;
    }

    const cached = fileDataCache.get(filePath);
    if (cached) {
        fileDataCache.delete(filePath);
    }

    return cached;
}

/**
 * Clears any remaining startup file cache entries after the initial scan finishes.
 *
 * During startup, cached source text and AST objects are reused to avoid duplicate
 * reads/parses. Once the initial scan completes (or fails), retaining leftover entries
 * only increases steady-state memory usage.
 *
 * @param fileDataCache - Startup cache to clear.
 */
export function clearInitialFileDataCache(fileDataCache: Map<string, InitialFileData> | undefined): void {
    if (!fileDataCache) {
        return;
    }

    fileDataCache.clear();
}
