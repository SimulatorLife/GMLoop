import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";

import { applyRepairEventCallbackOtherCodemod } from "../../src/codemods/repair-event-callback-other-codemod.js";

interface ProgramLike {
    type: string;
    body?: ReadonlyArray<unknown>;
    start?: number;
    end?: number;
    sourcePath?: string;
}

function parseEvent(sourceText: string, _sourcePath: string): ProgramLike {
    return Parser.GMLParser.parse(sourceText) as ProgramLike;
}

void describe("repairEventCallbackOther codemod", () => {
    void it("rewrites other.<name> inside inline callbacks in event bodies", () => {
        const source = [
            "// @description Create event",
            "outline_colour = c_white;",
            "zmodel = new ZModelOverrideCustom(",
            "    zmodel_surface,",
            '    "draw_to_surface",',
            "    function(_func_draw) {",
            "        shader_set_uniform_f(other.outline_u_tsize, 0, 0);",
            "        other.outline_colour = c_red;",
            "        method_call(_func_draw, [other.width, other.height]);",
            "    }",
            ");"
        ].join("\n");
        const ast = parseEvent(source, "objects/obj_player/Create_0.gml");
        const result = applyRepairEventCallbackOtherCodemod(source, ast, {
            sourcePath: "objects/obj_player/Create_0.gml"
        });

        assert.equal(result.changed, true, "Codemod should report a change.");
        assert.match(result.outputText, /shader_set_uniform_f\(self\.outline_u_tsize/);
        assert.match(result.outputText, /self\.outline_colour = c_red/);
        assert.match(result.outputText, /self\.width, self\.height/);
    });

    void it("preserves top-level other.<name> in event bodies", () => {
        const source = ["var msg = other.speaker.name;"].join("\n");
        const ast = parseEvent(source, "objects/obj_chat/Create_0.gml");
        const result = applyRepairEventCallbackOtherCodemod(source, ast, {
            sourcePath: "objects/obj_chat/Create_0.gml"
        });

        assert.equal(result.changed, false, "Top-level other should not be touched.");
        assert.equal(result.outputText, source);
    });

    void it("does not run on non-event files", () => {
        const source = ["callback = function() { return other.value; };"].join("\n");
        const ast = parseEvent(source, "scripts/scr_helper/scr_helper.gml");
        const result = applyRepairEventCallbackOtherCodemod(source, ast, {
            sourcePath: "scripts/scr_helper/scr_helper.gml"
        });

        assert.equal(result.changed, false, "Non-event files must be left untouched.");
        assert.equal(result.outputText, source);
    });

    void it("is a no-op when no inline callbacks reference other", () => {
        const source = [
            "outline_colour = c_black;",
            "zmodel = new ZModelOverrideCustom(",
            "    zmodel_surface,",
            '    "draw_to_surface",',
            "    function(_func_draw) { return _func_draw(self.hw, self.height); }",
            ");"
        ].join("\n");
        const ast = parseEvent(source, "objects/obj_player/Create_0.gml");
        const result = applyRepairEventCallbackOtherCodemod(source, ast, {
            sourcePath: "objects/obj_player/Create_0.gml"
        });

        assert.equal(result.changed, false);
        assert.equal(result.outputText, source);
    });
});
