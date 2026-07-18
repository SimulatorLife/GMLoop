import assert from "node:assert/strict";
import { describe, it } from "node:test";
import vm from "node:vm";

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

        void it("recognizes runtime values and constants as bare identifiers", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "x = mouse_x; spiderColour = c_green; z = pi;",
                symbolId: "gml/event/obj_player/step"
            });

            assert.match(patch.js_body, /self\.x = mouse_x/);
            assert.match(patch.js_body, /self\.spiderColour = c_green/);
            assert.match(patch.js_body, /self\.z = pi/);
            assert.ok(!patch.js_body.includes("self.mouse_x"), "mouse_x should resolve through the runtime proxy");
            assert.ok(!patch.js_body.includes("self.c_green"), "c_green should resolve through the runtime proxy");
            assert.ok(!patch.js_body.includes("self.pi"), "pi should resolve through the runtime proxy");
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
        void it("throws request error when request is not an object", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileEvent(null), {
                name: "TranspilerError",
                code: Transpiler.TranspilerErrorCode.REQUEST_ERROR,
                message: /transpileEvent requires a request object/
            });
        });

        void it("throws request error when sourceText is empty", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileEvent({ sourceText: "", symbolId: "gml/event/x" }), {
                name: "TranspilerError",
                code: Transpiler.TranspilerErrorCode.REQUEST_ERROR,
                message: /transpileEvent requires a sourceText string/
            });
        });

        void it("throws request error when symbolId is empty", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileEvent({ sourceText: "x = 1;", symbolId: "" }), {
                name: "TranspilerError",
                code: Transpiler.TranspilerErrorCode.REQUEST_ERROR,
                message: /transpileEvent requires a symbolId string/
            });
        });

        void it("throws request error when sourcePath is an empty string", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileEvent({
                        sourceText: "x = 1;",
                        symbolId: "gml/event/obj/create",
                        sourcePath: ""
                    }),
                {
                    name: "TranspilerError",
                    code: Transpiler.TranspilerErrorCode.REQUEST_ERROR,
                    message: /sourcePath to be a non-empty string/
                }
            );
        });

        void it("throws request error when thisName is an empty string", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileEvent({
                        sourceText: "x = 1;",
                        symbolId: "gml/event/obj/create",
                        thisName: ""
                    }),
                {
                    name: "TranspilerError",
                    code: Transpiler.TranspilerErrorCode.REQUEST_ERROR,
                    message: /thisName to be a non-empty string/
                }
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

    void describe("nested lexical scopes (regression: function (self.x))", () => {
        void it("emits nested function parameters as bare names, not self.<name>", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "function inner(inner_param) { return inner_param + 1; }",
                symbolId: "gml/event/obj_player/step"
            });

            assert.ok(
                !patch.js_body.includes("self.inner_param"),
                "nested function parameter must not be emitted as self.inner_param"
            );
            assert.ok(
                !/function\s*\([^)]*\bself\./.test(patch.js_body),
                "the function parameter list itself must not contain self."
            );
            assert.match(patch.js_body, /function\s+inner\s*\(\s*inner_param\s*\)/);
        });

        void it("emits nested function var declarations as bare names, not self.<name>", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "function inner() { var inner_local = 5; return inner_local; }",
                symbolId: "gml/event/obj_player/step"
            });

            assert.ok(!patch.js_body.includes("self.inner_local"), "var inside nested function must remain a local");
            assert.match(patch.js_body, /var\s+inner_local/);
            assert.match(patch.js_body, /return\s+inner_local/);
        });

        void it("emits nested function expression parameters as bare names, not self.<name>", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            // The classic bug: `function (self.x) { ... }` — the parameter list itself
            // contained the bogus `self.` prefix instead of the bare parameter name.
            const patch = transpiler.transpileEvent({
                sourceText: "var cb = function (callback_arg) { return callback_arg + 1; };",
                symbolId: "gml/event/obj_enemy/step"
            });

            assert.ok(
                !/function\s*\([^)]*\bself\./.test(patch.js_body),
                `nested function expression parameter list must not contain self., got: ${patch.js_body}`
            );
            assert.ok(!patch.js_body.includes("self.callback_arg"));
            assert.match(patch.js_body, /function\s*\(\s*callback_arg\s*\)/);
        });

        void it("emits catch clause parameters as bare names, not self.<name>", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "try { health -= 1; } catch (err) { show_debug_message(err.message); }",
                symbolId: "gml/event/obj_enemy/step"
            });

            assert.ok(!/catch\s*\(\s*self\./.test(patch.js_body), "catch parameter must not be emitted as self.<name>");
            assert.ok(!patch.js_body.includes("self.err"));
            assert.match(patch.js_body, /catch\s*\(\s*err\s*\)/);
            assert.match(patch.js_body, /err\.message/);
        });

        void it("emits var declarations inside a catch body as bare names, not self.<name>", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText:
                    "try { x = 0; } catch (caught_err) { var caught_msg = caught_err.message; show_debug_message(caught_msg); }",
                symbolId: "gml/event/obj_enemy/step"
            });

            assert.ok(!patch.js_body.includes("self.caught_msg"), "var inside catch body must remain a local");
            assert.ok(!patch.js_body.includes("self.caught_err"));
            assert.match(patch.js_body, /var\s+caught_msg/);
        });

        void it("keeps outer-scope locals visible inside nested functions while nested locals stay lexical", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText:
                    "var outer_local = 1; function inner(inner_arg) { var inner_local = outer_local + inner_arg; return inner_local; }",
                symbolId: "gml/event/obj_player/step"
            });

            // outer_local is a local in the event body, so references inside the nested
            // function should also resolve to the bare name (no self. prefix).
            assert.ok(!patch.js_body.includes("self.outer_local"));
            assert.ok(!patch.js_body.includes("self.inner_local"));
            assert.ok(!patch.js_body.includes("self.inner_arg"));
            assert.match(patch.js_body, /outer_local/);
            assert.match(patch.js_body, /inner_local/);
            assert.match(patch.js_body, /inner_arg/);
        });

        void it("keeps default-parameter bindings bare while resolving instance-field defaults", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: "var callback = function (value = health) { return value; };",
                symbolId: "gml/event/obj_player/create"
            });

            assert.match(patch.js_body, /function\s*\(value = self\.health\)/);
            assert.ok(!patch.js_body.includes("self.value"));
        });

        void it("keeps function-scoped vars declared in catch blocks local after the catch", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText:
                    "function inner() { try { health -= 1; } catch (err) { var message = err.message; } return message; }",
                symbolId: "gml/event/obj_player/step"
            });

            assert.ok(!patch.js_body.includes("self.err"));
            assert.ok(!patch.js_body.includes("self.message"));
            assert.match(patch.js_body, /return\s+message/);
        });

        void it("emits a syntactically valid patch for nested event callbacks", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileEvent({
                sourceText: [
                    "var owner = self;",
                    "callback = function (callback_arg) {",
                    "    var inner = function (inner_arg) { return owner.value + inner_arg; };",
                    "    try { return inner(callback_arg); } catch (err) { return err.message; }",
                    "};"
                ].join("\n"),
                symbolId: "gml/event/obj_player/create"
            });

            assert.doesNotThrow(() => new vm.Script(`(function(self, other, args) { ${patch.js_body} })`));
        });
    });
});
