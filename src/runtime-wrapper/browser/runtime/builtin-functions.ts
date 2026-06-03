type RuntimeBuiltinFunction = (...args: Array<unknown>) => unknown;

type RuntimeBuiltinFunctionMap = Record<string, RuntimeBuiltinFunction>;

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

/**
 * Resolves the callable builtin surface available to hot-reload patches.
 *
 * GameMaker HTML5 minifies many runtime functions and does not always expose
 * them on `window`, so the wrapper provides stable implementations for the
 * small builtin set emitted directly by live-reload patches and lets real
 * globals override those fallbacks when they are available.
 *
 * @param globalScope Browser global scope for the current runtime.
 * @returns A map of builtin function names to callables.
 */
export function resolveRuntimeBuiltinFunctions(globalScope: Record<string, unknown>): RuntimeBuiltinFunctionMap {
    const functions: RuntimeBuiltinFunctionMap = { ...FALLBACK_RUNTIME_FUNCTIONS };

    for (const name of Object.keys(FALLBACK_RUNTIME_FUNCTIONS)) {
        const globalValue = globalScope[name];
        if (typeof globalValue === "function") {
            functions[name] = globalValue as RuntimeBuiltinFunction;
        }
    }

    return functions;
}
