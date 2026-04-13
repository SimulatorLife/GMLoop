import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeWrapper } from "../index.js";
import type { PatchHistoryReader, PatchUndoController } from "../src/runtime/types.js";

void test("runtime wrapper exposes timing helpers through the dedicated timing namespace", () => {
    assert.strictEqual(typeof RuntimeWrapper.Timing.getHighResolutionTime, "function");
    assert.strictEqual(typeof RuntimeWrapper.Timing.measureDuration, "function");
    assert.ok(!("getHighResolutionTime" in RuntimeWrapper));
    assert.ok(!("measureDuration" in RuntimeWrapper));
});

void test("createRuntimeWrapper returns hot wrapper state", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.ok(wrapper.state);
    assert.strictEqual(typeof wrapper.applyPatch, "function");
    assert.strictEqual(typeof wrapper.undo, "function");
});

void test("runtime wrapper satisfies patch history interfaces", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const historyReader: PatchHistoryReader = wrapper;
    const undoController: PatchUndoController = wrapper;

    assert.strictEqual(typeof historyReader.getPatchHistory, "function");
    assert.strictEqual(typeof historyReader.getPatchById, "function");
    assert.strictEqual(typeof historyReader.getPatchesByKind, "function");
    assert.strictEqual(typeof undoController.undo, "function");
    assert.strictEqual(typeof undoController.getUndoStackSize, "function");
});

void test("applyPatch validates its input", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch(null), { name: "TypeError" });
});

void test("applyPatch requires kind field", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch({ id: "test" }), {
        message: /Patch must have a 'kind' field/
    });
});

void test("applyPatch requires id field", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch({ kind: "script" }), {
        message: /Patch must have an 'id' field/
    });
});

void test("applyPatch handles script patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "script",
        id: "script:test_func",
        js_body: "return args[0] + args[1];"
    };

    const result = wrapper.applyPatch(patch);
    assert.ok(result.success);
    assert.strictEqual(result.version, 1);
    assert.strictEqual(wrapper.getVersion(), 1);
    assert.ok(wrapper.hasScript("script:test_func"));
});

void test("script patch function executes correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "script",
        id: "script:add",
        js_body: "return args[0] + args[1];"
    };

    wrapper.applyPatch(patch);
    const fn = wrapper.getScript("script:add");
    assert.ok(fn);
    const result = fn(null, null, [5, 3]) as number;
    assert.strictEqual(result, 8);
});

void test("script patch prefers builtin constants over conflicting globals", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const globalScope = globalThis as Record<string, unknown>;
    const savedColor = globalScope.c_white;

    try {
        globalScope.c_white = "rgb(255,255,255)";

        wrapper.applyPatch({
            kind: "script",
            id: "script:color_constant",
            js_body: "return typeof c_white;"
        });

        const fn = wrapper.getScript("script:color_constant");
        assert.ok(fn);
        const result = fn(null, null, []) as string;
        assert.strictEqual(result, "number");
    } finally {
        if (savedColor === undefined) {
            delete globalScope.c_white;
        } else {
            globalScope.c_white = savedColor;
        }
    }
});

void test("script patch resolves sprite constants through sprite manager", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const globalScope = globalThis as Record<string, unknown>;
    const savedSpriteManager = globalScope.g_pSpriteManager;
    const savedValue = globalScope.sArm;

    try {
        globalScope.sArm = undefined;
        globalScope.g_pSpriteManager = {
            Sprite_Find(name: string) {
                return name === "sArm" ? 7 : -1;
            }
        };

        wrapper.applyPatch({
            kind: "script",
            id: "script:sprite_constant",
            js_body: "return sArm;"
        });

        const fn = wrapper.getScript("script:sprite_constant");
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        assert.strictEqual(result, 7);
    } finally {
        if (savedSpriteManager === undefined) {
            delete globalScope.g_pSpriteManager;
        } else {
            globalScope.g_pSpriteManager = savedSpriteManager;
        }

        if (savedValue === undefined) {
            delete globalScope.sArm;
        } else {
            globalScope.sArm = savedValue;
        }
    }
});

void test("script patch resolves sprite constants via JSON_game metadata", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const globalScope = globalThis as Record<string, unknown>;
    const savedJson = globalScope.JSON_game;
    const savedArm = globalScope.sArm;

    try {
        globalScope.JSON_game = { Sprites: [{ pName: "sArm" }] };
        delete globalScope.sArm;

        wrapper.applyPatch({
            kind: "script",
            id: "script:sprite_constant_json",
            js_body: "return sArm;"
        });

        const fn = wrapper.getScript("script:sprite_constant_json");
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        assert.strictEqual(result, 0);
    } finally {
        if (savedJson === undefined) {
            delete globalScope.JSON_game;
        } else {
            globalScope.JSON_game = savedJson;
        }

        if (savedArm === undefined) {
            delete globalScope.sArm;
        } else {
            globalScope.sArm = savedArm;
        }
    }
});

void test("script patch resolves global constants via globalThis", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const globalScope = globalThis as Record<string, unknown>;
    const previousValue = globalScope.sArm;

    try {
        globalScope.sArm = { id: 321 };

        wrapper.applyPatch({
            kind: "script",
            id: "script:global_sprite",
            js_body: "return sArm.id;"
        });

        const fn = wrapper.getScript("script:global_sprite");
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        assert.strictEqual(result, 321);
    } finally {
        if (previousValue === undefined) {
            delete globalScope.sArm;
        } else {
            globalScope.sArm = previousValue;
        }
    }
});

void test("script patch resolves JSON_game script entries when globals are missing", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const globals = globalThis as Record<string, unknown>;
    const savedJson = globals.JSON_game;
    const savedFunction = globals.twojointik;

    try {
        delete globals.twojointik;
        globals.JSON_game = {
            ScriptNames: ["gml_Script_twojointik"],
            Scripts: [() => 777]
        };

        wrapper.applyPatch({
            kind: "script",
            id: "script:json_script_lookup",
            js_body: "return twojointik();"
        });

        const fn = wrapper.getScript("script:json_script_lookup");
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        assert.strictEqual(result, 777);
    } finally {
        if (savedJson === undefined) {
            delete globals.JSON_game;
        } else {
            globals.JSON_game = savedJson;
        }

        if (savedFunction === undefined) {
            delete globals.twojointik;
        } else {
            globals.twojointik = savedFunction;
        }
    }
});

