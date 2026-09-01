import { isArrayBufferLike } from "../support/runtime-value-utils.js";
import { evaluateHtml5PointerPredicate, isHtml5TextureHandle } from "./texture-pointer.js";

type RuntimeBuiltinFunction = (...args: Array<unknown>) => unknown;

type RuntimeBuiltinFunctionMap = Record<string, RuntimeBuiltinFunction>;

type MinifiedBuiltinMap = Record<string, unknown>;

const MINIFIED_BUILTIN_MAP_SHAPE = Object.freeze(["mouse_x", "current_time", "variable_instance_get"]);

const FALLBACK_RUNTIME_FUNCTIONS: RuntimeBuiltinFunctionMap = Object.freeze({
    array_copy(destination, destinationIndex, source, sourceIndex, length) {
        if (!Array.isArray(destination) || !Array.isArray(source)) {
            return destination;
        }

        const destinationStart = Number(destinationIndex);
        const sourceStart = Number(sourceIndex);
        const copyLength = Number(length);
        for (let offset = 0; offset < copyLength; offset += 1) {
            destination[destinationStart + offset] = source[sourceStart + offset];
        }
        return destination;
    },
    gml_pragma() {
        // `gml_pragma` is a compiler directive. The live-reload transpiler
        // preserves it in JavaScript so the runtime must provide a no-op.
        return undefined;
    },
    event_inherited() {
        // The GML `event_inherited()` builtin invokes the same event on the
        // parent object. The live-reload patch replaces a single event
        // function in isolation, so there is no parent event to dispatch to
        // here. Returning a no-op keeps the patch from throwing
        // "event_inherited is not defined" on the first event that uses
        // it; callers that need the parent behaviour can request a full
        // live-reload restart.
        return undefined;
    },
    is_ptr(value) {
        // Use the duck-typed `isArrayBufferLike` capability probe rather than
        // `value instanceof ArrayBuffer` so the runtime recognises cross-realm
        // buffers and duck-typed substitutes (e.g. browser shims, test doubles,
        // and `Proxy` wrappers) that expose the documented `byteLength` and
        // `slice` surface without sharing the realm-local `ArrayBuffer`
        // constructor. This keeps the `is_ptr` contract aligned with the
        // shared `Core.isArrayBufferLike` probe and the local mirror in
        // `support/runtime-value-utils.ts`.
        return isArrayBufferLike(value) || isHtml5TextureHandle(value);
    },
    cos(value) {
        return Math.cos(Number(value));
    },
    lerp(from, to, amount) {
        return Number(from) + (Number(to) - Number(from)) * Number(amount);
    },
    max(...values) {
        return Math.max(...values.map(Number));
    },
    min(...values) {
        return Math.min(...values.map(Number));
    },
    point_distance(x1, y1, x2, y2) {
        return Math.hypot(Number(x2) - Number(x1), Number(y2) - Number(y1));
    },
    sin(value) {
        return Math.sin(Number(value));
    }
});

/**
 * Returns true when the runtime wrapper owns a stable fallback implementation
 * for a GameMaker builtin emitted by hot-reload patches.
 *
 * @param name GameMaker function name to test.
 * @returns True when the wrapper can satisfy the builtin without a user script patch.
 */
export function isRuntimeBuiltinFunction(name: string): boolean {
    return Object.hasOwn(FALLBACK_RUNTIME_FUNCTIONS, name);
}

function isMinifiedBuiltinMap(value: unknown): value is MinifiedBuiltinMap {
    if (value === null || typeof value !== "object") {
        return false;
    }

    const candidate = value as MinifiedBuiltinMap;
    if (candidate.self === value) {
        return false;
    }

    return MINIFIED_BUILTIN_MAP_SHAPE.every((propertyName) => typeof candidate[propertyName] === "string");
}

function readGlobalProperty(globalScope: Record<string, unknown>, propertyName: string): unknown {
    try {
        return globalScope[propertyName];
    } catch {
        return undefined;
    }
}

function resolveMinifiedBuiltinMap(globalScope: Record<string, unknown>): MinifiedBuiltinMap | null {
    const preferredMap = readGlobalProperty(globalScope, "_HL4");
    if (isMinifiedBuiltinMap(preferredMap)) {
        return preferredMap;
    }

    for (const propertyName of Object.getOwnPropertyNames(globalScope)) {
        const candidate = readGlobalProperty(globalScope, propertyName);
        if (isMinifiedBuiltinMap(candidate)) {
            return candidate;
        }
    }

    return null;
}

