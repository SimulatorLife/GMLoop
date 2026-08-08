/**
 * Pure eviction policy for the CLI formatting cache.
 *
 * This module decides what should happen when the cache reaches its configured
 * limit. Applying that decision to the mutable cache remains in `cache.ts`, so
 * capacity rules can be tested without invoking cache side effects.
 */

/**
 * State used to evaluate formatting-cache eviction.
 */
export interface FormattingCacheEvictionPolicyInput {
    /** Current number of entries retained by the cache. */
    currentCacheSize: number;
    /** Configured maximum number of retained entries. */
    maxEntries: number;
}

/**
 * Policy decision for the formatting-cache mechanism to apply.
 */
export type FormattingCacheEvictionDecision =
    { action: "retain" } | { action: "clear" } | { action: "evict-oldest"; entriesToEvict: number };

/**
 * Evaluates how the formatting cache should respond to its configured limit.
 *
 * A zero or non-finite limit leaves the cache unbounded. A negative limit
 * requests a full clear, preserving the existing explicit trim behavior.
 * Positive limits evict only the oldest overflow entries.
 *
 * @param input - Current cache size and configured maximum entry count.
 * @returns A side-effect-free decision for the cache mechanism to apply.
 */
export function evaluateFormattingCacheEvictionPolicy({
    currentCacheSize,
    maxEntries
}: FormattingCacheEvictionPolicyInput): FormattingCacheEvictionDecision {
    if (!Number.isFinite(maxEntries) || maxEntries === 0 || currentCacheSize <= maxEntries) {
        return { action: "retain" };
    }

    if (maxEntries < 0) {
        return { action: "clear" };
    }

    return {
        action: "evict-oldest",
        entriesToEvict: Math.ceil(currentCacheSize - maxEntries)
    };
}