void test("applyPatch handles event patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "event",
        id: "obj_player#Step",
        js_body: "return this.x + 1;"
    };

    const result = wrapper.applyPatch(patch);
    assert.ok(result.success);
    assert.strictEqual(result.version, 1);
    assert.ok(wrapper.hasEvent("obj_player#Step"));
});

void test("event patch function executes correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "event",
        id: "obj_test#Create",
        js_body: "this.initialized = true; return true;"
    };

    wrapper.applyPatch(patch);
    const fn = wrapper.getEvent("obj_test#Create");
    assert.ok(fn);
    const context = { initialized: false };
    const result = fn.call(context);
    assert.strictEqual(result, true);
    assert.strictEqual(context.initialized, true);
});

void test("event patch receives instance context and arguments", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "event",
        id: "obj_test#Async",
        this_name: "self",
        js_args: "eventData",
        js_body: "self.touched = eventData.value; return `${self.name}:${eventData.value}`;"
    };

    wrapper.applyPatch(patch);
    const fn = wrapper.getEvent("obj_test#Async");
    assert.ok(fn);
    const context = { name: "player", touched: null };
    const result = fn.call(context, { value: 99 });

    assert.strictEqual(result, "player:99");
    assert.strictEqual(context.touched, 99);
});

void test("applyPatch rejects unsupported patch kinds", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch({ kind: "unknown", id: "test" }), {
        message: /Unsupported patch kind: unknown/
    });
});

void test("applyPatch requires js_body for script patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch({ kind: "script", id: "test" }), {
        message: /Script patch must have a 'js_body' string/
    });
});

void test("applyPatch requires js_body for event patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch({ kind: "event", id: "test" }), {
        message: /Event patch must have a 'js_body' string/
    });
});

void test("applyPatch increments version on each patch", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.strictEqual(wrapper.getVersion(), 0);

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });
    assert.strictEqual(wrapper.getVersion(), 1);

    wrapper.applyPatch({
        kind: "script",
        id: "script:b",
        js_body: "return 2;"
    });
    assert.strictEqual(wrapper.getVersion(), 2);
});

void test("applyPatch calls onPatchApplied callback", () => {
    let callbackPatch = null;
    let callbackVersion = null;

    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onPatchApplied: (patch, version) => {
            callbackPatch = patch;
            callbackVersion = version;
        }
    });

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return 42;"
    };

    wrapper.applyPatch(patch);
    assert.strictEqual(callbackPatch, patch);
    assert.strictEqual(callbackVersion, 1);
});

void test("undo reverts last patch", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    };

    wrapper.applyPatch(patch);
    assert.ok(wrapper.hasScript("script:test"));

    const result = wrapper.undo();
    assert.ok(result.success);
    assert.ok(!wrapper.hasScript("script:test"));
});

void test("undo handles multiple patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:b",
        js_body: "return 2;"
    });

    assert.ok(wrapper.hasScript("script:a"));
    assert.ok(wrapper.hasScript("script:b"));

    wrapper.undo();
    assert.ok(wrapper.hasScript("script:a"));
    assert.ok(!wrapper.hasScript("script:b"));

    wrapper.undo();
    assert.ok(!wrapper.hasScript("script:a"));
});

void test("undo fails when nothing to undo", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const result = wrapper.undo();
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("Nothing to undo"));
});

void test("undo restores previous version of patched script", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    const fn1 = wrapper.getScript("script:test");
    assert.ok(fn1);
    assert.strictEqual(fn1(null, null, []) as number, 1);

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 2;"
    });

    const fn2 = wrapper.getScript("script:test");
    assert.ok(fn2);
    assert.strictEqual(fn2(null, null, []) as number, 2);

    wrapper.undo();
    const fn3 = wrapper.getScript("script:test");
    assert.ok(fn3);
    assert.strictEqual(fn3(null, null, []) as number, 1);
    assert.strictEqual(fn3, fn1);
});

void test("getPatchHistory returns diagnostic information", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.strictEqual(typeof wrapper.getPatchHistory, "function");

    const history = wrapper.getPatchHistory();
    assert.ok(Array.isArray(history));
    assert.strictEqual(history.length, 0);
});

void test("getPatchHistory tracks applied patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].patch.kind, "script");
    assert.strictEqual(history[0].patch.id, "script:test");
    assert.strictEqual(history[0].version, 1);
    assert.strictEqual(history[0].action, "apply");
    assert.ok(typeof history[0].timestamp === "number");
});

void test("getPatchHistory tracks multiple patches in order", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_test#Create",
        js_body: "this.x = 0;"
    });

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].patch.id, "script:a");
    assert.strictEqual(history[1].patch.id, "obj_test#Create");
    assert.ok(history[0].timestamp <= history[1].timestamp);
});

void test("getPatchHistory tracks undo operations", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    wrapper.undo();

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].action, "apply");
    assert.strictEqual(history[1].action, "undo");
    assert.strictEqual(history[1].patch.id, "script:test");
});

void test("getRegistrySnapshot returns diagnostic information", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.strictEqual(typeof wrapper.getRegistrySnapshot, "function");

    const snapshot = wrapper.getRegistrySnapshot();
    assert.strictEqual(typeof snapshot, "object");
    assert.strictEqual(snapshot.version, 0);
    assert.strictEqual(snapshot.scriptCount, 0);
    assert.strictEqual(snapshot.eventCount, 0);
    assert.strictEqual(snapshot.closureCount, 0);
});

void test("getRegistrySnapshot reflects current registry state", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:b",
        js_body: "return 2;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_test#Create",
        js_body: "this.x = 0;"
    });

    const snapshot = wrapper.getRegistrySnapshot();
    assert.strictEqual(snapshot.version, 3);
    assert.strictEqual(snapshot.scriptCount, 2);
    assert.strictEqual(snapshot.eventCount, 1);
    assert.ok(snapshot.scripts.includes("script:a"));
    assert.ok(snapshot.scripts.includes("script:b"));
    assert.ok(snapshot.events.includes("obj_test#Create"));
});

