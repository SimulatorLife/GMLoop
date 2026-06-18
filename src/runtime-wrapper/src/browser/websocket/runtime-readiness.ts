type RuntimeReadyGlobals = Record<string, unknown> & {
    g_pBuiltIn?: Record<string, unknown>;
    JSON_game?: {
        ScriptNames?: Array<string>;
        Scripts?: Array<unknown>;
    };
    _a1?: {
        _98?: Array<string>;
        _a8?: Array<unknown>;
    };
    _g8?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") {
        return false;
    }
    try {
        const self = (value as any).self;
        if (self === value) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

function isRuntimeScriptName(value: unknown): value is string {
    return typeof value === "string" && (value.startsWith("gml_Script_") || value.startsWith("gml_GlobalScript_"));
}

function readGlobalProperty(globals: RuntimeReadyGlobals, propertyName: string): unknown {
    try {
        return globals[propertyName];
    } catch {
        return undefined;
    }
}

function resolveRuntimeScripts(globals: RuntimeReadyGlobals): Array<unknown> | null {
    const jsonGame = globals.JSON_game;
    if (jsonGame !== null && typeof jsonGame === "object") {
        const { ScriptNames, Scripts } = jsonGame;
        if (Array.isArray(ScriptNames) && Array.isArray(Scripts)) {
            return Scripts;
        }
    }

    const minifiedGameData = globals._a1;
    if (minifiedGameData !== null && typeof minifiedGameData === "object") {
        const { _98: scriptNames, _a8: scripts } = minifiedGameData;
        if (Array.isArray(scriptNames) && Array.isArray(scripts)) {
            return scripts;
        }
    }

    // Minified GameMaker HTML5 builds do not keep stable global or field names.
    // The live-reload client treats the script-name array plus function array as
    // the readiness signal because those tables are the patch binding target.
    for (const propertyName of Object.keys(globals)) {
        const candidate = readGlobalProperty(globals, propertyName);
        if (!isRecord(candidate)) {
            continue;
        }

        let hasScriptNames = false;
        let scripts: Array<unknown> | null = null;
        for (const propertyValue of Object.values(candidate)) {
            if (Array.isArray(propertyValue) && propertyValue.some(isRuntimeScriptName)) {
                hasScriptNames = true;
                continue;
            }

            if (Array.isArray(propertyValue) && propertyValue.some((entry) => typeof entry === "function")) {
                scripts = propertyValue;
            }
        }

        if (hasScriptNames && scripts !== null) {
            return scripts;
        }
    }

    return null;
}

/**
 * Determine whether the GameMaker runtime is ready to accept websocket patches.
 *
 * Returns early if the cached `runtimeReady` flag is already true, otherwise
 * probes the global table for the canonical readiness signal: the runtime must
 * expose a script-name array and a script-function array, and the script table
 * must contain at least one function-typed entry. The GameMaker HTML5 minifier
 * changes object names between builds and may omit builtin globals, so readiness
 * is intentionally tied to the patch binding tables rather than fixed symbols.
 *
 * @param runtimeReady The previously cached readiness state.
 * @returns True when the runtime is already known to be ready or is now detected as ready.
 */
export function resolveRuntimeReadiness(runtimeReady: boolean): boolean {
    if (runtimeReady) {
        return true;
    }

    const globals = globalThis as RuntimeReadyGlobals;
    const scripts = resolveRuntimeScripts(globals);
    if (scripts === null) {
        return false;
    }

    return scripts.some((entry) => typeof entry === "function");
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
