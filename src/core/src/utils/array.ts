import { isObjectLike } from "./object.js";

// Reuse a frozen empty array to avoid allocating a new array on every call to
// `asArray`. The array is frozen so accidental mutations surface loudly during
// development instead of leaking shared state across callers.
const EMPTY_ARRAY: Array<never> = Object.freeze([]) as Array<never>;

type AssertArrayOptions = {
    name?: string;
    allowNull?: boolean;
    errorMessage?: string;
};

type PushUniqueOptions<T> = {
    isEqual?: (existing: T, candidate: T) => boolean;
};

type MergeUniqueValueOptions<T> = {
    coerce?: (value: unknown) => T | null | undefined;
    getKey?: (value: T) => unknown;
    freeze?: boolean;
};

/**
 * Normalize an iterable (or nullable) input into a concrete array so callers
 * can eagerly snapshot values before mutating the source. Unlike
 * {@link toArray}, which preserves array identity when possible, this helper
 * always returns a new array for iterables to avoid consuming generators more
 * than once.
 *
 * @template T
 * @param {Iterable<T> | Array<T> | null | undefined} values Candidate collection
 *        to normalize.
 * @returns {Array<T>} Array containing the iterable's elements, or an empty
 *          array when the input is nullish or non-iterable.
 */
export function toArrayFromIterable(values?) {
    if (values == null) {
        return [];
    }

    if (Array.isArray(values)) {
        return [...values];
    }

    if (typeof values[Symbol.iterator] === "function") {
        return Array.from(values);
    }

    return [];
}

/**
 * Coerce a nullable or singular value into an array so downstream code can
 * iterate without sprinkling `== null` checks.
 *
 * @template T
 * @param {T | Array<T> | null | undefined} value
 * @returns {Array<T>} Normalized array representation of the provided value.
 */
export function toArray(value?) {
    if (value == null) {
        return [];
    }

    return Array.isArray(value) ? value : [value];
}

/**
 * Assert that the provided value is an array. Centralizes the guard so callers
 * can reuse the same error messaging while keeping their control flow focused
 * on the surrounding logic. Optionally tolerates `null`/`undefined` inputs by
 * returning an empty array when {@link allowNull} is enabled.
 *
 * @template T
 * @param {Array<T> | null | undefined | unknown} value Candidate value to validate.
 * @returns {Array<T>} The validated array or a fresh empty array when
 *                     `allowNull` permits nullable inputs.
 */
export function assertArray<T>(
    value: unknown,
    { name = "value", allowNull = false, errorMessage }: AssertArrayOptions = {}
): Array<T> {
    if (Array.isArray(value)) {
        return value as Array<T>;
    }

    if (allowNull && value == null) {
        return [] as Array<T>;
    }

    const message = errorMessage ?? `${name} must be provided as an array.`;
    throw new TypeError(message);
}

/**
 * Return the provided value when it is already an array, otherwise yield an
 * empty array. Useful for treating optional array-like properties as a safe
 * iterable without introducing conditional branches at each call site.
 *
 * @template T
 * @param {unknown} value
 * @returns {Array<T>} Either the original array or a shared empty array.
 */
export function asArray<T>(value: unknown = EMPTY_ARRAY): Array<T> {
    return Array.isArray(value) ? value : EMPTY_ARRAY;
}

/**
 * Normalize a candidate array so callers can safely mutate the result without
 * repeating null checks and array guards. When the provided value is already
 * an array, the original reference is returned to preserve identity. All other
 * values fall back to a fresh empty array so mutations stay local to the call
 * site. Callers can opt into shallow cloning when they need to decouple from
 * the original array instance.
 *
 * Note: This function does NOT copy doc-comment metadata flags. If you need to
 * preserve `_preserveDescriptionBreaks`, `_suppressLeadingBlank`, or
 * `_blockCommentDocs` flags, call the doc-comment-specific
 * `copyDocCommentArrayFlags` helper on the result.
 *
 * @template T
 * @param {Array<T> | null | undefined | ReadonlyArray<T>} value
 * @param {{ clone?: boolean }} [options]
 * @param {boolean} [options.clone=false]
 * @returns {Array<T>} Mutably safe array representation of {@link value}.
 */