void test("getPatchStats returns diagnostic information", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.strictEqual(typeof wrapper.getPatchStats, "function");

    const stats = wrapper.getPatchStats();
    assert.strictEqual(typeof stats, "object");
    assert.strictEqual(stats.totalPatches, 0);
    assert.strictEqual(stats.appliedPatches, 0);
    assert.strictEqual(stats.undonePatches, 0);
    assert.strictEqual(stats.rolledBackPatches, 0);
});

void test("getPatchStats calculates statistics correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:b",
        js_body: "return 2;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_test#Create",
        js_body: "this.x = 0;"
    });

    wrapper.undo();

    const stats = wrapper.getPatchStats();
    assert.strictEqual(stats.totalPatches, 4);
    assert.strictEqual(stats.appliedPatches, 3);
    assert.strictEqual(stats.undonePatches, 1);
    assert.strictEqual(stats.rolledBackPatches, 0);
    assert.strictEqual(stats.scriptPatches, 2);
    assert.strictEqual(stats.eventPatches, 2);
    assert.strictEqual(stats.uniqueIds, 3);
});

void test("getPatchStats tracks unique patch IDs correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 2;"
    });

    const stats = wrapper.getPatchStats();
    assert.strictEqual(stats.totalPatches, 2);
    assert.strictEqual(stats.uniqueIds, 1);
});

void test("getPatchStats counts rollback operations", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onPatchApplied: () => {
            throw new Error("post-apply failure");
        }
    });

    const patch = {
        kind: "script",
        id: "script:rollback",
        js_body: "return 1;"
    };

    const result = wrapper.trySafeApply(patch);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.rolledBack, true);
    assert.ok(result.message?.includes("rolled back"));
    assert.strictEqual(wrapper.hasScript("script:rollback"), false);
    assert.strictEqual(wrapper.getVersion(), 0);

    const stats = wrapper.getPatchStats();
    assert.strictEqual(stats.totalPatches, 2);
    assert.strictEqual(stats.appliedPatches, 1);
    assert.strictEqual(stats.rolledBackPatches, 1);
    assert.strictEqual(stats.scriptPatches, 2);
});

void test("trySafeApply validates patch in shadow registry", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.strictEqual(typeof wrapper.trySafeApply, "function");

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return args[0] * 2;"
    };

    const result = wrapper.trySafeApply(patch);
    assert.ok(result.success);
    assert.strictEqual(result.version, 1);
    assert.strictEqual(result.rolledBack, false);
});

void test("trySafeApply rejects invalid patch in shadow validation", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: ""
    };

    const result = wrapper.trySafeApply(patch);
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.message.includes("Shadow validation failed"));
});

void test("trySafeApply applies valid patch to actual registry", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patch = {
        kind: "script",
        id: "script:multiply",
        js_body: "return args[0] * args[1];"
    };

    const result = wrapper.trySafeApply(patch);
    assert.ok(result.success);

    const fn = wrapper.getScript("script:multiply");
    assert.ok(fn);
    assert.strictEqual(fn(null, null, [3, 4]) as number, 12);
});

void test("trySafeApply supports custom validation callback", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    };

    const onValidate = (p) => {
        return p.id !== "script:forbidden";
    };

    const result = wrapper.trySafeApply(patch, onValidate);
    assert.ok(result.success);
});

void test("trySafeApply rejects patch when custom validation fails", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patch = {
        kind: "script",
        id: "script:forbidden",
        js_body: "return 1;"
    };

    const onValidate = (p) => {
        return p.id !== "script:forbidden";
    };

    const result = wrapper.trySafeApply(patch, onValidate);
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("Custom validation"));
    assert.ok(!wrapper.hasScript("script:forbidden"));
});

void test("trySafeApply handles custom validation errors", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    };

    const onValidate = () => {
        throw new Error("Validation error");
    };

    const result = wrapper.trySafeApply(patch, onValidate);
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("Custom validation failed"));
    assert.strictEqual(result.error, "Validation error");
});

void test("trySafeApply catches syntax errors in shadow validation", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:existing",
        js_body: "return 1;"
    });

    const initialVersion = wrapper.getVersion();

    const badPatch = {
        kind: "script",
        id: "script:bad",
        js_body: "return {{{{{ invalid syntax"
    };

    const result = wrapper.trySafeApply(badPatch);
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.message.includes("Shadow validation failed"));
    assert.ok(!wrapper.hasScript("script:bad"));
    assert.ok(wrapper.hasScript("script:existing"));
    assert.strictEqual(wrapper.getVersion(), initialVersion);
});

void test("trySafeApply does not record shadow validation failures in history", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const badPatch = {
        kind: "script",
        id: "script:bad",
        js_body: "return }}} invalid"
    };

    wrapper.trySafeApply(badPatch);

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 0);
});

void test("validateBeforeApply option enables shadow validation", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        validateBeforeApply: true
    });

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: "return args[0] + 1;"
    };

    const result = wrapper.applyPatch(patch);
    assert.ok(result.success);
    assert.ok(wrapper.hasScript("script:test"));
});

void test("validateBeforeApply rejects invalid patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        validateBeforeApply: true
    });

    const patch = {
        kind: "script",
        id: "script:test",
        js_body: ""
    };

    assert.throws(() => wrapper.applyPatch(patch), {
        message: /Patch validation failed/
    });
});

void test("trySafeApply maintains registry state after rollback", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_test#Create",
        js_body: "this.x = 0;"
    });

    const beforeSnapshot = wrapper.getRegistrySnapshot();

    const badPatch = {
        kind: "script",
        id: "script:bad",
        js_body: "return syntax error;"
    };

    wrapper.trySafeApply(badPatch);

    const afterSnapshot = wrapper.getRegistrySnapshot();

    assert.strictEqual(afterSnapshot.scriptCount, beforeSnapshot.scriptCount);
    assert.strictEqual(afterSnapshot.eventCount, beforeSnapshot.eventCount);
    assert.strictEqual(afterSnapshot.version, beforeSnapshot.version);
});

