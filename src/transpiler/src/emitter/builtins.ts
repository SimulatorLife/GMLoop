import { Core } from "@gmloop/core";

/**
 * Lazy-loaded set of builtin function names.
 *
 * Loading GameMaker's manual metadata (~1.3 MB JSON, ~1787 functions) at
 * module initialization was causing ~7 MB of persistent heap allocation.
 * By deferring the load until first use and caching only the name Set
 * (not thousands of identical closure instances), we reduce peak memory
 * significantly while preserving the same public API.
 */
let cachedBuiltinNames: Set<string> | null = null;

function getBuiltinNames(): Set<string> {
    if (cachedBuiltinNames === null) {
        cachedBuiltinNames = Core.loadManualFunctionNames();
    }
    return cachedBuiltinNames;
}

/**
 * Generic builtin function emitter.
 *
 * All GameMaker builtin functions emit as simple calls: `name(args)`.
 * Rather than storing 1787 identical closure instances, we use a single
 * formatter and look up names on demand.
 */
function emitBuiltinCall(name: string, args: ReadonlyArray<string>): string {
    return `${name}(${args.join(", ")})`;
}

/**
 * Check if a given name is a known GameMaker builtin function.
 */
export function isBuiltinFunction(name: string): boolean {
    return getBuiltinNames().has(name);
}

/**
 * Emit a builtin function call.
 */
export function emitBuiltinFunction(name: string, args: ReadonlyArray<string>): string {
    return emitBuiltinCall(name, args);
}