function resolveMappedRuntimeBuiltin(
    globalScope: Record<string, unknown>,
    name: string
): RuntimeBuiltinFunction | undefined {
    const directValue = readGlobalProperty(globalScope, name);
    if (typeof directValue === "function") {
        return directValue as RuntimeBuiltinFunction;
    }

    const runtimeBuiltins = readGlobalProperty(globalScope, "g_pBuiltIn");
    if (runtimeBuiltins !== null && typeof runtimeBuiltins === "object") {
        const builtinValue = readGlobalProperty(runtimeBuiltins as Record<string, unknown>, name);
        if (typeof builtinValue === "function") {
            return builtinValue as RuntimeBuiltinFunction;
        }
    }

    const minifiedBuiltinMap = resolveMinifiedBuiltinMap(globalScope);
    const mappedName = minifiedBuiltinMap?.[name];
    if (typeof mappedName !== "string" || mappedName.length === 0) {
        return undefined;
    }

    const mappedValue = readGlobalProperty(globalScope, mappedName);
    return typeof mappedValue === "function" ? (mappedValue as RuntimeBuiltinFunction) : undefined;
}

/**
 * Returns true when the current HTML5 runtime can resolve a canonical builtin
 * name, including functions hidden behind GameMaker's minified name table.
 *
 * @param globalScope Browser global scope for the current runtime.
 * @param name Canonical GameMaker builtin name.
 * @returns True when a fallback, canonical, builtin-table, or minified function exists.
 */
export function isRuntimeBuiltinAvailable(globalScope: Record<string, unknown>, name: string): boolean {
    return isRuntimeBuiltinFunction(name) || resolveMappedRuntimeBuiltin(globalScope, name) !== undefined;
}

// Cached result of resolveRuntimeBuiltinFunctions, keyed on the runtime's
// builtin table reference (`g_pBuiltIn`, or the minified `_HL4` equivalent).
// GameMaker HTML5 installs this table once during runtime startup and never
// replaces the reference afterward, so caching on its identity is safe (the
// same assumption `resolveBuiltinConstants` in builtin-constants.ts already
// relies on). Without this cache, every patched script/event/closure
// invocation would re-run the full fallback-function resolution loop —
// including, in the minified-map discovery path, an `Object.getOwnPropertyNames`
// scan of the global scope — on every call in a 60fps game loop.
let _cachedRuntimeBuiltinFunctions: RuntimeBuiltinFunctionMap | null = null;
let _cachedRuntimeBuiltinTableRef: unknown = null;

/**
 * Resolves the callable builtin surface available to hot-reload patches.
 *
 * GameMaker HTML5 minifies many runtime functions and does not always expose
 * them on `window`, so the wrapper provides stable implementations for the
 * small builtin set emitted directly by live-reload patches and lets real
 * globals override those fallbacks when they are available.
 *
 * The result is memoized by the identity of the runtime's builtin table
 * (`g_pBuiltIn` or its minified `_HL4` equivalent). Because that table is
 * installed once by the GameMaker HTML5 runtime at startup, the cache is
 * effectively a permanent hit after the runtime becomes ready, avoiding
 * per-call object allocation and global-scope scanning in hot script paths.
 *
 * @param globalScope Browser global scope for the current runtime.
 * @returns A map of builtin function names to callables.
 */
export function resolveRuntimeBuiltinFunctions(globalScope: Record<string, unknown>): RuntimeBuiltinFunctionMap {
    const builtinTableRef =
        readGlobalProperty(globalScope, "g_pBuiltIn") ?? readGlobalProperty(globalScope, "_HL4") ?? null;

    if (
        builtinTableRef !== null &&
        builtinTableRef === _cachedRuntimeBuiltinTableRef &&
        _cachedRuntimeBuiltinFunctions !== null
    ) {
        return _cachedRuntimeBuiltinFunctions;
    }

    const functions: RuntimeBuiltinFunctionMap = { ...FALLBACK_RUNTIME_FUNCTIONS };

    for (const name of Object.keys(FALLBACK_RUNTIME_FUNCTIONS)) {
        const globalValue = resolveMappedRuntimeBuiltin(globalScope, name);
        if (globalValue !== undefined) {
            if (name === "is_ptr") {
                const nativePointerFunction = globalValue;
                functions[name] = function (this: unknown, ...args: Array<unknown>): boolean {
                    return evaluateHtml5PointerPredicate(nativePointerFunction, this, args[0]);
                };
            } else {
                functions[name] = globalValue;
            }
        }
    }

    if (builtinTableRef !== null) {
        _cachedRuntimeBuiltinTableRef = builtinTableRef;
        _cachedRuntimeBuiltinFunctions = functions;
    }

    return functions;
}
