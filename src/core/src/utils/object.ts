import { asArray, toArray } from "./array.js";
import { toFiniteNumber } from "./number.js";
import { GML_IDENTIFIER_NAME_PATTERN } from "./regexp.js";
import { formatWithIndefiniteArticle, isNonEmptyString } from "./string.js";

type AssertFunctionOptions = {
    errorMessage?: string;
};

type Callable = (...args: unknown[]) => unknown;

/**
 * Determine whether a value is a plain object (non-null object without an
 * Array instance). Some callers additionally require objects with prototypes
 * so the helper accepts an option mirroring that constraint.
 *
 * @param {unknown} value Candidate value to inspect.
 * @param {{ allowNullPrototype?: boolean }} [options]
 * @returns {value is object} `true` when {@link value} is a plain object.
 */
export function isPlainObject(value, { allowNullPrototype = true } = {}) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    if (!allowNullPrototype && Object.getPrototypeOf(value) === null) {
        return false;
    }

    return true;
}

/**
 * Ensure the provided value is callable. Centralizing this guard keeps
 * defensive checks consistent across modules that accept callbacks while
 * preserving the specific error messages historically raised by each call
 * site.
 *
 * @template {Function} TFunction
 * @param {TFunction | unknown} value Candidate function to validate.
 * @param {string} name Descriptive name used when constructing the error.
 * @returns {TFunction} The validated function reference.
 */
export function assertFunction<TFunction extends Callable>(
    value: unknown,
    name: string,
    { errorMessage }: AssertFunctionOptions = {}
): TFunction {
    if (typeof value === "function") {
        return value as TFunction;
    }

    const message =
        errorMessage ?? (isNonEmptyString(name) ? `${name} must be a function.` : "Value must be a function.");

    throw new TypeError(message);
}

/**
 * Check whether the provided value is an object-like reference. This mirrors
 * Lodash's definition, treating arrays and boxed primitives as object-like
 * while excluding `null` and primitive scalars. Functions are intentionally
 * omitted because the formatter exclusively passes structural metadata
 * objects through this guard.
 *
 * @param {unknown} value Candidate value to evaluate.
 * @returns {value is object} `true` when `value` can safely accept property access.
 */
export function isObjectLike(value?: unknown) {
    return typeof value === "object" && value !== null;
}

/**
 * Resolve a helper override from an optional helper bag while preserving the
 * original fallback behaviour. Consolidates the repeated guard pattern used
 * across transforms that support caller-provided helpers so each site no
 * longer hand-rolls `typeof` checks for every property.
 *
 * @param helpers Candidate helper bag supplied by the caller.
 * @param key Property name housing the override.
 * @param fallback Default helper used when no override is supplied.
 * @returns The override function when present, otherwise {@link fallback}.
 */
export function resolveHelperOverride<THelper extends Callable>(
    helpers: unknown,
    key: string | number | symbol,
    fallback: THelper
): THelper {
    const normalizedFallback = assertFunction<THelper>(
        fallback,
        isNonEmptyString(key) ? `${key.toString()} helper` : "helper override"
    );

    const hasHelperOverrides = helpers && (typeof helpers === "function" || isObjectLike(helpers));

    if (!hasHelperOverrides) {
        return normalizedFallback;
    }

    const candidate = (helpers as Record<string | number | symbol, unknown>)[key];

    if (typeof candidate !== "function") {
        return normalizedFallback;
    }

    return candidate as THelper;
}

const getObjectPrototypeToString = (value: unknown) => Object.prototype.toString.call(value);
const MISSING_METHOD_LIST_FORMATTER = new Intl.ListFormat("en", {
    style: "long",
    type: "conjunction"
});
const OBJECT_TAG_PATTERN = /^\[object ([^\]]+)\]$/;

