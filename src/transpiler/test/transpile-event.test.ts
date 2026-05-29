import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void describe("GmlTranspiler.transpileEvent", () => {
    void describe("patch shape", () => {
        void it("returns an EventPatch with kind 'event'", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 10;",
                symbolId: "gml/event/obj_player/create"
            });

            assert.equal(patch.kind, "event");
        });

        void it("returns the correct symbolId", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 10;",
                symbolId: "gml/event/obj_enemy/step"
            });

            assert.equal(patch.id, "gml/event/obj_enemy/step");
        });

        void it("includes the original sourceText in the patch", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const src = "health -= 1;";
            const patch = transpiler.transpileEvent({
                sourceText: src,
                symbolId: "gml/event/obj_enemy/step"
            });

            assert.equal(patch.sourceText, src);
        });

        void it("sets this_name to 'self' by default", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 0;",
                symbolId: "gml/event/obj_player/create"
            });

            assert.equal(patch.this_name, "self");
        });

        void it("respects a custom thisName", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 0;",
                symbolId: "gml/event/obj_player/create",
                thisName: "inst"
            });

            assert.equal(patch.this_name, "inst");
        });

        void it("includes metadata with timestamp", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 0;",
                symbolId: "gml/event/obj_player/create"
            });

            assert.strictEqual(typeof patch.metadata?.timestamp, "number", "timestamp should be a number");
            assert.ok(patch.metadata.timestamp > 0, "timestamp should be positive");
        });

        void it("includes sourcePath in metadata when provided", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 0;",
                symbolId: "gml/event/obj_player/create",
                sourcePath: "objects/obj_player/Create_0.gml"
            });

            assert.equal(patch.metadata?.sourcePath, "objects/obj_player/Create_0.gml");
        });

        void it("sets a numeric version (timestamp)", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = 0;",
                symbolId: "gml/event/obj_player/create"
            });

            assert.ok(typeof patch.version === "number");
            assert.ok(patch.version > 0);
        });
    });

    void describe("identifier resolution (event context)", () => {
        void it("emits instance fields as self.<name>", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            // `health` is not var-declared → instance field
            const patch = transpiler.transpileEvent({
                sourceText: "health -= 1;",
                symbolId: "gml/event/obj_enemy/step"
            });

            assert.match(patch.js_body, /self\.health/);
        });

        void it("keeps var-declared locals as bare names", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "var spd = 5; x += spd;",
                symbolId: "gml/event/obj_player/step"
            });

            // `spd` is var-declared → remains as a bare name, not self.spd
            assert.ok(!patch.js_body.includes("self.spd"), "spd should not be a self field");
            assert.match(patch.js_body, /var spd/);
        });

        void it("emits instance fields while keeping locals bare", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "var spd = 5; x += spd; health -= 1;",
                symbolId: "gml/event/obj_player/step"
            });

            // x and health are instance fields
            assert.match(patch.js_body, /self\.x/);
            assert.match(patch.js_body, /self\.health/);
            // spd is a local
            assert.ok(!patch.js_body.includes("self.spd"), "spd should remain local");
        });

        void it("recognizes built-in functions and emits them as bare calls", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x += cos(direction);",
                symbolId: "gml/event/obj_player/step"
            });

            // cos is a builtin, direction is an instance field
            assert.match(patch.js_body, /cos\(/);
            assert.ok(!patch.js_body.includes("self.cos"), "cos should not be a self field");
            assert.match(patch.js_body, /self\.direction/);
        });

        void it("routes script calls through the hot-reload wrapper", () => {
            const oracle = Transpiler.createSemanticOracle({
                scriptNames: new Set(["scr_die"])
            });
            const transpiler = new Transpiler.GmlTranspiler({ semantic: oracle });
            const patch = transpiler.transpileEvent({
                sourceText: "scr_die();",
                symbolId: "gml/event/obj_enemy/collision"
            });

            // Script calls go through __call_script
            assert.match(patch.js_body, /__call_script/);
            assert.match(patch.js_body, /scr_die/);
        });

        void it("emits global.x prefix for global variable accesses", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "global.player_score += 10;",
                symbolId: "gml/event/obj_pickup/collision"
            });

            assert.match(patch.js_body, /global\.player_score/);
        });

        void it("collects var declarations from inside if blocks (GML function scoping)", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            // In GML, var is function-scoped — a var inside `if` is still a local
            const patch = transpiler.transpileEvent({
                sourceText: 'if (alive) { var msg = "hit"; show_debug_message(msg); }',
                symbolId: "gml/event/obj_enemy/step"
            });

            // `msg` is var-declared inside an if block → should remain as a bare name
            assert.ok(!patch.js_body.includes("self.msg"), "msg should be a local, not self field");
        });
    });

    void describe("input validation", () => {
        void it("throws TypeError when request is not an object", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileEvent(null), {
                name: "TypeError",
                message: /transpileEvent requires a request object/
            });
        });

        void it("throws TypeError when sourceText is empty", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileEvent({ sourceText: "", symbolId: "gml/event/x" }), {
                name: "TypeError",
                message: /transpileEvent requires a sourceText string/
            });
        });

        void it("throws TypeError when symbolId is empty", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileEvent({ sourceText: "x = 1;", symbolId: "" }), {
                name: "TypeError",
                message: /transpileEvent requires a symbolId string/
            });
        });

        void it("throws TypeError when sourcePath is an empty string", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileEvent({
                        sourceText: "x = 1;",
                        symbolId: "gml/event/obj/create",
                        sourcePath: ""
                    }),
                { name: "TypeError", message: /sourcePath to be a non-empty string/ }
            );
        });

        void it("throws TypeError when thisName is an empty string", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileEvent({
                        sourceText: "x = 1;",
                        symbolId: "gml/event/obj/create",
                        thisName: ""
                    }),
                { name: "TypeError", message: /thisName to be a non-empty string/ }
            );
        });

        void it("wraps transpilation errors with the symbolId in the message", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileEvent({
                        sourceText: "invalid %%%%",
                        symbolId: "gml/event/obj_player/create"
                    }),
                { message: /Failed to transpile event gml\/event\/obj_player\/create/ }
            );
        });
    });

    void describe("AST reuse", () => {
        void it("accepts a pre-parsed AST to skip parsing", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const sourceText = "x = 10;";
            const ast = Parser.GMLParser.parse(sourceText);

            const patch = transpiler.transpileEvent({ sourceText, symbolId: "gml/event/x", ast });
            assert.equal(patch.kind, "event");
            assert.match(patch.js_body, /self\.x/);
        });

        void it("rejects non-Program AST reuse inputs", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileEvent({
                        sourceText: "x = 10;",
                        symbolId: "gml/event/x",
                        ast: {
                            type: "BlockStatement",
                            body: []
                        }
                    }),
                { name: "TranspilerError", message: /ast\.type to be 'Program'/ }
            );
        });
    });
});
