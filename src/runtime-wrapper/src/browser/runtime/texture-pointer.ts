type BrowserGlobalScope = Record<string, unknown>;

type Html5BuiltinNameMap = {
    is_ptr: string;
    is_real: string;
    sprite_get_texture: string;
};

const TEXTURE_POINTER_PATCH_MARKER = "__gmloopTexturePointerSafetyPatched";

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object";
}

function isHtml5BuiltinNameMap(value: unknown): value is Html5BuiltinNameMap {
    if (!isObjectLike(value)) {
        return false;
    }

    return (
        value.self !== value &&
        typeof value.is_ptr === "string" &&
        typeof value.is_real === "string" &&
        typeof value.sprite_get_texture === "string"
    );
}

function resolveHtml5BuiltinNameMap(globalScope: BrowserGlobalScope): Html5BuiltinNameMap | null {
    for (const propertyName of Object.getOwnPropertyNames(globalScope)) {
        let candidate: unknown;
        try {
            candidate = globalScope[propertyName];
        } catch {
            continue;
        }

        if (isHtml5BuiltinNameMap(candidate)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Recognizes the documented object-backed texture handle returned by the
 * GameMaker HTML5 runtime.
 *
 * @param value - Value returned by a texture builtin.
 * @returns True when the value has the HTML5 texture-handle shape.
 */
export function isHtml5TextureHandle(value: unknown): boolean {
    if (!isObjectLike(value)) {
        return false;
    }

    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length !== 3 || !propertyNames.includes("toString")) {
        return false;
    }

    const toStringFunction = value.toString;
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
    const nameMap = resolveHtml5BuiltinNameMap(globalScope);
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

    const nativePointerFunction = pointerFunction as (...args: Array<unknown>) => unknown;
    const patchedPointerFunction = function (this: unknown, ...args: Array<unknown>): boolean {
        const value = args[0];
        if (Reflect.apply(nativePointerFunction, this, args) === true) {
            return true;
        }

        return isHtml5TextureHandle(value);
    };

    Reflect.set(patchedPointerFunction, TEXTURE_POINTER_PATCH_MARKER, true);
    globalScope[pointerPropertyName] = patchedPointerFunction;
    return true;
}
