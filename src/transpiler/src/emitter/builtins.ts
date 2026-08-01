import { Core } from "@gmloop/core";

/**
 * Check if a given name is a known GameMaker builtin function.
 *
 * Delegates to {@link Core.loadManualFunctionNames}, which lazily loads and
 * caches the bundled identifier metadata on first access. No local cache is
 * needed because the Core layer already guarantees that repeated calls return
 * the same cached Set instance.
 */
export function isBuiltinFunction(name: string): boolean {
    return Core.loadManualFunctionNames().has(name);
}

/**
 * Emit a builtin function call as `name(arg1, arg2, …)`.
 *
 * All GameMaker builtin functions share the same call syntax, so a single
 * formatting function replaces the 1787 identical closures that were
 * previously allocated per-builtin.
 */
export function emitBuiltinFunction(name: string, args: ReadonlyArray<string>): string {
    return `${name}(${args.join(", ")})`;
}