/**
 * Describe {@link value} using terminology appropriate for error messages.
 *
 * This helper mirrors the branching previously duplicated across CLI modules
 * when reporting unexpected configuration payloads. Consolidating the logic
 * ensures objects, primitives, and special sentinels (like `null` or blank
 * strings) yield consistent phrasing.
 *
 * @param {unknown} value Value being described.
 * @param {{
 *   emptyStringLabel?: string | null,
 *   arrayLabel?: string,
 *   objectLabel?: string,
 *   formatTaggedObjectLabel?: (tagName: string) => string
 * }} [options]
 * @returns {string} Human-readable description of {@link value}.
 */
export function describeValueWithArticle(
    value?: unknown,
    {
        emptyStringLabel = null,
        arrayLabel = "an array",
        objectLabel = "an object",
        formatTaggedObjectLabel = (tagName) => `${formatWithIndefiniteArticle(tagName)} object`
    } = {}
) {
    if (value === null) {
        return "null";
    }

    if (value === undefined) {
        return "undefined";
    }

    const fallbackType = typeof value;

    if (Array.isArray(value)) {
        return arrayLabel;
    }

    if (typeof value === "string") {
        if (value.length === 0 && emptyStringLabel) {
            return emptyStringLabel;
        }

        return formatWithIndefiniteArticle("string");
    }

    if (typeof value === "boolean") {
        return formatWithIndefiniteArticle("boolean");
    }

    if (typeof value === "number") {
        return formatWithIndefiniteArticle("number");
    }

    if (typeof value === "bigint") {
        return formatWithIndefiniteArticle("bigint");
    }

    if (typeof value === "function") {
        return formatWithIndefiniteArticle("function");
    }

    if (typeof value === "symbol") {
        return formatWithIndefiniteArticle("symbol");
    }

    if (typeof value === "object") {
        const tagName = getObjectTagName(value);
        if (tagName) {
            return formatTaggedObjectLabel(tagName);
        }

        return objectLabel;
    }

    return formatWithIndefiniteArticle(fallbackType);
}

/**
 * Determine whether the provided value is an object or function reference.
 *
 * Several modules accept host-provided options or dependency containers that
 * may be implemented as objects or callable factories. Centralizing the guard
 * keeps their defensive checks aligned while ensuring `null` and primitives
 * are rejected consistently.
 *
 * @param {unknown} value Candidate value to inspect.
 * @returns {boolean} `true` when {@link value} can be treated as an object or function.
 */
export function isObjectOrFunction(value: unknown): value is object | Callable {
    if (value === null) {
        return false;
    }

    const type = typeof value;
    if (type === "object") {
        return true;
    }

    return type === "function";
}

/**
 * Ensure {@link value} exposes callable properties matching the provided
 * method names. Centralizes the defensive guard used across map-like helpers
 * so modules can validate host-provided collections without rewriting the same
 * `typeof` checks or error messaging.
 *
 * @template {Record<PropertyKey, unknown>} TObject
 * @param {TObject | unknown} value Candidate object supplying the methods.
 * @param {Array<PropertyKey> | PropertyKey} methodNames Method names expected
 *        on {@link value}. Pass either a single property key or an array of
 *        keys to validate multiple methods at once.
 * @param {{ name?: string; errorMessage?: string }} [options]
 * @returns {TObject}
 */
type AssertFunctionPropertiesOptions = {
    name?: string;
    errorMessage?: string;
};

type CoalesceOptionOptions = {
    fallback?: unknown;
};

export function assertFunctionProperties(
    value,
    methodNames,
    { name = "value", errorMessage }: AssertFunctionPropertiesOptions = {}
) {
    const requiredMethods = toArray(methodNames);

    if (requiredMethods.length === 0) {
        return value;
    }

    const target = isObjectOrFunction(value) ? (value as Record<PropertyKey, unknown>) : undefined;

    const missingMethods = requiredMethods
        .filter((methodName) => typeof target?.[methodName] !== "function")
        .map(String);

    if (missingMethods.length === 0) {
        return value;
    }

    if (errorMessage) {
        throw new TypeError(errorMessage);
    }

    const formattedList = MISSING_METHOD_LIST_FORMATTER.format(missingMethods);
    const suffix = missingMethods.length > 1 ? "functions" : "function";
    throw new TypeError(`${name} must provide ${formattedList} ${suffix}`);
}

