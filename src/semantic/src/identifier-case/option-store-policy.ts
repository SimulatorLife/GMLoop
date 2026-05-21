/**
 * @gmloop/semantic
 *
 * Policy layer for the identifier-case option store's LRU eviction.
 *
 * ## Separation of concerns
 *
 * The `option-store.ts` mechanism (in-memory `Map` of option-store entries)
 * owns all side effects: `Map` mutations, blocklist filtering, and the
 * `trimOptionStoreMap` eviction loop.
 *
 * This module holds only the **policy** — pure functions that compute what
 * the cache state *should* be, with no side effects whatsoever.
 *
 * Responsibilities kept here:
 *   - Normalization of the per-options-bag max-entries override
 *     (Infinity allowed; NaN / negative / fractional values resolve to 0).
 *   - Eviction decision: how many entries must be removed to stay within
 *     the configured limit (LRU discipline — oldest entry evicted first).
 *
 * This separation lets callers test every policy decision in isolation
 * (no `Map` mutations required) and lets operators tune the cache behaviour
 * without editing the mechanism that performs the mutations.
 */

import { IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_OPTION_NAME } from "./options.js";

// ---------------------------------------------------------------------------
// Public constant defaults (re-exported from defaults for convenience)
// ---------------------------------------------------------------------------

export {
    DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES,
    IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_BASELINE,
    IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_ENV_VAR
} from "./option-store-defaults.js";

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

/**
 * Arguments required to evaluate the option-store eviction policy.
 */
export type OptionStoreEvictionPolicyInput = {
    /** Number of entries currently in the store. */
    currentStoreSize: number;
    /** Maximum entries allowed (may be 0 to disable eviction, Infinity for unbounded). */
    maxEntries: number;
};

/**
 * Decision returned by the option-store eviction policy evaluator.
 */
export type OptionStoreEvictionPolicyDecision = {
    /** Number of entries to remove from the store (0 means no eviction needed). */
    entriesToEvict: number;
};

// ---------------------------------------------------------------------------
// Pure policy functions
// ---------------------------------------------------------------------------

/**
 * Normalizes the per-options-bag max-entries override value into a concrete
 * numeric limit.
 *
 * - `Infinity` is accepted as-is (allows callers to disable eviction).
 * - `NaN`, non-finite numbers, negative numbers, and non-numeric values
 *   resolve to the provided default getter.
 * - Finite positive numbers are floored to an integer.
 *
 * @param options - A consumer-supplied options object that may embed the override.
 * @param getDefault - Function that returns the current default max-entries limit.
 * @returns The resolved max-entries limit (0 for disabled, Infinity for unbounded,
 *          a positive integer otherwise).
 */
export function resolveOptionStoreMaxEntries(options: unknown, getDefault: () => number = () => 128): number {
    const resolvedOptions = getIdentifierCaseOptionsObject(options);
    if (!resolvedOptions) {
        return getDefault();
    }

    const configured: unknown = resolvedOptions[IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_OPTION_NAME];

    if (configured === Infinity) {
        return configured as number;
    }

    if (typeof configured === "number") {
        if (!Number.isFinite(configured)) {
            return getDefault();
        }
        if (configured <= 0) {
            return 0;
        }
        return Math.floor(configured);
    }

    return getDefault();
}

/**
 * Evaluates the option-store eviction policy based on current store state.
 *
 * This function is pure: it computes an eviction decision from the input
 * parameters without performing any side effects. Callers are responsible
 * for applying the decision to the actual store `Map`.
 *
 * The policy uses an LRU approach: when the store exceeds the configured
 * maximum, the oldest entries (earliest insertion order) are removed.
 * The caller must remove `entriesToEvict` entries starting from the
 * oldest (first-inserted) key.
 *
 * @param input - Current store size and configured maximum entries.
 * @returns Decision describing how many entries to evict.
 */
export function evaluateOptionStoreEvictionPolicy(
    input: OptionStoreEvictionPolicyInput
): OptionStoreEvictionPolicyDecision {
    const { currentStoreSize, maxEntries } = input;

    // 0 = eviction disabled; Infinity = unbounded — both require no eviction.
    if (maxEntries <= 0 || maxEntries === Infinity) {
        return { entriesToEvict: 0 };
    }

    if (currentStoreSize <= maxEntries) {
        return { entriesToEvict: 0 };
    }

    const overflow = currentStoreSize - maxEntries;
    return { entriesToEvict: overflow };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Typed wrapper around the inlined options-object guard from option-store.ts.
 * Duplicated here to keep `resolveOptionStoreMaxEntries` self-contained and
 * free of imports from `option-store.ts` (which has side effects).
 */
function getIdentifierCaseOptionsObject(options: unknown): Record<string, unknown> | null {
    if (options == null || typeof options !== "object" || Array.isArray(options)) {
        return null;
    }
    return options as Record<string, unknown>;
}