export function toMutableArray<T>(value: ReadonlyArray<T> | null | undefined, options?: { clone?: boolean }): Array<T>;
export function toMutableArray(value: unknown, options?: { clone?: boolean }): Array<unknown>;
export function toMutableArray(value: unknown, { clone = false }: { clone?: boolean } = {}) {
    if (!Array.isArray(value)) {
        return [];
    }

    return clone ? [...value] : value;
}

/**
 * Determine whether the provided value is an array containing at least one
 * element. This check mirrors the defensive guard pattern used throughout the
 * printers and parsers when iterating over optional collections.
 *
 * @param {unknown} value
 * @returns {value is Array<unknown>} `true` when `value` is a populated array.
 */
export function isNonEmptyArray(value) {
    return Array.isArray(value) && value.length > 0;
}

/**
 * Checks whether {@link index} can be safely used to read from {@link container}
 * without tripping over non-array parents or non-numeric indices. Centralizes
 * the guard so array-manipulating helpers can exit early before attempting to
 * splice or access unknown structures.
 *
 * @param {unknown} container Potential array owner of {@link index}.
 * @param {unknown} index Candidate index pointing into {@link container}.
 * @returns {index is number} `true` when {@link container} is an array and the
 *                            index is a numeric offset.
 */
export function isArrayIndex(container, index) {
    if (!Array.isArray(container)) {
        return false;
    }

    if (typeof index !== "number") {
        return false;
    }

    return Number.isInteger(index);
}

/**
 * Find the index of the last element matching the provided predicate.
 * Delegates to the native Array.prototype.findLastIndex while providing
 * null-safe handling.
 *
 * @template T
 * @param {ReadonlyArray<T> | null | undefined} array Candidate array.
 * @param {(value: T, index: number, array: ReadonlyArray<T>) => boolean} predicate
 * @returns {number} Index of the last matching element or -1.
 */
export function findLastIndex(array, predicate) {
    if (!Array.isArray(array)) {
        return -1;
    }

    return array.findLastIndex(predicate);
}

/**
 * Create a new array containing the first occurrence of each unique value
 * encountered in the provided iterable while preserving the original order.
 *
 * @template T
 * @param {Iterable<T> | Array<T> | null | undefined} values
 * @param {{ freeze?: boolean }} [options]
 * @param {boolean} [options.freeze=false]
 * @returns {Array<T> | ReadonlyArray<T>}
 */
export function uniqueArray(values, { freeze = false } = {}) {
    if (values == null || typeof values?.[Symbol.iterator] !== "function") {
        return freeze ? Object.freeze([]) : [];
    }

    // Fast path for common small arrays to avoid constructing a Set.
    if (Array.isArray(values) && values.length < 2) {
        const uniqueValues = values.length === 1 ? [values[0]] : [];
        return freeze ? Object.freeze(uniqueValues) : uniqueValues;
    }

    const uniqueValues = Array.from(new Set(values));

    return freeze ? Object.freeze(uniqueValues) : uniqueValues;
}

/**
 * Remove falsy entries from {@link values} while preserving order. Mirrors the
 * common `array.filter(Boolean)` pattern used across the CLI but centralizes it
 * so future call sites do not need to reimplement the guard. Non-iterable
 * inputs fall back to an empty array to keep the helper resilient to optional
 * candidates.
 *
 * @template T
 * @param {Iterable<T> | Array<T> | null | undefined} values
 * @param {{ freeze?: boolean }} [options]
 * @param {boolean} [options.freeze=false]
 * @returns {Array<T> | ReadonlyArray<T>}
 */
export function compactArray(values?, { freeze = false } = {}) {
    if (values == null || typeof values[Symbol.iterator] !== "function") {
        return freeze ? Object.freeze([]) : [];
    }

    const result = [];

    for (const item of values) {
        if (item) {
            result.push(item);
        }
    }

    return freeze ? Object.freeze(result) : result;
}