/**
 * Check if a value has callable properties matching the provided method names.
 * Returns true only when all specified methods exist and are functions.
 *
 * This is the non-throwing variant of {@link assertFunctionProperties}, providing
 * a boolean predicate for conditional logic where error handling is unnecessary.
 * Use this when you need to check capabilities without enforcing requirements.
 *
 * @template T
 * @template K
 * @param {T | null | undefined} value Candidate object to inspect.
 * @param {K | ReadonlyArray<K>} methodNames Method name(s) to check for.
 *        Pass a single property key or an array of keys.
 * @returns {boolean} `true` when {@link value} is non-null and has all specified
 *          methods as callable properties; `false` otherwise.
 *
 * @example
 * if (hasMethods(semantic, "getSymbolOccurrences")) {
 *     const occurrences = await semantic.getSymbolOccurrences(name);
 * }
 *
 * @example
 * if (hasMethods(cache, ["get", "set", "has"])) {
 *     cache.set(key, value);
 * }
 */
export function hasMethods<T, K extends PropertyKey>(
    value: T | null | undefined,
    methodNames: K | ReadonlyArray<K>
): value is T & Record<K, (...args: never[]) => unknown> {
    if (!isObjectOrFunction(value)) {
        return false;
    }

    const methods = Array.isArray(methodNames) ? methodNames : [methodNames];
    const target = value as Record<PropertyKey, unknown>;

    for (const methodName of methods) {
        if (typeof target[methodName] !== "function") {
            return false;
        }
    }

    return true;
}

/**
 * Resolve the built-in `Object.prototype.toString` tag name for {@link value}.
 *
 * Normalizes the repeated guard logic used across CLI modules when formatting
 * diagnostic messages so they can consistently describe host-provided
 * structures (for example `Map`, `Set`, or typed arrays) without rewriting the
 * pattern matching at each call site. Plain objects default to `null` to mirror
 * the historical behaviour of the existing error formatters.
 *
 * @param {unknown} value Candidate value to inspect.
 * @param {{ includePlainObject?: boolean }} [options]
 * @param {boolean} [options.includePlainObject=false]
 * @returns {string | null} Tag name when resolved, otherwise `null`.
 */
export function getObjectTagName(value, { includePlainObject = false } = {}) {
    if (value === null) {
        return null;
    }

    const type = typeof value;
    if (type !== "object" && type !== "function") {
        return null;
    }

    const tag = getObjectPrototypeToString(value);
    const match = OBJECT_TAG_PATTERN.exec(tag);
    if (!match) {
        return null;
    }

    const [, tagName] = match;
    if (!tagName) {
        return null;
    }

    if (!includePlainObject && tagName === "Object") {
        return null;
    }

    return tagName;
}

/**
 * Validate that {@link value} is a plain object, throwing a descriptive
 * `TypeError` otherwise. Returns the original value to keep call sites terse
 * when destructuring or chaining normalization helpers.
 *
 * @template T extends object
 * @param {T | unknown} value Candidate value to validate.
 * @param {{
 *   name?: string,
 *   errorMessage?: string,
 *   allowNullPrototype?: boolean
 * }} [options]
 * @returns {T}
 */
type AssertPlainObjectOptions = {
    name?: string;
    errorMessage?: string;
    allowNullPrototype?: boolean;
};

export function assertPlainObject(
    value,
    { name = "value", errorMessage, allowNullPrototype = true }: AssertPlainObjectOptions = {}
) {
    const defaultMessage = `${name} must be a plain object`;

    if (!isPlainObject(value, { allowNullPrototype })) {
        throw new TypeError(errorMessage ?? defaultMessage);
    }

    return value;
}

