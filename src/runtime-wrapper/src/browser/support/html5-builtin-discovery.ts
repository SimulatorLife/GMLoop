/**
 * Shared helpers for discovering the minified GameMaker HTML5 runtime's
 * builtin name map.
 *
 * The HTML5 runtime packs a single object onto a global property whose
 * keys expose the minified names of the runtime's builtins
 * (`is_ptr`, `filename_change_ext`, etc.). Several runtime patches need to
 * locate that map so they can resolve the runtime function names without
 * hard-coding them. Previously each patch duplicated its own local
 * `isObjectLike`, `isHtml5BuiltinNameMap`, and `resolveHtml5BuiltinNameMap`
 * helpers; this module consolidates the duplicated logic so each patch
 * declares only the specific builtin keys it needs.
 *
 * The runtime wrapper ships these helpers locally instead of importing
 * `@gmloop/core` so the browser bundle remains loadable without package-name
 * resolution. The plain-object check intentionally mirrors
 * `Core.isObjectLike` and the contract is pinned by the
 * `html5-builtin-discovery` test suite.
 */
type BrowserGlobalScope = Record<string, unknown>;

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

/**
 * Type guard that recognizes a value shaped like the HTML5 runtime's builtin
 * name map: a non-self-referencing object whose enumerated keys all hold
 * `string` values naming the minified runtime function.
 *
 * @typeParam TKeys - String keys the returned map must expose.
 * @param value - Candidate value to inspect.
 * @param builtinNames - The unminified builtin names that must all be present.
 * @returns `true` when `value` matches the requested name map shape.
 */
export function isHtml5BuiltinNameMap<TKeys extends string>(
    value: unknown,
    builtinNames: Readonly<Record<TKeys, string>>
): value is Readonly<Record<TKeys, string>> {
    if (!isObjectLike(value)) {
        return false;
    }

    if (value.self === value) {
        return false;
    }

    for (const builtinKey of Object.keys(builtinNames)) {
        if (typeof value[builtinKey] !== "string") {
            return false;
        }
    }

    return true;
}

/**
 * Walk the global scope's own properties and return the first value that
 * matches the requested HTML5 builtin name map shape. Used to recover the
 * minified runtime's builtins when the GameMaker HTML5 runtime does not
 * expose them directly on the global.
 *
 * Property getters that throw while being read are skipped so the helper
 * tolerates cross-realm collaborators without aborting the search.
 *
 * @typeParam TKeys - String keys the resolved map must expose.
 * @param globalScope - Browser global object containing the minified runtime.
 * @param builtinNames - The unminified builtin names that must all be present.
 * @returns The first matching name map, or `null` when none is found.
 */
export function resolveHtml5BuiltinNameMap<TKeys extends string>(
    globalScope: BrowserGlobalScope,
    builtinNames: Readonly<Record<TKeys, string>>
): Readonly<Record<TKeys, string>> | null {
    for (const propertyName of Object.getOwnPropertyNames(globalScope)) {
        let candidate: unknown;
        try {
            candidate = globalScope[propertyName];
        } catch {
            continue;
        }

        if (isHtml5BuiltinNameMap(candidate, builtinNames)) {
            return candidate;
        }
    }

    return null;
}
