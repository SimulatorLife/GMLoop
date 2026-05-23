/**
 * Policy abstraction for the lookup cache eviction strategy used by ScopeTracker.
 *
 * This module extracts the policy decision ("how many entries should be evicted
 * when the cache exceeds its configured maximum") from the mechanism code in
 * scope-tracker.ts. Separating the two allows the eviction ruleset to be:
 *
 * - Unit-tested in isolation without constructing full ScopeTracker instances
 * - Reused or swapped without modifying the cache implementation
 * - Documented and reasoned about independently from the side effects
 *
 * The default policy uses a simple LRU approach: when the cache exceeds the
 * configured maximum, the oldest entry (earliest insertion order) is removed.
 * This is a first-in, first-out eviction strategy based on insertion order.
 */

/**
 * Inputs required to evaluate the lookup cache eviction policy.
 */
export interface LookupCacheEvictionPolicyInput {
    /** Current number of entries in the cache. */
    currentCacheSize: number;
    /** Configured maximum number of entries. */
    maxEntries: number;
}

/**
 * Result of evaluating the lookup cache eviction policy.
 * Describes what entries should be removed to bring the cache back within bounds.
 */
export interface LookupCacheEvictionDecision {
    /** Number of entries to remove from the cache. */
    entriesToEvict: number;
}

/**
 * Evaluates the lookup cache eviction policy based on current state.
 *
 * This function is pure: it computes an eviction decision from the input
 * parameters without performing any side effects. Callers are responsible
 * for applying the decision to the actual cache.
 *
 * @param input - Current cache size and configured maximum entries
 * @returns Decision describing how many entries to evict
 */
export function evaluateLookupCacheEvictionPolicy(input: LookupCacheEvictionPolicyInput): LookupCacheEvictionDecision {
    const { currentCacheSize, maxEntries } = input;

    if (currentCacheSize <= maxEntries || maxEntries <= 0) {
        return { entriesToEvict: 0 };
    }

    const overflow = currentCacheSize - maxEntries;
    return { entriesToEvict: overflow };
}

/**
 * Resolves the configured max entries into a concrete numeric value.
 * Invalid, non-finite, or negative inputs resolve to the provided default.
 *
 * @param configuredMaxEntries - The maxEntries value from the caller
 * @param defaultMaxEntries - Fallback when the configured value is invalid
 * @returns The resolved maximum entries count, always a positive integer >= 1
 */
export function resolveLookupCacheMaxEntries(configuredMaxEntries: unknown, defaultMaxEntries: number): number {
    if (typeof configuredMaxEntries === "number" && Number.isFinite(configuredMaxEntries)) {
        return Math.max(1, Math.floor(configuredMaxEntries));
    }
    return Math.max(1, Math.floor(defaultMaxEntries));
}

/**
 * Default maximum number of entries for the lookup cache.
 * This constant represents the hard-coded policy baseline.
 */
export const DEFAULT_LOOKUP_CACHE_MAX_ENTRIES = 2048;