/**
 * Append {@link value} to {@link array} when it is not already present.
 *
 * Centralizes the inclusion guard used throughout the project index and
 * resource analysis modules so callers can focus on their domain logic while
 * keeping duplicate prevention consistent. The helper now delegates to
 * `Array#includes`, preserving SameValueZero semantics (including `NaN`
 * handling) without reimplementing the iteration logic, and returns a boolean
 * so hot paths can detect when a new entry was appended.
 *
 * @template T
 * @param {Array<T>} array Array that should receive {@link value} when absent.
 * @param {T} value Candidate value to append.
 * @param {{ isEqual?: (existing: T, candidate: T) => boolean }} [options]
 *        Optional equality comparator for cases where strict equality is not
 *        sufficient.
 * @returns {boolean} `true` when the value was appended.
 */
export function pushUnique(array, value, { isEqual }: PushUniqueOptions<any> = {}) {
    if (!Array.isArray(array)) {
        throw new TypeError("pushUnique requires an array to append to.");
    }

    if (typeof isEqual === "function") {
        for (const entry of array) {
            if (isEqual(entry, value)) {
                return false;
            }
        }

        array.push(value);
        return true;
    }

    if (array.includes(value)) {
        return false;
    }

    array.push(value);
    return true;
}

/**
 * Merge a collection of additional entries into a default array while
 * preserving order and eliminating duplicates. Callers can optionally supply a
 * coercion function to normalize raw entries before they are compared and a
 * key extractor to control how uniqueness is determined.
 *
 * @template T
 * @param {ReadonlyArray<T>} defaultValues
 * @param {Iterable<unknown> | null | undefined} additionalValues
 * @param {{
 *   coerce?: (value: unknown) => T | null | undefined,
 *   getKey?: (value: T) => unknown,
 *   freeze?: boolean
 * }} [options]
 * @param {(value: unknown) => T | null | undefined} [options.coerce]
 * @param {(value: T) => unknown} [options.getKey]
 * @param {boolean} [options.freeze]
 * @returns {ReadonlyArray<T>}
 */
export function mergeUniqueValues(
    defaultValues,
    additionalValues,
    { coerce, getKey = (value) => value, freeze = true }: MergeUniqueValueOptions<any> = {}
) {
    const merged = Array.isArray(defaultValues) ? [...defaultValues] : [];
    const normalize = typeof coerce === "function" ? coerce : (value: unknown) => value;
    const seen = new Set();

    for (const element of merged) {
        seen.add(getKey(element));
    }

    for (const rawValue of toArrayFromIterable(additionalValues)) {
        const value = normalize(rawValue);
        if (value == null) {
            continue;
        }

        const key = getKey(value);
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        merged.push(value);
    }

    return freeze ? Object.freeze(merged) : merged;
}

/**
 * Create shallow clones of object-like entries in an array.
 *
 * Many modules require defensive copies of object entries before mutation or
 * serialization to avoid corrupting shared state. Centralizing the cloning
 * logic keeps call sites focused on their domain logic while preserving the
 * lightweight defensive guards that transforms and serializers rely on.
 *
 * @template T
 * @param {Array<T> | null | undefined} entries Collection of entries to clone.
 * @returns {Array<T>} Array containing shallow clones of object entries.
 */
export function cloneObjectEntries<T>(entries?: Array<T> | null): Array<T> {
    if (!isNonEmptyArray(entries)) {
        return [];
    }

    return entries.map((entry) => (isObjectLike(entry) ? { ...entry } : entry));
}

/**
 * Normalize the accumulator used by CLI option collectors so commands can
 * accept either a scalar flag (for example `--tag alpha`) or repeated
 * invocations (`--tag alpha --tag beta`). The helper mirrors Commander's
 * accumulation semantics and is reused by multiple modules that surface
 * collection-style options.
 *
 * @template T
 * @param {T} value Value to append to the collection.
 * @param {Array<T> | T | undefined} collection Current accumulator provided by
 *        Commander (or similar collectors).
 * @returns {Array<T>} Array containing both prior entries and {@link value}.
 */
export function appendToCollection(value, collection?) {
    if (collection === undefined) {
        return [value];
    }

    if (Array.isArray(collection)) {
        collection.push(value);
        return collection;
    }

    return [collection, value];
}
