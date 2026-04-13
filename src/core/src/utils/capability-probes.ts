import { isObjectLike } from "./object.js";

/**
 * Determine whether {@link value} exposes a callable member named
 * {@link property}. Several capability probes rely on this check to detect
 * RegExp, Map, and Set lookalikes along with parser-specific error facades, so
 * centralizing the logic ensures each module makes consistent decisions.
 *
 * @param {unknown} value Candidate object to inspect.
 * @param {string | symbol} property Property name to look up on {@link value}.
 * @returns {boolean} `true` when the property exists and is callable.
 */
export function hasFunction(value: unknown, property: string | symbol): boolean {
    return typeof (value as Record<string | symbol, unknown>)?.[property] === "function";
}

/**
 * Extract a numeric size hint from a collection-like object. Checks both `size`
 * and `length` properties in that order to support Map, Set, Array, and
 * array-like structures uniformly without branching on type checks.
 *
 * @param {unknown} iterable Candidate collection to inspect.
 * @returns {number | null} Finite numeric hint when present, otherwise `null`.
 */
function getLengthHint(iterable: unknown): number | null {
    const candidate = iterable as { size?: unknown; length?: unknown } | null | undefined;
    const sizeCandidate = candidate?.size ?? candidate?.length;
    return typeof sizeCandidate === "number" && Number.isFinite(sizeCandidate) ? sizeCandidate : null;
}

/**
 * Determine whether a value resembles an `Error` object by checking for the
 * standard `message` property and optional `name` field. Accepts error-like
 * objects from any realm or custom Error subclasses so consumers can handle
 * cross-boundary error reporting without relying on `instanceof`.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is Error} `true` when the value matches the Error shape.
 */