/**
 * Executes the provided callback when `value` is an object-like entity. This
 * avoids repeating the null and type checks that precede many object
 * operations. An alternate return value (or thunk) can be supplied for
 * non-object inputs to keep call sites expression-friendly.
 *
 * @template {object} TObject
 * @template TResult
 * @param {unknown} value The candidate value to inspect before invoking
 *                        `onObjectLike`.
 * @param {(object: TObject) => TResult} onObjectLike Callback run when `value`
 *                                                   passes the object-like
 *                                                   guard.
 * @param {(() => TResult) | TResult} [onNotObjectLike] Optional fallback that
 *                                                      runs (or is returned)
 *                                                      when the guard fails.
 * @returns {TResult | undefined} The result of `onObjectLike`, the fallback,
 *                                or `undefined` when no fallback is supplied.
 */
export function withObjectLike(value, onObjectLike, onNotObjectLike) {
    assertFunction(onObjectLike, "onObjectLike");

    if (!isObjectLike(value)) {
        return typeof onNotObjectLike === "function" ? onNotObjectLike() : onNotObjectLike;
    }

    return onObjectLike(value);
}

function isFallbackThunk<TResult>(value: (() => TResult) | TResult | undefined): value is () => TResult {
    return typeof value === "function";
}

/**
 * Execute {@link onDefined} when {@link value} is not `undefined`. Centralizes
 * the guard around optional values so call sites can focus on their core logic
 * instead of repeating `!== undefined` checks and callback validation.
 *
 * Callers can optionally supply {@link onUndefined} which mirrors the fallback
 * semantics of {@link withObjectLike}, accepting either a thunk or a direct
 * value. When omitted the helper returns `undefined` to keep its behaviour
 * aligned with existing conditional assignments in the codebase.
 *
 * @template TValue
 * @template TResult
 * @param {TValue | undefined} value Candidate value to inspect.
 * @param {(value: TValue) => TResult} onDefined Callback invoked when
 *        {@link value} is defined.
 * @param {(() => TResult) | TResult} [onUndefined] Optional fallback returned
 *        (or invoked) when {@link value} is `undefined`.
 * @returns {TResult | undefined}
 */
export function withDefinedValue<TValue, TResult>(
    value: TValue | undefined,
    onDefined: (value: TValue) => TResult,
    onUndefined?: (() => TResult) | TResult
) {
    assertFunction(onDefined, "onDefined");

    if (value === undefined) {
        if (isFallbackThunk(onUndefined)) {
            return onUndefined();
        }

        return onUndefined;
    }

    return onDefined(value);
}

/**
 * Returns the first property value on the provided object that is neither
 * `undefined` nor `null`.
 *
 * Centralizes the common pattern of checking multiple option aliases (for
 * example public vs. internal `__`-prefixed keys) before falling back to a
 * default value.
 *
 * @template {string | number | symbol} TKey
 * @param {unknown} object Candidate object containing the properties.
 * @param {Array<TKey> | TKey} keys Property names to inspect in order.
 * @param {object} [options]
 * @param {unknown} [options.fallback]
 * @returns {unknown} The first matching property value or the fallback.
 */
export function coalesceOption(object, keys, { fallback }: CoalesceOptionOptions = {}) {
    if (!isObjectLike(object)) {
        return fallback;
    }

    // Fast path: avoid allocating a new array when callers provide a single key.
    if (Array.isArray(keys)) {
        for (const key of keys) {
            const value = object[key];

            if (value !== undefined && value !== null) {
                return value;
            }
        }

        return fallback;
    }

    if (keys == null) {
        return fallback;
    }

    const value = object[keys];
    if (value !== undefined && value !== null) {
        return value;
    }

    return fallback;
}

