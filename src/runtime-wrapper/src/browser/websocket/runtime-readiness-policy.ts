/**
 * @gmloop/runtime-wrapper — Runtime Readiness Policy
 *
 * Pure policy helpers for deciding whether a GameMaker runtime snapshot is
 * ready to accept websocket patches. Operational side effects remain in
 * `runtime-readiness.ts`.
 */

export type RuntimeReadinessSnapshot = {
    readonly globals: Readonly<Record<string, unknown>>;
};

export type RuntimeReadinessNotReadyReason = "no-script-table" | "script-table-empty" | "script-table-lacks-function";

export type RuntimeReadinessDecision =
    | {
          readonly state: "ready";
          readonly scripts: ReadonlyArray<unknown>;
      }
    | {
          readonly state: "not-ready";
          readonly reason: RuntimeReadinessNotReadyReason;
      };

export const RUNTIME_READINESS_GLOBAL_NAMES: ReadonlyArray<string> = Object.freeze([
    "g_pBuiltIn",
    "JSON_game",
    "_g8",
    "_a1"
]);

export const RUNTIME_SCRIPT_NAME_PREFIXES: ReadonlyArray<string> = Object.freeze(["gml_Script_", "gml_GlobalScript_"]);

export function isRuntimeScriptName(value: unknown): value is string {
    if (typeof value !== "string") {
        return false;
    }

    for (const prefix of RUNTIME_SCRIPT_NAME_PREFIXES) {
        if (value.startsWith(prefix)) {
            return true;
        }
    }

    return false;
}

type AuthoritativeScriptTables = Readonly<{
    ScriptNames: Array<string>;
    Scripts: Array<unknown>;
}>;

function tryReadGlobalProperty(globals: Readonly<Record<string, unknown>>, propertyName: string): unknown {
    try {
        return globals[propertyName];
    } catch {
        return undefined;
    }
}

function tryReadAuthoritativeScriptTables(
    candidate: unknown,
    namesField: "ScriptNames" | "_98",
    scriptsField: "Scripts" | "_a8"
): AuthoritativeScriptTables | null {
    if (candidate === null || typeof candidate !== "object") {
        return null;
    }

    const record = candidate as Record<string, unknown>;
    const scriptNames = record[namesField];
    const scripts = record[scriptsField];
    if (!Array.isArray(scriptNames) || !Array.isArray(scripts)) {
        return null;
    }

    return Object.freeze({ ScriptNames: scriptNames, Scripts: scripts });
}

export function findScriptTables(snapshot: RuntimeReadinessSnapshot): ReadonlyArray<unknown> | null {
    const fromJsonGame = tryReadAuthoritativeScriptTables(
        tryReadGlobalProperty(snapshot.globals, "JSON_game"),
        "ScriptNames",
        "Scripts"
    );
    if (fromJsonGame !== null) {
        return fromJsonGame.Scripts;
    }

    const fromMinified = tryReadAuthoritativeScriptTables(tryReadGlobalProperty(snapshot.globals, "_a1"), "_98", "_a8");
    if (fromMinified !== null) {
        return fromMinified.Scripts;
    }

    return findScriptTablesByShape(snapshot);
}

function findScriptArrayInCandidate(candidate: Record<string, unknown>): ReadonlyArray<unknown> | null {
    let hasScriptNames = false;
    let scripts: Array<unknown> | null = null;

    for (const propertyValue of Object.values(candidate)) {
        if (!Array.isArray(propertyValue)) {
            continue;
        }

        if (propertyValue.some((entry) => isRuntimeScriptName(entry))) {
            hasScriptNames = true;
            continue;
        }

        if (propertyValue.some((entry) => typeof entry === "function")) {
            scripts = propertyValue;
        }
    }

    return hasScriptNames ? scripts : null;
}

export function findScriptTablesByShape(snapshot: RuntimeReadinessSnapshot): ReadonlyArray<unknown> | null {
    for (const propertyName of Object.keys(snapshot.globals)) {
        const candidate = tryReadGlobalProperty(snapshot.globals, propertyName);
        if (!isSafeRecord(candidate)) {
            continue;
        }

        const scripts = findScriptArrayInCandidate(candidate);
        if (scripts !== null) {
            return scripts;
        }
    }

    return null;
}

export function isSafeRecord(value: unknown): value is Record<string, unknown> {
    if (value === null || typeof value !== "object") {
        return false;
    }

    try {
        const self = (value as { self?: unknown }).self;
        if (self === value) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function evaluateRuntimeReadiness(snapshot: RuntimeReadinessSnapshot): RuntimeReadinessDecision {
    const scripts = findScriptTables(snapshot);
    if (scripts === null) {
        return { state: "not-ready", reason: "no-script-table" };
    }

    if (scripts.length === 0) {
        return { state: "not-ready", reason: "script-table-empty" };
    }

    const hasCallableScript = scripts.some((entry) => typeof entry === "function");
    if (!hasCallableScript) {
        return { state: "not-ready", reason: "script-table-lacks-function" };
    }

    return { state: "ready", scripts };
}
