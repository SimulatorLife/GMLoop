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
import { availableParallelism } from "node:os";

import { Core } from "@gmloop/core";

import {
    getRuntimePathSegments,
    resolveScriptFileNameFromSegments
} from "../../modules/transpilation/runtime-identifiers.js";

const { clamp, getLineBreakCount, normalizeExtensionSuffix, toNormalizedInteger, uniqueArray } = Core;

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
 * Creates a matcher for the command-owned extension set. Inputs are expected
 * to be narrow internal constants, not user-provided glob patterns; watch mode
 * deliberately keeps extension policy fixed to GameMaker-owned file types.
 */
export function createExtensionMatcher(extensions: ReadonlyArray<string>): ExtensionMatcher {
    const normalized = uniqueArray(
        extensions.map((extension) => normalizeExtensionSuffix(extension)),
        {
            freeze: false
        }
    ) as Array<string>;
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
    const detectedParallelism = Math.max(1, availableParallelism());
    const normalizedMaximum = toNormalizedInteger(configuredMaximum) ?? detectedParallelism;

    return clamp(normalizedMaximum, 1, detectedParallelism);
}

// ---------------------------------------------------------------------------
// File read retry
// ---------------------------------------------------------------------------

/**
 * Result of scheduling a file-read retry delay.
 */
export interface ScheduledRetry {
    /** Unique timer identifier, or `undefined` when the signal is already aborted. */
    readonly timerId: ReturnType<typeof setTimeout> | undefined;
    /** Promise that resolves to `true` when the delay elapses, or `false` when aborted. */
    readonly completion: Promise<boolean>;
}

/**
 * Schedules a delay before retrying a transient empty-file read, with abort support.
 *
 * Exposes the timer identifier so callers can track or assert against it directly.
 * When the abort signal is already aborted, returns immediately without creating a timer.
 *
 * @param durationMs - Delay duration in milliseconds.
 * @param abortSignal - Optional signal used to cancel the pending retry timer.
 * @returns `ScheduledRetry` containing the timer ID and completion promise.
 */
export function scheduleFileReadRetry(durationMs: number, abortSignal?: AbortSignal): ScheduledRetry {
    if (abortSignal?.aborted) {
        return { timerId: undefined, completion: Promise.resolve(false) };
    }

    let timerId: ReturnType<typeof setTimeout> | undefined;
    let settled = false;

    const completion = new Promise<boolean>((resolve) => {
        const handleAbort = () => {
            if (settled) return;
            settled = true;
            if (timerId !== undefined) clearTimeout(timerId);
            abortSignal?.removeEventListener("abort", handleAbort);
            resolve(false);
        };

        timerId = setTimeout(() => {
            if (settled) return;
            settled = true;
            abortSignal?.removeEventListener("abort", handleAbort);
            resolve(true);
        }, durationMs);

        abortSignal?.addEventListener("abort", handleAbort, { once: true });
    });

    return { timerId, completion };
}

/**
 * Waits before retrying a transient empty-file read and supports abort-driven teardown.
 *
 * @param durationMs - Delay duration in milliseconds.
 * @param abortSignal - Optional signal used to cancel the pending retry timer.
 * @returns Promise that resolves to true when delay elapsed, or false when aborted.
 * @deprecated Use {@link scheduleFileReadRetry} for new code; this function is retained
 *            for backwards-compatible callers that only need the completion promise.
 */
export function delayFileReadRetry(durationMs: number, abortSignal?: AbortSignal): Promise<boolean> {
    return scheduleFileReadRetry(durationMs, abortSignal).completion;
}

/**
 * Filesystem watch events can fire while an editor is still writing.
 * Retry briefly when the file is observed as empty so we do not treat
 * transient truncation windows as a permanent transpilation failure.
 *
 * @param filePath - Path to the file to read.
 * @param retryCount - Maximum number of read attempts, including the initial read; values below one still perform the initial read without retrying.
 * @param retryDelayMs - Delay in milliseconds between attempts after an empty read.
 * @param abortSignal - Optional signal used to stop before the first read or during a retry delay.
 * @returns The file content, or `null` when the signal was already aborted before the first read. An abort during a retry delay returns the current content without another read.
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

    // Use the built-in non-mutating sorter so p95 ordering never mutates the
    // collected latency window.
    const sorted = latencies.toSorted((a, b) => a - b);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    const p95 = sorted.at(p95Index) ?? sorted.at(-1) ?? 0;

    return { avg, p95 };
}

// ---------------------------------------------------------------------------
// Initial file cache
// ---------------------------------------------------------------------------

/**
 * Pre-read source text and metadata cached during the initial startup scan.
 */
export interface InitialFileData {
    content: string;
    /** File modification time captured with the cached source. */
    mtimeMs: number;
    /** Symbol definitions extracted during the startup scan. */
    symbols: Array<string>;
    /** Symbol references extracted during the startup scan. */
    references: Array<string>;
}

/**
 * Returns and removes cached startup metadata for a file.
 *
 * The watch command caches source text and extracted metadata between its two
 * startup passes. Deleting each entry immediately after the initial scan reduces
 * the peak memory footprint of large projects. Parsed ASTs are deliberately not
 * retained here because the complete project AST set can exceed available memory
 * before the watcher has started serving runtime patches.
 *
 * @param fileDataCache - Startup cache keyed by absolute file path.
 * @param filePath - File whose cached source text and metadata should be consumed.
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
 * Once the initial scan completes (or fails), retaining leftover source and metadata
 * entries only increases steady-state memory usage.
 *
 * @param fileDataCache - Startup cache to clear.
 */
export function clearInitialFileDataCache(fileDataCache: Map<string, InitialFileData> | undefined): void {
    if (!fileDataCache) {
        return;
    }

    fileDataCache.clear();
}

// ---------------------------------------------------------------------------
// Script-name registration
// ---------------------------------------------------------------------------

/**
 * Resolve the runtime script name (`gml_Script_<basename>`) for a `.gml` file
 * located under a `scripts/` directory. Returns `null` when the path is not
 * inside a `scripts/` directory or lacks a recognizable file stem.
 */
export function getScriptNameFromPath(filePath: string): string | null {
    const segments = getRuntimePathSegments(filePath);
    return resolveScriptFileNameFromSegments(segments);
}

/**
 * Insert the script name derived from {@link getScriptNameFromPath} into the
 * provided `Set`. No-op when the path does not resolve to a script name.
 */
export function ensureScriptNameRegistered(filePath: string, scriptNames: Set<string>): void {
    const scriptName = getScriptNameFromPath(filePath);
    if (scriptName) {
        scriptNames.add(scriptName);
    }
}

/**
 * Remove the script name derived from {@link getScriptNameFromPath} from the
 * provided `Set`. No-op when the path does not resolve to a script name.
 */
export function unregisterScriptName(filePath: string, scriptNames: Set<string>): void {
    const scriptName = getScriptNameFromPath(filePath);
    if (scriptName) {
        scriptNames.delete(scriptName);
    }
}
