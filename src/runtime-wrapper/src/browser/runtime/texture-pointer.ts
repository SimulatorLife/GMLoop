import { resolveHtml5BuiltinNameMap } from "../support/html5-builtin-discovery.js";

type BrowserGlobalScope = Record<string, unknown>;

const TEXTURE_POINTER_PATCH_MARKER = "__gmloopTexturePointerSafetyPatched";

const TEXTURE_POINTER_BUILTIN_NAMES = {
    is_ptr: "is_ptr",
    is_real: "is_real",
    sprite_get_texture: "sprite_get_texture"
} as const;

/**
 * Recognizes the documented object-backed texture handle returned by the
 * GameMaker HTML5 runtime.
 *
 * @param value - Value returned by a texture builtin.
 * @returns True when the value has the HTML5 texture-handle shape.
 */
export function isHtml5TextureHandle(value: unknown): boolean {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length !== 3 || !propertyNames.includes("toString")) {
        return false;
    }

    const toStringFunction = Reflect.get(value, "toString");
    if (typeof toStringFunction !== "function") {
        return false;
    }

    try {
        const description = Reflect.apply(toStringFunction, value, []);
        return typeof description === "string" && description.startsWith("Texture:");
    } catch {
        return false;
    }
}

/**
 * Evaluates the HTML5 runtime's native pointer predicate without allowing
 * unsupported values to escape as runtime errors.
 *
 * GameMaker's native HTML5 predicate can throw for `undefined` and `null`,
 * even though GML code is allowed to pass those values to `is_ptr` and expects
 * a false result. The wrapper must preserve the native answer for supported
 * values while treating those unsupported values as non-pointers and still
 * recognizing object-backed HTML5 texture handles.
 *
 * @param pointerFunction - Native HTML5 pointer predicate.
 * @param thisArg - Receiver used when invoking the native predicate.
 * @param value - Value to classify.
 * @returns True when the native predicate or HTML5 texture-handle check accepts the value.
 */
export function evaluateHtml5PointerPredicate(
    pointerFunction: (this: unknown, value: unknown) => unknown,
    thisArg: unknown,
    value: unknown
): boolean {
    try {
        if (Reflect.apply(pointerFunction, thisArg, [value]) === true) {
            return true;
        }
    } catch {
        // The native HTML5 predicate throws for some non-pointer values.
        // Those values are classified by the safe fallback below.
    }

    return isHtml5TextureHandle(value);
}

/**
 * Make GameMaker HTML5 texture handles satisfy the runtime's `is_ptr` test.
 *
 * GameMaker's HTML5 `sprite_get_texture` returns a small object-backed texture
 * handle whose string form starts with `Texture:`. Some runtime builds expose
 * `is_ptr` as an ArrayBuffer-only predicate, which rejects that documented
 * handle shape and causes otherwise valid hot-reload projects to discard or
 * throw on every sprite texture. The patch preserves the native predicate and
 * adds only the handle shape emitted by the HTML5 texture implementation.
 *
 * @param globalScope - Browser global object containing the minified runtime.
 * @returns True when the runtime's `is_ptr` function was patched.
 */
export function applyHtml5TexturePointerSafetyPatch(globalScope: BrowserGlobalScope): boolean {
    const nameMap = resolveHtml5BuiltinNameMap(globalScope, TEXTURE_POINTER_BUILTIN_NAMES);
    const pointerPropertyName = typeof globalScope.is_ptr === "function" ? "is_ptr" : nameMap?.is_ptr;
    if (pointerPropertyName === undefined) {
        return false;
    }

    const pointerFunction = globalScope[pointerPropertyName];
    if (typeof pointerFunction !== "function") {
        return false;
    }

    if (Reflect.get(pointerFunction, TEXTURE_POINTER_PATCH_MARKER) === true) {
        return false;
    }

    const nativePointerFunction = pointerFunction as (this: unknown, value: unknown) => unknown;
    const patchedPointerFunction = function (this: unknown, ...args: Array<unknown>): boolean {
        return evaluateHtml5PointerPredicate(nativePointerFunction, this, args[0]);
    };

    Reflect.set(patchedPointerFunction, TEXTURE_POINTER_PATCH_MARKER, true);
    globalScope[pointerPropertyName] = patchedPointerFunction;
    return true;
}
