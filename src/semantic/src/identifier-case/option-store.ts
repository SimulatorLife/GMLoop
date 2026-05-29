import { Core } from "@gmloop/core";

import { getDefaultIdentifierCaseOptionStoreMaxEntries } from "./option-store-defaults.js";
import { evaluateOptionStoreEvictionPolicy, resolveOptionStoreMaxEntries } from "./option-store-policy.js";

// Use canonical Core namespace instead of destructuring
// Helpers used from Core.Utils:
// - Core.getOrCreateMapEntry
// - Core.isFiniteNumber
// - Core.isNonEmptyString
// - Core.isObjectLike

const optionStoreMap = new Map();
const STORE_BLOCKLIST = new Set([
    "__identifierCaseProjectIndex",
    "__identifierCaseRenameMap",
    "__identifierCasePlanSnapshot"
]);

function getIdentifierCaseOptionsObject(options: unknown): Record<string, unknown> | null {
    if (!Core.isObjectLike(options)) {
        return null;
    }

    if (Array.isArray(options)) {
        return null;
    }

    return options as Record<string, unknown>;
}

function trimOptionStoreMap(maxEntries = getDefaultIdentifierCaseOptionStoreMaxEntries()) {
    if (!Number.isFinite(maxEntries) || maxEntries === Infinity || maxEntries <= 0) {
        return;
    }

    const evictionDecision = evaluateOptionStoreEvictionPolicy({
        currentStoreSize: optionStoreMap.size,
        maxEntries
    });

    if (evictionDecision.entriesToEvict === 0) {
        return;
    }

    const { value: oldestKey, done } = optionStoreMap.keys().next();
    if (!done && oldestKey !== undefined) {
        optionStoreMap.delete(oldestKey);
    }
}

/**
 * Resolve the maximum number of cached option-store entries that should be
 * retained for the provided options bag. The identifier-case tooling allows an
 * explicit `Infinity` override so long-running editors can opt out of cache
 * eviction, but otherwise normalizes any user-supplied value to a non-negative
 * integer so the trimming logic never sees `NaN`, negative values, or
 * fractional counts.
 *
 * @param {unknown} options A consumer-supplied options object that may embed
 * the option-store max-entries override.
 * @returns {number} The normalized entry limit, defaulting to the shared
 * baseline when the caller omits or misconfigures the override.
 */
function resolveMaxOptionStoreEntries(options: unknown): number {
    return resolveOptionStoreMaxEntries(options, getDefaultIdentifierCaseOptionStoreMaxEntries);
}

function getStoreKey(options) {
    const resolvedOptions = getIdentifierCaseOptionsObject(options);
    if (!resolvedOptions) {
        return null;
    }

    if (resolvedOptions.__identifierCaseOptionsStoreKey !== undefined) {
        return resolvedOptions.__identifierCaseOptionsStoreKey;
    }

    if (Core.isNonEmptyString(resolvedOptions.filepath)) {
        return resolvedOptions.filepath;
    }

    return null;
}

function getOrCreateStoreEntry(storeKey) {
    const existed = optionStoreMap.has(storeKey);
    const entry = Core.getOrCreateMapEntry(optionStoreMap, storeKey, () => ({}));

    if (existed) {
        optionStoreMap.delete(storeKey);
        optionStoreMap.set(storeKey, entry);
    }

    return entry;
}

function updateStore(options, key, value) {
    const resolvedOptions = getIdentifierCaseOptionsObject(options);
    if (!resolvedOptions) {
        return;
    }

    const store = resolvedOptions.__identifierCaseOptionsStore;
    if (Core.isObjectLike(store)) {
        store[key] = value;
    }

    const storeKey = getStoreKey(resolvedOptions);
    // treat both `null` and `undefined` as "no store key" so callers that
    // explicitly pass `null` (test helpers use `clearIdentifierCaseOptionStore(null)`)
    // behave as expected. Using loose equality here intentionally covers both
    // `null` and `undefined` without changing external contracts.
    if (storeKey == null) {
        return;
    }

    if (STORE_BLOCKLIST.has(key)) {
        return;
    }

    const entry = getOrCreateStoreEntry(storeKey);
    entry[key] = value;
    trimOptionStoreMap(resolveMaxOptionStoreEntries(options));
}

function deleteFromStore(storeKey, key) {
    // Tolerate null or undefined store keys during deletion to simplify caller
    // logic. When the store key is absent, the deletion cannot proceed (there
    // is no entry to remove), so we return early without throwing. This defensive
    // posture allows cleanup paths to call deleteFromStore unconditionally without
    // needing to check whether the key exists first.
    if (storeKey == null) {
        return;
    }

    const entry = optionStoreMap.get(storeKey);
    if (!entry || !Object.hasOwn(entry, key)) {
        return;
    }

    delete entry[key];

    if (Object.keys(entry).length === 0) {
        optionStoreMap.delete(storeKey);
    }
}

export function setIdentifierCaseOption(options, key, value) {
    const resolvedOptions = getIdentifierCaseOptionsObject(options);
    if (!resolvedOptions) {
        return;
    }

    resolvedOptions[key] = value;
    updateStore(resolvedOptions, key, value);
}

export function deleteIdentifierCaseOption(options, key) {
    const resolvedOptions = getIdentifierCaseOptionsObject(options);
    if (!resolvedOptions || key === undefined) {
        return;
    }

    if (Object.hasOwn(resolvedOptions, key)) {
        try {
            delete resolvedOptions[key];
        } catch {
            resolvedOptions[key] = undefined;
        }
    }

    const storeKey = getStoreKey(resolvedOptions);
    deleteFromStore(storeKey, key);
}

export function getIdentifierCaseOptionStore(storeKey) {
    // accept null as a valid lookup key ({tests sometimes pass null explicitly}),
    // but reject undefined which indicates the caller forgot to provide arg.
    if (storeKey === undefined) {
        return null;
    }

    return optionStoreMap.get(storeKey) ?? null;
}

export function clearIdentifierCaseOptionStore(storeKey) {
    // callers may pass `null` intentionally to mean "clear everything" in
    // test helpers; accept either `null` or `undefined` for that behavior.
    if (storeKey == null) {
        optionStoreMap.clear();
        return;
    }

    optionStoreMap.delete(storeKey);
}

export {
    applyIdentifierCaseOptionStoreEnvOverride,
    getDefaultIdentifierCaseOptionStoreMaxEntries,
    setDefaultIdentifierCaseOptionStoreMaxEntries
} from "./option-store-defaults.js";
export {
    DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES as DEFAULT_MAX_IDENTIFIER_CASE_OPTION_STORE_ENTRIES,
    IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_BASELINE,
    IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES_ENV_VAR,
    DEFAULT_IDENTIFIER_CASE_OPTION_STORE_MAX_ENTRIES as MAX_IDENTIFIER_CASE_OPTION_STORE_ENTRIES
} from "./option-store-defaults.js";
