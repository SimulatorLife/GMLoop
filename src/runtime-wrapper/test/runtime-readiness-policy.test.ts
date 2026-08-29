/**
 * Tests for
 * {@link import("../src/browser/websocket/runtime-readiness-policy.js").evaluateRuntimeReadiness}
 * and the supporting predicates.
 *
 * These tests exercise the policy in isolation by handing it fixture
 * snapshots rather than mutating `globalThis`. Keeping the policy
 * testable without the surrounding mechanism means the "what counts as
 * ready" rules can change without having to weave a fresh fixture
 * into `runtime-readiness.test.ts` for each tweak.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
    evaluateRuntimeReadiness,
    findScriptTables,
    findScriptTablesByShape,
    isRuntimeScriptName,
    isSafeRecord,
    RUNTIME_READINESS_GLOBAL_NAMES,
    RUNTIME_SCRIPT_NAME_PREFIXES,
    type RuntimeReadinessSnapshot
} from "../src/browser/websocket/runtime-readiness-policy.js";

function snapshot(globals: Record<string, unknown>): RuntimeReadinessSnapshot {
    return { globals };
}

function callableScript(..._args: Array<unknown>): unknown {
    return undefined;
}

function callableScriptFunction(): typeof callableScript {
    return callableScript;
}

void test("evaluateRuntimeReadiness returns ready when JSON_game contains a function entry", () => {
    const scripts = [callableScriptFunction(), "not-a-function"];
    const decision = evaluateRuntimeReadiness(
        snapshot({
            JSON_game: { ScriptNames: ["gml_Script_main"], Scripts: scripts }
        })
    );

    assert.equal(decision.state, "ready");
    if (decision.state === "ready") {
        assert.equal(decision.scripts, scripts);
    }
});

void test("evaluateRuntimeReadiness returns ready when the minified _a1 table contains a function entry", () => {
    const scripts = [callableScriptFunction()];
    const decision = evaluateRuntimeReadiness(
        snapshot({
            _a1: { _98: ["gml_Script_main"], _a8: scripts }
        })
    );

    assert.equal(decision.state, "ready");
    if (decision.state === "ready") {
        assert.equal(decision.scripts, scripts);
    }
});

void test("evaluateRuntimeReadiness returns not-ready with no-script-table when both well-known globals are missing", () => {
    const decision = evaluateRuntimeReadiness(snapshot({}));

    assert.deepEqual(decision, { state: "not-ready", reason: "no-script-table" });
});

void test("evaluateRuntimeReadiness returns not-ready with no-script-table when JSON_game is the wrong shape", () => {
    const decision = evaluateRuntimeReadiness(
        snapshot({
            JSON_game: { ScriptNames: "not-an-array", Scripts: [] }
        })
    );

    assert.deepEqual(decision, { state: "not-ready", reason: "no-script-table" });
});

void test("evaluateRuntimeReadiness returns not-ready with no-script-table when JSON_game is null", () => {
    const decision = evaluateRuntimeReadiness(snapshot({ JSON_game: null }));

    assert.deepEqual(decision, { state: "not-ready", reason: "no-script-table" });
});

void test("evaluateRuntimeReadiness returns not-ready with no-script-table when JSON_game is a primitive", () => {
    const decision = evaluateRuntimeReadiness(snapshot({ JSON_game: 42 }));

    assert.deepEqual(decision, { state: "not-ready", reason: "no-script-table" });
});

void test("evaluateRuntimeReadiness returns not-ready with no-script-table when _a1 is the wrong shape", () => {
    const decision = evaluateRuntimeReadiness(snapshot({ _a1: { _98: "wrong", _a8: [] } }));

    assert.deepEqual(decision, { state: "not-ready", reason: "no-script-table" });
});

void test("evaluateRuntimeReadiness returns not-ready with script-table-empty when only ScriptNames is non-empty", () => {
    const decision = evaluateRuntimeReadiness(
        snapshot({
            JSON_game: { ScriptNames: ["gml_Script_main"], Scripts: [] }
        })
    );

    assert.deepEqual(decision, { state: "not-ready", reason: "script-table-empty" });
});

void test("evaluateRuntimeReadiness returns not-ready with script-table-lacks-function when scripts are non-callable", () => {
    const decision = evaluateRuntimeReadiness(
        snapshot({
            JSON_game: {
                ScriptNames: ["gml_Script_main"],
                Scripts: ["not-a-function", { callable: false }, null]
            }
        })
    );

    assert.deepEqual(decision, { state: "not-ready", reason: "script-table-lacks-function" });
});

void test("evaluateRuntimeReadiness mines the script tables from a minified global when well-known names are absent", () => {
    const scripts = [callableScriptFunction()];
    const decision = evaluateRuntimeReadiness(
        snapshot({
            _c3: { _ba: ["gml_Script_placeholder"], _ca: scripts }
        })
    );

    assert.equal(decision.state, "ready");
    if (decision.state === "ready") {
        assert.equal(decision.scripts, scripts);
    }
});

void test("evaluateRuntimeReadiness prefers JSON_game over the minified _a1 fallback", () => {
    const jsonGameScripts = [callableScriptFunction()];
    const minifiedScripts = [callableScriptFunction()];
    const decision = evaluateRuntimeReadiness(
        snapshot({
            JSON_game: { ScriptNames: ["gml_Script_a"], Scripts: jsonGameScripts },
            _a1: { _98: ["gml_Script_b"], _a8: minifiedScripts }
        })
    );

    assert.equal(decision.state, "ready");
    if (decision.state === "ready") {
        assert.equal(decision.scripts, jsonGameScripts, "JSON_game should win when both tables are present");
    }
});

void test("evaluateRuntimeReadiness prefers _a1 over shape-based discovery", () => {
    const minifiedScripts = [callableScriptFunction()];
    const otherScripts = [callableScriptFunction()];
    const decision = evaluateRuntimeReadiness(
        snapshot({
            _a1: { _98: ["gml_Script_minified"], _a8: minifiedScripts },
            _c3: { _ba: ["gml_Script_other"], _ca: otherScripts }
        })
    );

    assert.equal(decision.state, "ready");
    if (decision.state === "ready") {
        assert.equal(decision.scripts, minifiedScripts, "_a1 should win over shape-based discovery");
    }
});

void test("evaluateRuntimeReadiness tolerates globals that throw on property access", () => {
    const throwingGlobal: Record<string | symbol, unknown> = {};
    Object.defineProperty(throwingGlobal, "self", {
        get() {
            throw new Error("Blocked a frame with origin from accessing a cross-origin frame.");
        },
        configurable: true
    });

    const decision = evaluateRuntimeReadiness(snapshot({ __cross_origin_window: throwingGlobal }));

    assert.deepEqual(decision, { state: "not-ready", reason: "no-script-table" });
});

void test("findScriptTables locates the script array behind JSON_game", () => {
    const scripts = [callableScriptFunction()];
    const result = findScriptTables(
        snapshot({
            JSON_game: { ScriptNames: ["gml_Script_main"], Scripts: scripts }
        })
    );

    assert.equal(result, scripts);
});

void test("findScriptTables locates the script array behind the minified _a1", () => {
    const scripts = [callableScriptFunction()];
    const result = findScriptTables(
        snapshot({
            _a1: { _98: ["gml_Script_main"], _a8: scripts }
        })
    );

    assert.equal(result, scripts);
});

void test("findScriptTables returns null when both well-known globals are missing", () => {
    assert.equal(findScriptTables(snapshot({})), null);
});

void test("findScriptTablesByShape returns the script array when paired with a script-name array", () => {
    const scripts = [callableScriptFunction()];
    const result = findScriptTablesByShape(
        snapshot({
            _c3: { _ba: ["gml_Script_placeholder"], _ca: scripts }
        })
    );

    assert.equal(result, scripts);
});

void test("findScriptTablesByShape returns null when no global pairs the script tables", () => {
    const result = findScriptTablesByShape(
        snapshot({
            someOtherGlobal: { unrelated: "value" }
        })
    );

    assert.equal(result, null);
});

void test("findScriptTablesByShape ignores globals whose own property reads throw", () => {
    const throwingGlobal: Record<string | symbol, unknown> = {};
    Object.defineProperty(throwingGlobal, "self", {
        get() {
            throw new Error("SecurityError");
        },
        configurable: true
    });

    const result = findScriptTablesByShape(snapshot({ __cross_origin_window: throwingGlobal }));

    assert.equal(result, null);
});

void test("isRuntimeScriptName accepts the gml_Script_ and gml_GlobalScript_ prefixes", () => {
    assert.equal(isRuntimeScriptName("gml_Script_main"), true);
    assert.equal(isRuntimeScriptName("gml_GlobalScript_helper"), true);
});

void test("isRuntimeScriptName rejects unrelated strings", () => {
    assert.equal(isRuntimeScriptName(""), false);
    assert.equal(isRuntimeScriptName("script_main"), false);
    assert.equal(isRuntimeScriptName("gml_script_main"), false);
    assert.equal(isRuntimeScriptName(undefined), false);
    assert.equal(isRuntimeScriptName(null), false);
    assert.equal(isRuntimeScriptName(123), false);
});

void test("isSafeRecord rejects null, primitives, and self-referential records", () => {
    assert.equal(isSafeRecord(null), false);
    assert.equal(isSafeRecord(undefined), false);
    assert.equal(isSafeRecord(42), false);
    assert.equal(isSafeRecord("string"), false);
    assert.equal(isSafeRecord({}), true);
});

void test("isSafeRecord rejects records whose self getter throws", () => {
    const crossOriginWindow: Record<string | symbol, unknown> = {};
    Object.defineProperty(crossOriginWindow, "self", {
        get() {
            throw new Error("cross-origin");
        },
        configurable: true
    });

    assert.equal(isSafeRecord(crossOriginWindow), false);
});

void test("RUNTIME_READINESS_GLOBAL_NAMES exposes the canonical probed globals", () => {
    assert.deepEqual([...RUNTIME_READINESS_GLOBAL_NAMES], ["g_pBuiltIn", "JSON_game", "_g8", "_a1"]);
});

void test("RUNTIME_SCRIPT_NAME_PREFIXES exposes the canonical script-name prefixes", () => {
    assert.deepEqual([...RUNTIME_SCRIPT_NAME_PREFIXES], ["gml_Script_", "gml_GlobalScript_"]);
});
