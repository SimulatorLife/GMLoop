/**
 * @gmloop/semantic
 *
 * Policy layer for the identifier sink's read-cache LRU eviction.
 *
 * ## Separation of concerns
 *
 * The `IdentifierSink` mechanism (temp-file spill + in-memory tail + parsed-read
 * cache) lives in `identifier-sink.ts`.  It owns all side effects: file I/O,
 * in-memory `Map` mutations, and spill-file lifecycle.
 *
 * This module holds only the **policy** — pure functions that compute what
 * the cache state *should* be, with no side effects whatsoever.
 *
 * Responsibilities kept here:
 *   - Default threshold constants (flush size, retained entries, cache capacity).
 *   - Normalization of externally-supplied option values (guards against NaN, Infinity,
 *     non-positive values, and non-number inputs).
 *   - Computing which entries to evict from the read-cache LRU.
 *
 * This separation lets callers test every policy decision in isolation (no file I/O
 * required) and lets operators tune the cache behaviour without editing the
 * mechanism that performs the I/O.
 */

import type { LruCacheEntry } from "./identifier-sink.js";

// ---------------------------------------------------------------------------
// Public constant defaults
// ---------------------------------------------------------------------------

/**
 * Default number of records accumulated in a sink tail before the oldest
 * entries are spilled to disk.
 */
export const DEFAULT_FLUSH_THRESHOLD = 128;

/**
 * Default number of records to keep in the in-memory tail after a spill.
 */
export const DEFAULT_RETAINED_ENTRIES_PER_KEY = 32;

/**
 * Default maximum number of entries held in the read-cache before the oldest
 * entry is evicted (LRU discipline).
 */
export const DEFAULT_READ_CACHE_MAX_ENTRIES = 32;

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * Arguments required to evaluate the read-cache eviction policy.
 *
 * The mechanism calls this evaluator in three phases:
 *   1. Delete the promoted entry from the cache (if present).
 *   2. Call this evaluator with `currentCache` in its post-deletion state.
 *   3. Apply eviction decisions, then re-insert the promoted entry.
 *
 * `promotedKeyWasAlreadyPresent` tells the evaluator whether the re-insertion
 * in phase 3 will grow the cache by one, or leave its size unchanged.
 */
export type ReadCacheEvictionPolicyInput = {
    currentCache: Map<string, LruCacheEntry>;
    promotedKey: string;
    promotedKeyWasAlreadyPresent: boolean;
    maxEntries: number;
};

/**
 * Decision returned by the read-cache eviction policy evaluator.
 *
 * `evictKeys` is ordered from oldest to newest (first key = most stale);
 * the mechanism should delete entries in this order until `evictKeys.length === 0`.
 */
export type ReadCacheEvictionPolicyDecision = {
    evictKeys: string[];
};

/**
 * Normalized threshold options for the identifier sink.
 * All values are guaranteed to be finite positive integers.
 */
export type NormalizedSinkThresholds = {
    readonly flushThreshold: number;
    readonly retainedEntriesPerKey: number;
    readonly readCacheMaxEntries: number;
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/**
 * Coerce an unknown option value to a finite positive integer, falling back
 * to `fallback` when the value is absent, non-numeric, non-finite, or <= 0.
 *
 * Zero is considered invalid because every threshold in this policy controls
 * a size or count where zero would be a no-op or a logical error
 * (e.g. a flush threshold of 0 would spill every single record).
 *
 * Values that round down to 0 (e.g. 0.1, 0.9) are also invalid since they
 * cannot represent a meaningful positive capacity.
 */
function normalizePositiveInteger(value: unknown, fallback: number): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return fallback;
    }

    const floored = Math.floor(value);
    if (floored <= 0) {
        return fallback;
    }

    return floored;
}

/**
 * Build a fully-normalized threshold record from the raw constructor options.
 * Invalid or absent values are replaced with their corresponding defaults.
 *
 * This function is pure and deterministic — the same inputs always produce the
 * same output, making it cheap to call in hot paths.
 */
export function normalizeSinkThresholds(
    options?: Readonly<{
        flushThreshold?: unknown;
        retainedEntriesPerKey?: unknown;
        readCacheMaxEntries?: unknown;
    }>
): NormalizedSinkThresholds {
    return {
        flushThreshold: normalizePositiveInteger(options?.flushThreshold, DEFAULT_FLUSH_THRESHOLD),
        retainedEntriesPerKey: normalizePositiveInteger(
            options?.retainedEntriesPerKey,
            DEFAULT_RETAINED_ENTRIES_PER_KEY
        ),
        readCacheMaxEntries: normalizePositiveInteger(options?.readCacheMaxEntries, DEFAULT_READ_CACHE_MAX_ENTRIES)
    };
}

// ---------------------------------------------------------------------------
// Eviction policy evaluator
// ---------------------------------------------------------------------------

/**
 * Compute which read-cache entries to evict after a new entry is promoted.
 *
 * The policy implements a strict LRU discipline:
 *   1. The caller (the mechanism) has already deleted the promoted entry from
 *      the cache to move it to MRU position.  The cache now contains N-1 entries.
 *   2. The mechanism will then re-insert the promoted entry, making the cache N.
 *   3. If N exceeds `maxEntries`, the oldest entries (LRU) are evicted.
 *
 * Step 2 (re-insertion) MUST occur after this evaluator runs, so the policy
 * receives the cache in its *pre*-re-insertion state (N-1 entries) and uses
 * `promotedKeyWasAlreadyPresent` to predict whether the subsequent re-insertion
 * will cause a size overflow.  This prevents evicting the entry that was just
 * promoted.
 *
 * This function is **pure** — it performs no `Map` mutations and requires no
 * I/O.  Callers pass the current cache `Map` as a read-only argument and apply
 * the returned `evictKeys` list to the real cache.
 *
 * @example
 * ```ts
 * const decision = evaluateReadCacheEvictionPolicy({
 *     currentCache: cacheMap,
 *     promotedKey: key,
 *     promotedKeyWasAlreadyPresent: cacheMap.has(key),
 *     maxEntries: 32
 * });
 * for (const k of decision.evictKeys) cacheMap.delete(k);
 * cacheMap.set(key, entry); // re-insert AFTER evaluating
 * ```
 */
export function evaluateReadCacheEvictionPolicy(input: ReadCacheEvictionPolicyInput): ReadCacheEvictionPolicyDecision {
    const { currentCache, promotedKeyWasAlreadyPresent, maxEntries } = input;

    // Determine how many entries will exist after re-insertion.
    // If the key was already in the cache, re-insertion does not change the size
    // (delete + set on the same key).  Otherwise it grows by 1.
    const sizeAfterReinsertion = promotedKeyWasAlreadyPresent ? currentCache.size : currentCache.size + 1;

    // Number of entries to remove so the cache fits within maxEntries after
    // the promoted entry is re-inserted.
    const evictCount = sizeAfterReinsertion - maxEntries;

    if (evictCount <= 0) {
        return { evictKeys: [] };
    }

    // Collect the evictCount oldest keys in insertion order (LRU = first inserted).
    // Map insertion order is preserved by the JavaScript spec, so the first key
    // returned by .keys() is the true LRU entry.
    const evictKeys: string[] = [];
    for (const key of currentCache.keys()) {
        if (evictKeys.length === evictCount) break;
        evictKeys.push(key);
    }

    return { evictKeys };
}