void test("trySafeApply catches event syntax errors in shadow validation", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "event",
        id: "obj_player#Step",
        js_body: "this.x += 1;"
    });

    const badEventPatch = {
        kind: "event",
        id: "obj_enemy#Step",
        js_body: "return {{ invalid"
    };

    const result = wrapper.trySafeApply(badEventPatch);
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("Shadow validation failed"));
    assert.ok(!wrapper.hasEvent("obj_enemy#Step"));
    assert.ok(wrapper.hasEvent("obj_player#Step"));
});

void test("applyPatch handles closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "closure",
        id: "closure:make_counter",
        js_body: "let count = 0; return () => ++count;"
    };

    const result = wrapper.applyPatch(patch);
    assert.ok(result.success);
    assert.strictEqual(result.version, 1);
    assert.strictEqual(wrapper.getVersion(), 1);
    assert.ok(wrapper.hasClosure("closure:make_counter"));
});

void test("closure patch function executes correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "closure",
        id: "closure:multiplier",
        js_body: "const factor = args[0]; return (x) => x * factor;"
    };

    wrapper.applyPatch(patch);
    const fn = wrapper.getClosure("closure:multiplier");
    assert.ok(fn);
    const multiply = fn(5) as (value: number) => number;
    assert.strictEqual(multiply(3), 15);
    assert.strictEqual(multiply(7), 35);
});

void test("applyPatch requires js_body for closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    assert.throws(() => wrapper.applyPatch({ kind: "closure", id: "test" }), {
        message: /Closure patch must have a 'js_body' string/
    });
});

void test("undo reverts closure patch", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const patch = {
        kind: "closure",
        id: "closure:test",
        js_body: "return () => 42;"
    };

    wrapper.applyPatch(patch);
    assert.ok(wrapper.hasClosure("closure:test"));

    const result = wrapper.undo();
    assert.ok(result.success);
    assert.ok(!wrapper.hasClosure("closure:test"));
});

void test("undo restores previous version of patched closure", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:test",
        js_body: "return () => 1;"
    });

    const fn1 = wrapper.getClosure("closure:test");
    assert.ok(fn1);
    const firstClosure = fn1() as () => number;
    assert.strictEqual(firstClosure(), 1);

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:test",
        js_body: "return () => 2;"
    });

    const fn2 = wrapper.getClosure("closure:test");
    assert.ok(fn2);
    const secondClosure = fn2() as () => number;
    assert.strictEqual(secondClosure(), 2);

    wrapper.undo();
    const fn3 = wrapper.getClosure("closure:test");
    assert.ok(fn3);
    const restoredClosure = fn3() as () => number;
    assert.strictEqual(restoredClosure(), 1);
    assert.strictEqual(fn3, fn1);
});

void test("getPatchHistory tracks closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:test",
        js_body: "return () => 1;"
    });

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].patch.kind, "closure");
    assert.strictEqual(history[0].patch.id, "closure:test");
    assert.strictEqual(history[0].version, 1);
    assert.strictEqual(history[0].action, "apply");
});

void test("getRegistrySnapshot includes closure count", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:b",
        js_body: "return () => 2;"
    });

    const snapshot = wrapper.getRegistrySnapshot();
    assert.strictEqual(snapshot.version, 2);
    assert.strictEqual(snapshot.scriptCount, 1);
    assert.strictEqual(snapshot.closureCount, 1);
    assert.ok(snapshot.scripts.includes("script:a"));
    assert.ok(snapshot.closures.includes("closure:b"));
});

void test("getPatchStats tracks closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:b",
        js_body: "return () => 2;"
    });

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:c",
        js_body: "return () => 3;"
    });

    const stats = wrapper.getPatchStats();
    assert.strictEqual(stats.totalPatches, 3);
    assert.strictEqual(stats.scriptPatches, 1);
    assert.strictEqual(stats.closurePatches, 2);
    assert.strictEqual(stats.uniqueIds, 3);
});

void test("trySafeApply validates closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patch = {
        kind: "closure",
        id: "closure:test",
        js_body: "return (x) => x * 2;"
    };

    const result = wrapper.trySafeApply(patch);
    assert.ok(result.success);
    assert.strictEqual(result.version, 1);
    assert.strictEqual(result.rolledBack, false);

    const fn = wrapper.getClosure("closure:test");
    assert.ok(fn);
    const closure = fn() as (value: number) => number;
    assert.strictEqual(closure(5), 10);
});

void test("trySafeApply catches closure syntax errors", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const badPatch = {
        kind: "closure",
        id: "closure:bad",
        js_body: "return {{ invalid syntax"
    };

    const result = wrapper.trySafeApply(badPatch);
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes("Shadow validation failed"));
    assert.ok(!wrapper.hasClosure("closure:bad"));
});

void test("validateBeforeApply validates closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        validateBeforeApply: true
    });

    const patch = {
        kind: "closure",
        id: "closure:test",
        js_body: "return () => 42;"
    };

    const result = wrapper.applyPatch(patch);
    assert.ok(result.success);
    assert.ok(wrapper.hasClosure("closure:test"));
});

void test("validateBeforeApply rejects invalid closure patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        validateBeforeApply: true
    });

    const patch = {
        kind: "closure",
        id: "closure:test",
        js_body: ""
    };

    assert.throws(() => wrapper.applyPatch(patch), {
        message: /Patch validation failed/
    });
});

void test("getPatchHistory includes duration for patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:timed",
        js_body: "return 42;"
    });

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 1);
    assert.ok(history[0].durationMs !== undefined);
    assert.ok(typeof history[0].durationMs === "number");
    assert.ok(history[0].durationMs >= 0);
});

void test("getPatchStats includes timing metrics", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:b",
        js_body: "return 2;"
    });

    const stats = wrapper.getPatchStats();
    assert.ok(stats.totalDurationMs !== undefined);
    assert.ok(stats.averagePatchDurationMs !== undefined);
    assert.ok(stats.fastestPatchMs !== undefined);
    assert.ok(stats.slowestPatchMs !== undefined);
    assert.ok(stats.totalDurationMs >= 0);
    assert.ok(stats.averagePatchDurationMs >= 0);
    assert.ok(stats.fastestPatchMs >= 0);
    assert.ok(stats.slowestPatchMs >= 0);
    assert.ok(stats.fastestPatchMs <= stats.slowestPatchMs);
});