/**
 * Retrieve the entry associated with {@link key} from a `Map`-like store,
 * creating it with {@link initializer} when absent. Consolidates the
 * repetitive pattern of checking for an entry, constructing a default value,
 * and updating the map which appears throughout the CLI, project index, and
 * Feather transforms.
 *
 * The helper intentionally accepts `Map` and `WeakMap` instances (anything
 * implementing `get`, `set`, and `has`) so call sites can share the same
 * utility regardless of whether keys are primitive values or objects. The
 * initializer receives the key to support value derivation without requiring
 * surrounding closures.
 *
 * @template TKey
 * @template TValue
 * @param {{
 *     get(key: TKey): TValue | undefined;
 *     set(key: TKey, value: TValue): unknown;
 *     has(key: TKey): boolean;
 * }} store Map-like collection storing the entry.
 * @param {TKey} key Entry key to resolve.
 * @param {(key: TKey) => TValue} initializer Factory invoked when the entry is
 *        missing.
 * @returns {TValue} Existing or newly created entry.
 */
export function getOrCreateMapEntry(store, key, initializer) {
    assertFunctionProperties(store, ["get", "set", "has"], {
        name: "store"
    });
    assertFunction(initializer, "initializer");

    if (store.has(key)) {
        return store.get(key);
    }

    const value = initializer(key);
    store.set(key, value);
    return value;
}

/**
 * Increment the numeric value stored at {@link key} inside a Map-like
 * collection, defaulting missing or non-numeric entries to {@link fallback}.
 * Consolidates the "read, coerce, increment, write" pattern used throughout
 * the CLI and identifier case modules so callers don't have to repeat the
 * guards around `Map#get`/`Map#set` or numeric coercion.
 *
 * @param {{ get(key: any): unknown; set(key: any, value: number): unknown }} store
 *        Map-like collection providing `get` and `set` methods.
 * @param {unknown} key Entry key whose numeric value should be incremented.
 * @param {number | string | null | undefined} [amount=1] Amount to add to the
 *        stored value. Non-finite values are treated as zero so accidental
 *        `NaN` inputs do not corrupt counters.
 * @param {{ fallback?: number | string | null | undefined }} [options]
 *        Optional configuration bag.
 * @param {number | string | null | undefined} [options.fallback=0] Value to use
 *        when the current entry is missing or not a finite number.
 * @returns {number} The incremented numeric value stored in the map.
 */
export function incrementMapValue(store, key, amount = 1, { fallback = 0 } = {}) {
    const mapStore = assertFunctionProperties(store, ["get", "set"], {
        name: "store",
        errorMessage: "store must provide get and set functions"
    });

    const delta = toFiniteNumber(amount) ?? 0;
    const base = toFiniteNumber(mapStore.get(key)) ?? toFiniteNumber(fallback) ?? 0;

    const next = base + delta;
    mapStore.set(key, next);
    return next;
}

/**
 * Safely extract a string property from an object-like value, returning `null`
 * when the object is not object-like or the property is not a string.
 *
 * Consolidates the repeated pattern of checking whether a value is object-like
 * before accessing a property and verifying that the property is a string. This
 * helper appears throughout the codebase when parsing diagnostic metadata,
 * configuration objects, or other loosely-typed structures.
 *
 * @param {unknown} obj Candidate object containing the property.
 * @param {string} key Property name to extract.
 * @returns {string | null} The string value at {@link key}, or `null` when the
 *          object is not object-like or the property is not a string.
 */
