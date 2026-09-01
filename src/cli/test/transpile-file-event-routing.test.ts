/**
 * Tests for event vs. script routing in transpileFile.
 *
 * Verifies that `transpileFile` routes files inside `objects/<objectName>/`
 * through `transpileEvent()` (producing EventPatch with `kind === "event"` and
 * `self.*` instance-variable access), while script files are routed through
 * `transpileScript()` (producing ScriptPatch with `kind === "script"`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Transpiler } from "@gmloop/transpiler";

import { type TranspilationContext, transpileFile } from "../src/modules/transpilation/coordinator.js";

function createContext(websocketServer: TranspilationContext["websocketServer"] = null): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        sourcePathToPatchIds: new Map(),
        bounds: { maxEntries: 50 },
        totalPatchCount: 0,
        websocketServer
    };
}

const EVENT_SOURCE = "x += 2;\nhealth -= 1;";
const SCRIPT_SOURCE = `function scr_player() {
    var speed = 4;
    x += speed;
}`;

void describe("transpileFile event vs script routing", () => {
    void it("routes an object event file to transpileEvent and produces an EventPatch", () => {
        const context = createContext();
        const filePath = "/project/objects/obj_player/Step_0.gml";

        const result = transpileFile(context, filePath, EVENT_SOURCE, 2, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Transpilation should succeed");
        assert.ok(result.patch, "A patch should be produced");
        assert.strictEqual(result.patch.kind, "event", "Patch kind must be 'event'");
        assert.strictEqual(
            result.patch.id,
            "gml/event/obj_player/Step_0",
            "Event patch ID must use canonical gml/event/<obj>/<event> URI"
        );

        // EventPatch carries runtimeId so the runtime can locate the correct
        // GameMaker object-event function (gml_Object_<obj>_<event>).
        const patchWithRuntime = result.patch as { runtimeId?: string };
        assert.strictEqual(
            patchWithRuntime.runtimeId,
            "gml_Object_obj_player_Step_0",
            "EventPatch must carry the GameMaker runtime function name"
        );
    });

    void it("emits self.<field> for undeclared identifiers in event transpilation", () => {
        const context = createContext();
        // 'x' and 'health' are undeclared → should be emitted as self.x, self.health
        const result = transpileFile(context, "/project/objects/obj_enemy/Step_0.gml", "x += 1;\nhealth -= 1;", 2, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Event transpilation should succeed");
        assert.ok(result.patch?.js_body, "Event patch must have a JavaScript body");
        assert.ok(
            result.patch.js_body.includes("self.x"),
            `Event body should reference 'x' via self.x; got:\n${result.patch.js_body}`
        );
        assert.ok(
            result.patch.js_body.includes("self.health"),
            `Event body should reference 'health' via self.health; got:\n${result.patch.js_body}`
        );
    });

    void it("var-declared locals in event body are NOT emitted with self.*", () => {
        const context = createContext();
        // 'spd' is var-declared → bare local. 'x' is undeclared → self.x.
        const source = "var spd = 5;\nx += spd;";
        const result = transpileFile(context, "/project/objects/obj_player/Create_0.gml", source, 2, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Event transpilation should succeed");
        assert.ok(result.patch?.js_body, "Event patch must have a JavaScript body");
        assert.ok(!result.patch.js_body.includes("self.spd"), "var-declared 'spd' must not be prefixed with self.");
        assert.ok(
            result.patch.js_body.includes("spd"),
            `var-declared 'spd' should still appear as a bare local in the output; got:\n${result.patch.js_body}`
        );
        assert.ok(result.patch.js_body.includes("self.x"), "undeclared 'x' must be emitted as self.x");
    });

    void it("routes a script file to transpileScript and produces a ScriptPatch", () => {
        const context = createContext();
        const filePath = "/project/scripts/scr_player.gml";

        const result = transpileFile(context, filePath, SCRIPT_SOURCE, 4, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Script transpilation should succeed");
        assert.ok(result.patch, "A patch should be produced");
        assert.strictEqual(result.patch.kind, "script", "Patch kind must be 'script'");
        assert.ok(
            result.patch.id.startsWith("gml/script/"),
            `Script patch ID must start with gml/script/; got: ${result.patch.id}`
        );
    });

    void it("emits and broadcasts one patch per top-level function in a script", () => {
        const broadcasts: Array<unknown> = [];
        const context = createContext({
            broadcast(payload) {
                broadcasts.push(payload);
                return { successCount: 1, failureCount: 0, totalClients: 1 };
            },
            getClientCount() {
                return 1;
            }
        });
        const source = `function first_helper(value) {
    return value + 1;
}

function second_helper(value) {
    return value + 2;
}`;

        const result = transpileFile(context, "/project/scripts/group_helpers.gml", source, 7, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Transpilation should succeed");
        assert.strictEqual(result.patches?.length, 2, "Each top-level function must receive its own patch");
        assert.deepStrictEqual(
            result.patches?.map((patch) => patch.id),
            ["gml/script/first_helper", "gml/script/second_helper"]
        );
        assert.ok(result.patches?.every((patch) => !patch.js_body.includes("function second_helper")));
        assert.strictEqual(context.totalPatchCount, 2, "Each changed function patch must count separately");
        assert.strictEqual(broadcasts.length, 1, "Function patches must be delivered in one websocket message");
        assert.ok(Array.isArray(broadcasts[0]), "Multiple function patches must be sent as a batch");
        assert.strictEqual((broadcasts[0] as Array<unknown>).length, 2);
    });

    void it("keeps executable top-level script statements in a file-level patch", () => {
        const context = createContext();
        const source = `#macro helper_name first_helper
var group_initialized = true;

function first_helper() {
    return group_initialized;
}

function second_helper() {
    return first_helper();
}`;

        const result = transpileFile(context, "/project/scripts/group_helpers.gml", source, 9, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(
            result.patches?.map((patch) => patch.id),
            ["gml/script/group_helpers", "gml/script/first_helper", "gml/script/second_helper"]
        );
        assert.ok(result.patches?.[0]?.js_body.includes("group_initialized"));
        assert.ok(result.patches?.[1]?.js_body.includes("return group_initialized"));
        assert.ok(result.patches?.[2]?.js_body.includes("first_helper"));
    });

    void it("rejects an unbindable same-named file-level initialization patch", () => {
        const context = createContext();
        const source = `var initialized = true;

function same_name() {
    return initialized;
}`;

        const result = transpileFile(context, "/project/scripts/same_name.gml", source, 6, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.equal(result.success, false);
        assert.match(result.error?.error ?? "", /top-level executable statements.*same_name/u);
    });

    void it("removes compile-time directives before a single script function is emitted", () => {
        const context = createContext();
        const source = `#macro UNUSED_VALUE 9
function only_function() {
    return 4;
}`;

        const result = transpileFile(context, "/project/scripts/only_function.gml", source, 4, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.equal(result.success, true);
        assert.ok(result.patch);
        assert.ok(!result.patch.js_body.includes("UNUSED_VALUE"));
        assert.ok(!result.patch.js_body.includes("const "));
    });

    void it("removes compile-time directives before an object event is emitted", () => {
        const context = createContext();
        const source = `#macro EVENT_VALUE 3
x = EVENT_VALUE;`;

        const result = transpileFile(context, "/project/objects/obj_player/Create_0.gml", source, 2, {
            verbose: false,
            quiet: true,
            deliverRuntimePatch: false
        });

        assert.equal(result.success, true);
        assert.ok(result.patch);
        assert.ok(result.patch.js_body.includes("3"));
        assert.ok(!result.patch.js_body.includes("EVENT_VALUE"));
        assert.ok(!result.patch.js_body.includes("const "));
    });

    void it("routes a top-level .gml file (not under objects/) to transpileScript", () => {
        const context = createContext();
        const filePath = "/project/scripts/utility.gml";

        const result = transpileFile(context, filePath, "var x = 10;", 1, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Transpilation should succeed");
        assert.strictEqual(result.patch?.kind, "script", "Top-level files must produce a script patch");
    });

    void it("accumulates metrics for event transpilation", () => {
        const context = createContext();

        const result = transpileFile(context, "/project/objects/obj_player/Draw_0.gml", "draw_self();", 1, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Event transpilation should succeed");
        assert.ok(result.metrics, "Metrics should be recorded for event transpilation");
        assert.strictEqual(typeof result.metrics?.durationMs, "number", "Duration must be a number");
        assert.ok(result.metrics && result.metrics.durationMs >= 0, "Duration must be non-negative");
    });

    void it("increments totalPatchCount when an event patch changes", () => {
        const context = createContext();
        const filePath = "/project/objects/obj_player/Alarm_0.gml";
        const source = "alarm[0] = 30;";

        assert.strictEqual(context.totalPatchCount, 0, "Patch count starts at 0");

        transpileFile(context, filePath, source, 1, { verbose: false, quiet: true });

        assert.strictEqual(context.totalPatchCount, 1, "Patch count should be 1 after first event transpilation");
    });
});