void test("clearRegistry removes all patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test1",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_test#Create",
        js_body: "this.x = 0;"
    });

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:test",
        js_body: "return () => 42;"
    });

    assert.ok(wrapper.hasScript("script:test1"));
    assert.ok(wrapper.hasEvent("obj_test#Create"));
    assert.ok(wrapper.hasClosure("closure:test"));

    const versionBeforeClear = wrapper.getVersion();
    wrapper.clearRegistry();

    assert.ok(!wrapper.hasScript("script:test1"));
    assert.ok(!wrapper.hasEvent("obj_test#Create"));
    assert.ok(!wrapper.hasClosure("closure:test"));
    assert.strictEqual(wrapper.getVersion(), versionBeforeClear + 1);

    const snapshot = wrapper.getRegistrySnapshot();
    assert.strictEqual(snapshot.scriptCount, 0);
    assert.strictEqual(snapshot.eventCount, 0);
    assert.strictEqual(snapshot.closureCount, 0);
});

void test("clearRegistry clears undo stack", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    wrapper.clearRegistry();

    const undoResult = wrapper.undo();
    assert.strictEqual(undoResult.success, false);
    assert.strictEqual(undoResult.message, "Nothing to undo");
});

void test("applyPatchBatch applies multiple patches atomically", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patches = [
        { kind: "script", id: "script:batch1", js_body: "return 1;" },
        { kind: "script", id: "script:batch2", js_body: "return 2;" },
        { kind: "event", id: "obj_test#Create", js_body: "this.x = 0;" }
    ];

    const result = wrapper.applyPatchBatch(patches);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.appliedCount, 3);
    assert.strictEqual(result.rolledBack, false);
    assert.ok(wrapper.hasScript("script:batch1"));
    assert.ok(wrapper.hasScript("script:batch2"));
    assert.ok(wrapper.hasEvent("obj_test#Create"));
});

void test("applyPatchBatch handles empty array", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const initialVersion = wrapper.getVersion();

    const result = wrapper.applyPatchBatch([]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.appliedCount, 0);
    assert.strictEqual(result.rolledBack, false);
    assert.strictEqual(result.version, initialVersion);
});

void test("applyPatchBatch validates input is array", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    assert.throws(() => wrapper.applyPatchBatch(null as unknown as Array<unknown>), {
        message: /applyPatchBatch expects an array/
    });
});

void test("applyPatchBatch rolls back on failure", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patches = [
        { kind: "script", id: "script:good1", js_body: "return 1;" },
        { kind: "script", id: "script:good2", js_body: "return 2;" },
        { kind: "script", id: "script:bad", js_body: "return {{ invalid" }
    ];

    const result = wrapper.applyPatchBatch(patches);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.rolledBack, true);
    assert.strictEqual(result.failedIndex, 2);
    assert.ok(!wrapper.hasScript("script:good1"));
    assert.ok(!wrapper.hasScript("script:good2"));
    assert.ok(!wrapper.hasScript("script:bad"));
});

void test("applyPatchBatch validates all patches before applying", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        validateBeforeApply: true
    });

    const patches = [
        { kind: "script", id: "script:first", js_body: "return 1;" },
        { kind: "script", id: "script:bad", js_body: "return {{ invalid" },
        { kind: "script", id: "script:third", js_body: "return 3;" }
    ];

    const result = wrapper.applyPatchBatch(patches);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.rolledBack, false);
    assert.strictEqual(result.appliedCount, 0);
    assert.strictEqual(result.failedIndex, 1);
    assert.ok(!wrapper.hasScript("script:first"));
    assert.ok(!wrapper.hasScript("script:third"));
});

void test("applyPatchBatch increments version correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    const initialVersion = wrapper.getVersion();

    const patches = [
        { kind: "script", id: "script:v1", js_body: "return 1;" },
        { kind: "script", id: "script:v2", js_body: "return 2;" }
    ];

    const result = wrapper.applyPatchBatch(patches);

    assert.strictEqual(result.success, true);
    assert.strictEqual(wrapper.getVersion(), initialVersion + 2);
});

void test("applyPatchBatch calls onPatchApplied for each patch", () => {
    const appliedPatches: Array<{ id: string; version: number }> = [];

    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onPatchApplied: (patch, version) => {
            appliedPatches.push({ id: patch.id, version });
        }
    });

    const patches = [
        { kind: "script", id: "script:cb1", js_body: "return 1;" },
        { kind: "script", id: "script:cb2", js_body: "return 2;" }
    ];

    wrapper.applyPatchBatch(patches);

    assert.strictEqual(appliedPatches.length, 2);
    assert.strictEqual(appliedPatches[0].id, "script:cb1");
    assert.strictEqual(appliedPatches[1].id, "script:cb2");
});

void test("applyPatchBatch records batch operation in history", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patches = [
        { kind: "script", id: "script:h1", js_body: "return 1;" },
        { kind: "script", id: "script:h2", js_body: "return 2;" }
    ];

    wrapper.applyPatchBatch(patches);

    const history = wrapper.getPatchHistory();
    assert.strictEqual(history.length, 3);
    assert.strictEqual(history[0].patch.id, "script:h1");
    assert.strictEqual(history[1].patch.id, "script:h2");
    assert.strictEqual(history[2].patch.id, "batch:2_patches");
    assert.ok(history[2].durationMs !== undefined);
});

void test("applyPatchBatch supports mixed patch types", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patches = [
        { kind: "script", id: "script:mixed", js_body: "return 1;" },
        { kind: "event", id: "obj_mixed#Step", js_body: "this.x++;" },
        { kind: "closure", id: "closure:mixed", js_body: "return () => 42;" }
    ];

    const result = wrapper.applyPatchBatch(patches);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.appliedCount, 3);
    assert.ok(wrapper.hasScript("script:mixed"));
    assert.ok(wrapper.hasEvent("obj_mixed#Step"));
    assert.ok(wrapper.hasClosure("closure:mixed"));
});

