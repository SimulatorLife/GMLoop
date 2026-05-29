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

function createContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        bounds: { maxEntries: 50 },
        totalPatchCount: 0,
        websocketServer: null
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
