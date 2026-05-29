type RuntimeReadyGlobals = Record<string, unknown> & {
    g_pBuiltIn?: Record<string, unknown>;
    JSON_game?: {
        ScriptNames?: Array<string>;
        Scripts?: Array<unknown>;
    };
};

/**
 * Determine whether the GameMaker runtime is ready to accept websocket patches.
 *
 * Returns early if the cached `runtimeReady` flag is already true, otherwise
 * probes the global table for the canonical readiness signal:
 * `g_pBuiltIn` must be an object, `JSON_game` must expose array-typed
 * `ScriptNames` and `Scripts` entries, and `Scripts` must contain at least
 * one function-typed entry (the GameMaker runtime's initialization marker).
 *
 * @param runtimeReady The previously cached readiness state.
 * @returns True when the runtime is already known to be ready or is now detected as ready.
 */
export function resolveRuntimeReadiness(runtimeReady: boolean): boolean {
    if (runtimeReady) {
        return true;
    }

    const globals = globalThis as RuntimeReadyGlobals;
    const builtins = globals.g_pBuiltIn;
    if (typeof builtins !== "object" || builtins === null) {
        return false;
    }

    const jsonGame = globals.JSON_game;
    if (jsonGame === null || typeof jsonGame !== "object") {
        return false;
    }

    const { ScriptNames, Scripts } = jsonGame;
    if (!Array.isArray(ScriptNames) || !Array.isArray(Scripts)) {
        return false;
    }

    return Scripts.some((entry) => typeof entry === "function");
}

/**
 * Ensure the global `application_surface` property forwards to the GameMaker builtin table.
 */
export function ensureApplicationSurfaceAccessor(): void {
    const globals = globalThis as Record<string, unknown>;
    const builtins = globals.g_pBuiltIn;
    if (builtins === null || typeof builtins !== "object") {
        return;
    }

    if (Object.hasOwn(globals, "application_surface")) {
        return;
    }

    Object.defineProperty(globals, "application_surface", {
        configurable: true,
        enumerable: true,
        get() {
            const runtimeGlobals = globalThis as Record<string, unknown>;
            const runtimeBuiltins = runtimeGlobals.g_pBuiltIn as Record<string, unknown> | undefined;
            return runtimeBuiltins?.application_surface;
        },
        set(value) {
            const runtimeGlobals = globalThis as Record<string, unknown>;
            const runtimeBuiltins = runtimeGlobals.g_pBuiltIn as Record<string, unknown> | undefined;
            if (runtimeBuiltins) {
                runtimeBuiltins.application_surface = value;
            }
        }
    });
}