void test("applyPatchBatch maintains undo stack integrity on success", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const patches = [
        { kind: "script", id: "script:undo1", js_body: "return 1;" },
        { kind: "script", id: "script:undo2", js_body: "return 2;" }
    ];

    wrapper.applyPatchBatch(patches);

    assert.ok(wrapper.hasScript("script:undo1"));
    assert.ok(wrapper.hasScript("script:undo2"));

    wrapper.undo();
    assert.ok(!wrapper.hasScript("script:undo2"));
    assert.ok(wrapper.hasScript("script:undo1"));

    wrapper.undo();
    assert.ok(!wrapper.hasScript("script:undo1"));
});

void test("applyPatchBatch clears undo stack on rollback", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:before_batch",
        js_body: "return 0;"
    });

    const patches = [
        { kind: "script", id: "script:batch_fail1", js_body: "return 1;" },
        { kind: "script", id: "script:batch_fail2", js_body: "return {{ bad" }
    ];

    const result = wrapper.applyPatchBatch(patches);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.rolledBack, true);
    assert.ok(wrapper.hasScript("script:before_batch"));
    assert.ok(!wrapper.hasScript("script:batch_fail1"));
});

void test("applyPatchBatch rollback preserves pre-batch undo stack depth", () => {
    // The batch checkpoint must capture and restore the exact undo-stack size so
    // that a failed batch does not corrupt the undo stack accumulated before it.
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    // Establish two pre-batch entries on the undo stack.
    wrapper.applyPatch({ kind: "script", id: "script:pre1", js_body: "return 0;" });
    wrapper.applyPatch({ kind: "script", id: "script:pre2", js_body: "return 0;" });
    const preUndoSize = wrapper.getUndoStackSize();

    // A batch that partially succeeds then fails midway.
    wrapper.applyPatchBatch([
        { kind: "script", id: "script:batch_ok", js_body: "return 1;" },
        { kind: "script", id: "script:batch_bad", js_body: "return {{ bad" }
    ]);

    // Rollback must restore the undo stack to its pre-batch depth — no partial
    // entries from the failed batch should be left behind.
    assert.strictEqual(wrapper.getUndoStackSize(), preUndoSize);
});

void test("applyPatchBatch rollback restores pre-batch patch history length", () => {
    // The checkpoint must also restore the patch-history array so that failed
    // batches do not leave orphaned per-patch entries in the history.
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({ kind: "script", id: "script:pre", js_body: "return 0;" });
    const preHistoryLength = wrapper.getPatchHistory().length;

    wrapper.applyPatchBatch([
        { kind: "script", id: "script:batch_ok", js_body: "return 1;" },
        { kind: "script", id: "script:batch_bad", js_body: "return {{ bad" }
    ]);

    // History grows by exactly one entry: the rollback summary. Per-patch entries
    // written during the failed batch must have been stripped by the checkpoint.
    assert.strictEqual(wrapper.getPatchHistory().length, preHistoryLength + 1);
    const rollbackEntry = wrapper.getPatchHistory().at(-1);
    assert.ok(rollbackEntry?.patch.id.startsWith("batch:"));
    assert.strictEqual(rollbackEntry?.action, "rollback");
});

void test("applyPatchBatch records rollback history entry with correct patch counts", () => {
    // recordBatchRollbackHistoryEntry must embed both the completed count and the
    // total count so callers can tell where the batch failed.
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    const result = wrapper.applyPatchBatch([
        { kind: "script", id: "script:ok1", js_body: "return 1;" },
        { kind: "script", id: "script:ok2", js_body: "return 2;" },
        { kind: "script", id: "script:bad", js_body: "return {{ bad" }
    ]);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.appliedCount, 2);
    assert.strictEqual(result.failedIndex, 2);

    const history = wrapper.getPatchHistory();
    const rollbackEntry = history.at(-1);
    // id format: "batch:<appliedCount>_of_<totalCount>"
    assert.strictEqual(rollbackEntry?.patch.id, "batch:2_of_3");
    assert.strictEqual(rollbackEntry?.action, "rollback");
    assert.ok(typeof rollbackEntry?.error === "string" && rollbackEntry.error.length > 0);
});

void test("onChange listener receives patch-applied events", () => {
    const events: Array<unknown> = [];
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onChange: (event) => events.push(event)
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 42;"
    });

    assert.strictEqual(events.length, 1);
    const event = events[0] as {
        type: string;
        patch: unknown;
        version: number;
    };
    assert.strictEqual(event.type, "patch-applied");
    assert.strictEqual(event.version, 1);
    assert.ok(event.patch);
});

void test("onChange listener receives patch-undone events", () => {
    const events: Array<unknown> = [];
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onChange: (event) => events.push(event)
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 42;"
    });
    events.length = 0;

    wrapper.undo();

    assert.strictEqual(events.length, 1);
    const event = events[0] as {
        type: string;
        patch: unknown;
        version: number;
    };
    assert.strictEqual(event.type, "patch-undone");
    assert.strictEqual(event.version, 2);
});

void test("onChange listener does not emit events for validation failures", () => {
    const events: Array<unknown> = [];
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onChange: (event) => events.push(event)
    });

    // Shadow validation failure - should not emit any event
    wrapper.trySafeApply({
        kind: "script",
        id: "script:bad_syntax",
        js_body: "return {{ invalid"
    });

    assert.strictEqual(events.length, 0, "Shadow validation failures should not emit events");

    // Custom validation failure - should not emit any event
    wrapper.trySafeApply(
        {
            kind: "script",
            id: "script:rejected",
            js_body: "return 1;"
        },
        () => false
    );

    assert.strictEqual(events.length, 0, "Custom validation failures should not emit events");
});

void test("onChange listener receives registry-cleared events", () => {
    const events: Array<unknown> = [];
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onChange: (event) => events.push(event)
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 42;"
    });
    events.length = 0;

    wrapper.clearRegistry();

    assert.strictEqual(events.length, 1);
    const event = events[0] as { type: string; version: number };
    assert.strictEqual(event.type, "registry-cleared");
    assert.strictEqual(event.version, 2);
});