export function getOptionalString(obj: unknown, key: string): string | null {
    if (!isObjectLike(obj)) {
        return null;
    }
    const value = (obj as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
}

/**
 * Safely extract an array property from an object-like value, returning an empty
 * array when the object is not object-like or the property is not an array.
 *
 * Consolidates the repeated pattern of checking whether a value is object-like
 * before accessing a property and verifying that the property is an array. This
 * helper appears throughout the codebase when parsing diagnostic metadata,
 * configuration objects, or other loosely-typed structures.
 *
 * @param {unknown} obj Candidate object containing the property.
 * @param {string} key Property name to extract.
 * @returns {unknown[]} The array value at {@link key}, or an empty array when the
 *          object is not object-like or the property is not an array.
 */
export function getOptionalArray(obj: unknown, key: string): unknown[] {
    if (!isObjectLike(obj)) {
        return [];
    }
    const value = (obj as Record<string, unknown>)[key];
    return asArray(value);
}

/**
 * Create a shallow snapshot of specific properties from a source object.
 *
 * This helper consolidates the pattern of extracting a subset of properties
 * from an object into a new snapshot object. Use cases include comment metadata
 * preservation during transformations where only certain fields need to be
 * temporarily saved and restored.
 *
 * @template TSource
 * @template {PropertyKey} TKey
 * @param {TSource} source Object from which to snapshot properties.
 * @param {ReadonlyArray<TKey> | Array<TKey>} keys Property names to include in the snapshot.
 * @returns {Partial<Pick<TSource, TKey>>} Snapshot object containing only the
 *          specified properties.
 */
export function snapshotProperties<TSource extends Record<PropertyKey, unknown>, TKey extends keyof TSource>(
    source: TSource,
    keys: ReadonlyArray<TKey> | Array<TKey>
): Partial<Pick<TSource, TKey>> {
    const snapshot = {} as Partial<Pick<TSource, TKey>>;
    for (const key of keys) {
        snapshot[key] = source[key];
    }
    return snapshot;
}

/**
 * Restore properties from a snapshot to a target object. Properties that are
 * `undefined` in the snapshot are deleted from the target; otherwise they are
 * assigned.
 *
 * This helper consolidates the repeated "if undefined delete else assign"
 * pattern used when restoring object properties from snapshots. The behavior
 * mirrors the typical cleanup logic where missing properties should be fully
 * removed rather than set to `undefined`.
 *
 * @template TTarget
 * @template {PropertyKey} TKey
 * @param {TTarget} target Object to which properties should be restored.
 * @param {Partial<Pick<TTarget, TKey>>} snapshot Snapshot containing property values.
 * @param {ReadonlyArray<TKey> | Array<TKey>} keys Property names to restore from the snapshot.
 * @returns {void}
 */
export function restoreProperties<TTarget extends Record<PropertyKey, unknown>, TKey extends keyof TTarget>(
    target: TTarget,
    snapshot: Partial<Pick<TTarget, TKey>>,
    keys: ReadonlyArray<TKey> | Array<TKey>
): void {
    for (const key of keys) {
        if (snapshot[key] === undefined) {
            delete target[key];
        } else {
            target[key] = snapshot[key] as TTarget[TKey];
        }
    }
}

/**
 * Resolves a `ReadonlyMap` of GML identifier names to suffix strings by merging
 * a set of defaults with optional user-provided overrides.
 *
 * Keys that are not valid GML identifiers are silently ignored. A `null` override
 * value removes the corresponding entry from the defaults. An empty-string override
 * is also ignored, preserving the default.
 *
 * @param defaults Base map of identifier name → suffix string entries.
 * @param overrides Optional per-identifier overrides; `null` removes an entry.
 * @returns Merged, validated map.
 */
export function resolveIdentifierKeyedSuffixMap(
    defaults: Readonly<Record<string, string>>,
    overrides: Readonly<Record<string, string | null>> | undefined
): ReadonlyMap<string, string> {
    const suffixMap = new Map<string, string>(Object.entries(defaults));
    if (!overrides) {
        return suffixMap;
    }

    for (const [name, suffix] of Object.entries(overrides)) {
        if (!GML_IDENTIFIER_NAME_PATTERN.test(name)) {
            continue;
        }

        if (suffix === null) {
            suffixMap.delete(name);
            continue;
        }

        if (typeof suffix !== "string" || suffix.length === 0) {
            continue;
        }

        suffixMap.set(name, suffix);
    }

    return suffixMap;
}