export function isErrorLike(value: unknown): value is Error {
    if (!isObjectLike(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;

    if (typeof candidate.message !== "string") {
        return false;
    }

    const { name } = candidate;
    if (name !== undefined && name !== null && typeof name !== "string") {
        return false;
    }

    return true;
}

/**
 * Determine whether a value resembles an `AggregateError` object by confirming
 * both the standard Error shape and an `errors` array property. Supports
 * cross-realm error handling so CLI modules can safely report batched failures
 * without depending on `instanceof AggregateError`.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is AggregateError} `true` when the value matches the AggregateError shape.
 */
export function isAggregateErrorLike(value: unknown): value is AggregateError {
    return isErrorLike(value) && Array.isArray((value as unknown as { errors: unknown }).errors);
}

/**
 * Determine whether a value behaves like a `RegExp` by checking for the
 * presence of `test` and `exec` methods. Accepts cross-realm RegExp instances
 * and polyfills so the formatter can uniformly validate pattern-like objects
 * without relying on `instanceof RegExp`.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is RegExp} `true` when the value exposes RegExp methods.
 */
export function isRegExpLike(value: unknown): value is RegExp {
    return isObjectLike(value) && hasFunction(value, "test") && hasFunction(value, "exec");
}

/**
 * Quick check for whether a value supports iteration.
 *
 * @param {unknown} iterable Candidate value to evaluate.
 * @returns {boolean} `true` when an iterator method is present, otherwise `false`.
 */
function getIterableMethod(iterable: unknown): (() => IterableIterator<unknown>) | null {
    const candidate = iterable as Record<symbol | string, unknown> | null | undefined;
    const method = candidate?.[Symbol.iterator] ?? candidate?.entries ?? candidate?.values;
    return typeof method === "function" ? (method as () => IterableIterator<unknown>) : null;
}

function hasIterator(iterable: unknown): boolean {
    return getIterableMethod(iterable) !== null;
}

function getIterableIterator(iterable: unknown): IterableIterator<unknown> | null {
    const method = getIterableMethod(iterable);
    if (method === null) {
        return null;
    }

    try {
        const iterator = method.call(iterable);
        return iterator && typeof iterator[Symbol.iterator] === "function" ? iterator : null;
    } catch {
        return null;
    }
}

/**
 * Determine whether a value implements the `Map` interface by confirming it
 * exposes `get`, `set`, `has`, and an iterator method. Accepts cross-realm Map
 * instances and Map-like polyfills so the formatter can treat collection-like
 * structures uniformly regardless of their prototype chain.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is Map<unknown, unknown>} `true` when the value behaves like a Map.
 */
export function isMapLike(value: unknown): value is Map<unknown, unknown> {
    return (
        isObjectLike(value) &&
        hasFunction(value, "get") &&
        hasFunction(value, "set") &&
        hasFunction(value, "has") &&
        hasIterator(value)
    );
}

/**
 * Determine whether a value implements the `Set` interface by confirming it
 * exposes `has`, `add`, and an iterator method. Accepts cross-realm Set
 * instances and Set-like polyfills so callers can normalize collection-like
 * structures without depending on `instanceof Set`.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is Set<unknown>} `true` when the value behaves like a Set.
 */
export function isSetLike(value: unknown): value is ReadonlySet<unknown> {
    return isObjectLike(value) && hasFunction(value, "has") && hasFunction(value, "add") && hasIterator(value);
}

/**
 * Lightweight truthiness probe for collection-like objects. Prefers numeric
 * `length`/`size` hints before walking an iterator so that expensive or
 * side-effectful iterables (generators) are only consumed when strictly
 * necessary. Non-iterable values immediately return `false` so callers can pass
 * optional inputs without pre-validating them.
 *
 * @param {Iterable<unknown> | { length?: number, size?: number } | null | undefined} iterable
 *        Candidate collection to inspect.
 * @returns {boolean} `true` when at least one item is detected, otherwise
 *                    `false`.
 */
export function hasIterableItems(iterable) {
    if (!iterable) {
        return false;
    }

    const lengthHint = getLengthHint(iterable);
    if (lengthHint !== null) {
        return lengthHint > 0;
    }

    const iterator = getIterableIterator(iterable);
    if (iterator === null) {
        return false;
    }

    for (const item of iterator) {
        void item;
        return true;
    }

    return false;
}

/**
 * Determine how many items an iterable-like object exposes. Numeric hints are
 * trusted when finite, mirroring the fast-path in {@link hasIterableItems};
 * otherwise the iterator is consumed eagerly to obtain an exact count.
 * Non-iterable values fall back to `0` so callers can safely chain arithmetic.
 *
 * @param {Iterable<unknown> | { length?: number, size?: number } | null | undefined} iterable
 *        Candidate collection to size.
 * @returns {number} Number of elements yielded by the iterable.
 */
export function getIterableSize(iterable) {
    const lengthHint = getLengthHint(iterable);
    if (lengthHint !== null) {
        return lengthHint;
    }

    const iterator = getIterableIterator(iterable);
    if (iterator === null) {
        return 0;
    }

    let count = 0;
    for (const item of iterator) {
        void item;
        count += 1;
    }
    return count;
}

/**
 * Normalize an arbitrary value into an array of key-value pairs suitable for
 * constructing a `Map`. Arrays are returned as-is (assuming they contain
 * tuples), iterables are drained into tuple arrays, and plain objects are
 * converted using `Object.entries`. Any other input yields an empty array so
 * callers can predictably construct Maps without additional guards.
 *
 * @param {unknown} candidate Value to resolve into entries.
 * @returns {Array<[unknown, unknown]>} Array of key-value tuples.
 */
function resolveMapEntries(candidate: unknown): Array<[unknown, unknown]> {
    if (Array.isArray(candidate)) {
        return candidate as Array<[unknown, unknown]>;
    }

    const iterator = getIterableIterator(candidate);
    if (iterator !== null) {
        const entries: Array<[unknown, unknown]> = [];
        for (const entry of iterator) {
            if (!Array.isArray(entry) || entry.length < 2) {
                return [];
            }
            entries.push([entry[0], entry[1]] as [unknown, unknown]);
        }
        return entries;
    }

    // Fallback to Object.entries for plain objects
    return isObjectLike(candidate) ? (Object.entries(candidate as object) as Array<[unknown, unknown]>) : [];
}

/**
 * Coerce a value into a `Set`-like instance. Returns the input unmodified when
 * it already implements the Set interface; otherwise constructs a new `Set`
 * from arrays, iterables, or falls back to an empty Set for non-iterable
 * inputs. This helper avoids repeatedly checking type unions when normalizing
 * user options or collection literals.
 *
 * @param {unknown} candidate Value to normalize into a Set.
 * @returns {Set<unknown>} Set-like instance or newly constructed Set.
 */
export function ensureSet(candidate: unknown): ReadonlySet<unknown> {
    if (isSetLike(candidate)) {
        return candidate;
    }

    if (Array.isArray(candidate) || (candidate && typeof candidate !== "string" && hasIterator(candidate))) {
        try {
            return new Set(candidate as Iterable<unknown>);
        } catch {
            return new Set();
        }
    }

    return new Set();
}

/**
 * Coerce a value into a `Map`-like instance. Returns the input unmodified when
 * it already implements the Map interface; constructs a new `Map` from entry
 * arrays, iterables, or plain objects via {@link resolveMapEntries}. Set-like
 * inputs yield an empty Map to avoid misinterpreting single values as entries.
 * This helper avoids branching on type unions when normalizing user options.
 *
 * @param {unknown} candidate Value to normalize into a Map.
 * @returns {Map<unknown, unknown>} Map-like instance or newly constructed Map.
 */
export function ensureMap(candidate: unknown): Map<unknown, unknown> {
    if (isMapLike(candidate)) {
        return candidate;
    }

    if (isSetLike(candidate)) {
        return new Map();
    }

    return new Map(resolveMapEntries(candidate));
}

/**
 * Determine whether a value behaves like a `Date` object by checking for the
 * presence of standard Date methods. Accepts cross-realm Date instances and
 * Date-like polyfills so modules can handle timestamps uniformly without
 * relying on `instanceof Date` checks that fail across execution contexts.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is Date} `true` when the value exposes Date methods.
 */
export function isDateLike(value: unknown): value is Date {
    return (
        isObjectLike(value) &&
        hasFunction(value, "toISOString") &&
        hasFunction(value, "getTime") &&
        hasFunction(value, "getFullYear")
    );
}

/**
 * Determine whether a value behaves like an `ArrayBuffer` by checking for the
 * standard byteLength property and the fact that it is an object. Accepts
 * cross-realm ArrayBuffer instances and polyfills so modules can handle binary
 * data uniformly without relying on `instanceof ArrayBuffer` checks.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is ArrayBuffer} `true` when the value matches ArrayBuffer shape.
 */
export function isArrayBufferLike(value: unknown): value is ArrayBuffer {
    if (!isObjectLike(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return typeof candidate.byteLength === "number" && typeof candidate.slice === "function";
}

/**
 * Determine whether a value behaves like an ArrayBufferView (TypedArray or DataView)
 * by checking for the standard buffer, byteOffset, and byteLength properties.
 * Accepts cross-realm views and polyfills so modules can handle binary views
 * uniformly without relying on platform-specific instanceof checks.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {boolean} `true` when the value matches ArrayBufferView shape.
 */
export function isArrayBufferViewLike(value: unknown): boolean {
    if (!isObjectLike(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
        isObjectLike(candidate.buffer) &&
        typeof candidate.byteOffset === "number" &&
        typeof candidate.byteLength === "number"
    );
}

/**
 * Determine whether a value is binary payload data (ArrayBuffer or ArrayBufferView).
 * This helper combines the ArrayBuffer and ArrayBufferView checks to provide a
 * unified predicate for modules that handle websocket messages or other binary
 * data streams without depending on constructor checks.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {boolean} `true` when the value is binary data.
 */
export function isBinaryDataLike(value: unknown): value is ArrayBuffer | ArrayBufferView {
    return isArrayBufferLike(value) || isArrayBufferViewLike(value);
}

/**
 * Determine whether a value behaves like a Uint8Array by checking for the
 * ArrayBufferView shape plus BYTES_PER_ELEMENT === 1. Accepts cross-realm
 * Uint8Array instances and polyfills so modules can handle byte arrays
 * uniformly without relying on instanceof checks.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {value is Uint8Array} `true` when the value matches Uint8Array shape.
 */
export function isUint8ArrayLike(value: unknown): value is Uint8Array {
    if (!isArrayBufferViewLike(value)) {
        return false;
    }

    const candidate = value as Record<string, unknown>;
    return candidate.BYTES_PER_ELEMENT === 1;
}