void test("onChange listener receives patch-rolled-back events", () => {
    const events: Array<unknown> = [];
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onChange: (event) => events.push(event)
    });

    events.length = 0;

    // A patch with an unsatisfied dependency passes shadow validation (valid body)
    // but fails inside applyPatchWithValidation due to the missing dependency,
    // which causes trySafeApply to rollback and emit "patch-rolled-back".
    const result = wrapper.trySafeApply({
        kind: "script",
        id: "script:needs_dep",
        js_body: "return 1;",
        metadata: { dependencies: ["script:missing_dep"] }
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.rolledBack, true);
    assert.strictEqual(events.length, 1);
    const event = events[0] as { type: string; patch: { id: string }; version: number; error: string };
    assert.strictEqual(event.type, "patch-rolled-back");
    assert.strictEqual(event.patch.id, "script:needs_dep");
    assert.ok(typeof event.version === "number");
    assert.ok(typeof event.error === "string" && event.error.length > 0);
});

void test("onChange listener receives events for batch patches", () => {
    const events: Array<unknown> = [];
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        onChange: (event) => events.push(event)
    });

    wrapper.applyPatchBatch([
        { kind: "script", id: "script:a", js_body: "return 1;" },
        { kind: "script", id: "script:b", js_body: "return 2;" }
    ]);

    assert.strictEqual(events.length, 2);
    const event1 = events[0] as { type: string; version: number };
    const event2 = events[1] as { type: string; version: number };
    assert.strictEqual(event1.type, "patch-applied");
    assert.strictEqual(event2.type, "patch-applied");
    assert.strictEqual(event1.version, 1);
    assert.strictEqual(event2.version, 2);
});

void test("getPatchStats includes percentile metrics", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    // Apply patches with varying durations
    // We can't control exact duration, but we can verify percentiles are calculated
    for (let i = 0; i < 10; i++) {
        wrapper.applyPatch({
            kind: "script",
            id: `script:test${i}`,
            js_body: "return 1;"
        });
    }

    const stats = wrapper.getPatchStats();
    assert.ok(stats.p50DurationMs !== undefined);
    assert.ok(stats.p90DurationMs !== undefined);
    assert.ok(stats.p99DurationMs !== undefined);
    assert.ok(stats.p50DurationMs >= 0);
    assert.ok(stats.p90DurationMs >= stats.p50DurationMs);
    assert.ok(stats.p99DurationMs >= stats.p90DurationMs);
});

void test("percentile metrics handle single patch correctly", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:single",
        js_body: "return 1;"
    });

    const stats = wrapper.getPatchStats();
    assert.strictEqual(stats.appliedPatches, 1);
    assert.ok(stats.p50DurationMs !== undefined);
    assert.ok(stats.p90DurationMs !== undefined);
    assert.ok(stats.p99DurationMs !== undefined);
    assert.strictEqual(stats.p50DurationMs, stats.averagePatchDurationMs);
    assert.strictEqual(stats.p90DurationMs, stats.averagePatchDurationMs);
    assert.strictEqual(stats.p99DurationMs, stats.averagePatchDurationMs);
});

void test("checkRegistryHealth returns healthy status for valid registry", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 42;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_player#Step",
        js_body: "this.x += 1;"
    });

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:counter",
        js_body: "let n = 0; return () => ++n;"
    });

    const health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.healthy, true);
    assert.strictEqual(health.version, 3);
    assert.strictEqual(health.issues.length, 0);
});

void test("checkRegistryHealth detects corrupted script entries", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:valid",
        js_body: "return 42;"
    });

    (wrapper.state.registry.scripts as Record<string, unknown>)["script:corrupted"] = "not a function";

    const health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.healthy, false);
    assert.strictEqual(health.issues.length, 1);
    assert.strictEqual(health.issues[0].severity, "error");
    assert.strictEqual(health.issues[0].category, "function-type");
    assert.strictEqual(health.issues[0].affectedId, "script:corrupted");
    assert.match(health.issues[0].message, /not a function/i);
});

void test("checkRegistryHealth detects corrupted event entries", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "event",
        id: "obj_player#Step",
        js_body: "this.x += 1;"
    });

    (wrapper.state.registry.events as Record<string, unknown>)["obj_player#Create"] = 123;

    const health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.healthy, false);
    assert.strictEqual(health.issues.length, 1);
    assert.strictEqual(health.issues[0].severity, "error");
    assert.strictEqual(health.issues[0].category, "function-type");
    assert.strictEqual(health.issues[0].affectedId, "obj_player#Create");
});

void test("checkRegistryHealth detects corrupted closure entries", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:valid",
        js_body: "return () => 1;"
    });

    (wrapper.state.registry.closures as Record<string, unknown>)["closure:corrupted"] = null;

    const health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.healthy, false);
    assert.strictEqual(health.issues.length, 1);
    assert.strictEqual(health.issues[0].severity, "error");
    assert.strictEqual(health.issues[0].category, "function-type");
    assert.strictEqual(health.issues[0].affectedId, "closure:corrupted");
});

void test("checkRegistryHealth detects multiple issues", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    (wrapper.state.registry.scripts as Record<string, unknown>)["script:bad1"] = "string";
    (wrapper.state.registry.events as Record<string, unknown>)["event:bad2"] = 42;
    (wrapper.state.registry.closures as Record<string, unknown>)["closure:bad3"] = {};

    const health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.healthy, false);
    assert.strictEqual(health.issues.length, 3);
});

void test("checkRegistryHealth returns current version", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    let health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.version, 0);

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.version, 1);

    wrapper.undo();

    health = wrapper.checkRegistryHealth();
    assert.strictEqual(health.version, 2);
});

void test("getUndoStackSize returns current undo stack size", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    assert.strictEqual(wrapper.getUndoStackSize(), 0);

    wrapper.applyPatch({
        kind: "script",
        id: "script:test1",
        js_body: "return 1;"
    });

    assert.strictEqual(wrapper.getUndoStackSize(), 1);

    wrapper.applyPatch({
        kind: "script",
        id: "script:test2",
        js_body: "return 2;"
    });

    assert.strictEqual(wrapper.getUndoStackSize(), 2);

    wrapper.undo();

    assert.strictEqual(wrapper.getUndoStackSize(), 1);
});

void test("maxUndoStackSize limits undo stack growth", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        maxUndoStackSize: 5
    });

    for (let i = 0; i < 10; i++) {
        wrapper.applyPatch({
            kind: "script",
            id: `script:test${i}`,
            js_body: `return ${i};`
        });
    }

    assert.strictEqual(wrapper.getUndoStackSize(), 5);

    const result = wrapper.undo();
    assert.ok(result.success);

    assert.strictEqual(wrapper.getUndoStackSize(), 4);
});

void test("maxUndoStackSize preserves most recent patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        maxUndoStackSize: 3
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:old1",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:old2",
        js_body: "return 2;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:recent1",
        js_body: "return 3;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:recent2",
        js_body: "return 4;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:recent3",
        js_body: "return 5;"
    });

    assert.strictEqual(wrapper.getUndoStackSize(), 3);

    wrapper.undo();
    assert.ok(wrapper.hasScript("script:recent2"));
    assert.ok(!wrapper.hasScript("script:recent3"));

    wrapper.undo();
    assert.ok(wrapper.hasScript("script:recent1"));
    assert.ok(!wrapper.hasScript("script:recent2"));

    wrapper.undo();
    assert.ok(!wrapper.hasScript("script:recent1"));
    assert.ok(wrapper.hasScript("script:old2"));
});

void test("maxUndoStackSize zero allows unlimited undo", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        maxUndoStackSize: 0
    });

    for (let i = 0; i < 100; i++) {
        wrapper.applyPatch({
            kind: "script",
            id: `script:test${i}`,
            js_body: `return ${i};`
        });
    }

    assert.strictEqual(wrapper.getUndoStackSize(), 100);
});

void test("maxUndoStackSize default is 50", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    for (let i = 0; i < 100; i++) {
        wrapper.applyPatch({
            kind: "script",
            id: `script:test${i}`,
            js_body: `return ${i};`
        });
    }

    assert.strictEqual(wrapper.getUndoStackSize(), 50);
});

void test("maxUndoStackSize works with applyPatchBatch", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper({
        maxUndoStackSize: 3
    });

    const patches = [];
    for (let i = 0; i < 10; i++) {
        patches.push({
            kind: "script",
            id: `script:test${i}`,
            js_body: `return ${i};`
        });
    }

    wrapper.applyPatchBatch(patches);

    assert.strictEqual(wrapper.getUndoStackSize(), 3);
});

void test("clearRegistry resets undo stack size", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    assert.strictEqual(wrapper.getUndoStackSize(), 1);

    wrapper.clearRegistry();

    assert.strictEqual(wrapper.getUndoStackSize(), 0);
});

void test("getPatchById returns all history entries for a patch ID", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:other",
        js_body: "return 2;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 3;"
    });

    const entries = wrapper.getPatchById("script:test");
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].patch.id, "script:test");
    assert.strictEqual(entries[0].version, 1);
    assert.strictEqual(entries[1].patch.id, "script:test");
    assert.strictEqual(entries[1].version, 3);
});

void test("getPatchById returns empty array for non-existent ID", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:exists",
        js_body: "return 1;"
    });

    const entries = wrapper.getPatchById("script:nonexistent");
    assert.strictEqual(entries.length, 0);
});

void test("getPatchById includes undo and rollback operations", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    wrapper.undo();

    const entries = wrapper.getPatchById("script:test");
    assert.strictEqual(entries.length, 2);
    assert.strictEqual(entries[0].action, "apply");
    assert.strictEqual(entries[1].action, "undo");
});

void test("getPatchesByKind returns all patches of specified kind", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:a",
        js_body: "return 1;"
    });

    wrapper.applyPatch({
        kind: "event",
        id: "obj_test#Step",
        js_body: "this.x += 1;"
    });

    wrapper.applyPatch({
        kind: "script",
        id: "script:b",
        js_body: "return 2;"
    });

    wrapper.applyPatch({
        kind: "closure",
        id: "closure:c",
        js_body: "return () => 3;"
    });

    const scriptEntries = wrapper.getPatchesByKind("script");
    assert.strictEqual(scriptEntries.length, 2);
    assert.strictEqual(scriptEntries[0].patch.id, "script:a");
    assert.strictEqual(scriptEntries[1].patch.id, "script:b");

    const eventEntries = wrapper.getPatchesByKind("event");
    assert.strictEqual(eventEntries.length, 1);
    assert.strictEqual(eventEntries[0].patch.id, "obj_test#Step");

    const closureEntries = wrapper.getPatchesByKind("closure");
    assert.strictEqual(closureEntries.length, 1);
    assert.strictEqual(closureEntries[0].patch.id, "closure:c");
});

void test("getPatchesByKind returns empty array for kind with no patches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatch({
        kind: "script",
        id: "script:test",
        js_body: "return 1;"
    });

    const eventEntries = wrapper.getPatchesByKind("event");
    assert.strictEqual(eventEntries.length, 0);

    const closureEntries = wrapper.getPatchesByKind("closure");
    assert.strictEqual(closureEntries.length, 0);
});

void test("getPatchesByKind includes operations from batches", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();

    wrapper.applyPatchBatch([
        { kind: "script", id: "script:batch1", js_body: "return 1;" },
        { kind: "event", id: "obj_test#Create", js_body: "this.x = 0;" },
        { kind: "script", id: "script:batch2", js_body: "return 2;" }
    ]);

    const scriptEntries = wrapper.getPatchesByKind("script");
    // Includes the two script patches plus the batch marker
    assert.strictEqual(scriptEntries.length, 3);
    assert.strictEqual(scriptEntries[0].patch.id, "script:batch1");
    assert.strictEqual(scriptEntries[1].patch.id, "script:batch2");
    assert.ok(scriptEntries[2].patch.id.startsWith("batch:"));

    const eventEntries = wrapper.getPatchesByKind("event");
    assert.strictEqual(eventEntries.length, 1);
    assert.strictEqual(eventEntries[0].patch.id, "obj_test#Create");
});
