import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Transpiler } from "../index.js";

type TranspilerInstance = InstanceType<typeof Transpiler.GmlTranspiler>;
type TranspileClosureArgs = Parameters<TranspilerInstance["transpileClosure"]>[0];

/**
 * Tests for `GmlTranspiler.transpileClosure`.
 *
 * `transpileClosure` is the counterpart to `transpileScript` and `transpileEvent`
 * that targets the runtime-wrapper's closure registry. The emitted body follows
 * the same `new Function("...args", js_body)` convention used by the wrapper:
 * named parameters are unpacked from `args[0]`, `args[1]`, etc.
 */
void describe("GmlTranspiler.transpileClosure", () => {
    void describe("patch shape", () => {
        void it("returns a ClosurePatch with kind 'closure'", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function helper(x) { return x; }",
                symbolId: "gml/closure/scr_utils/helper"
            });

            assert.equal(patch.kind, "closure");
        });

        void it("returns the correct symbolId", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function add(a, b) { return a + b; }",
                symbolId: "gml/closure/scr_math/add"
            });

            assert.equal(patch.id, "gml/closure/scr_math/add");
        });

        void it("includes the original sourceText in the patch", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const src = "function helper(x) { return x * 2; }";
            const patch = transpiler.transpileClosure({
                sourceText: src,
                symbolId: "gml/closure/scr_utils/helper"
            });

            assert.equal(patch.sourceText, src);
        });

        void it("includes metadata with timestamp", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const before = Date.now();
            const patch = transpiler.transpileClosure({
                sourceText: "function f() { return 1; }",
                symbolId: "gml/closure/scr/f"
            });
            const after = Date.now();

            assert.ok(patch.metadata?.timestamp !== undefined);
            assert.ok(patch.metadata.timestamp >= before);
            assert.ok(patch.metadata.timestamp <= after);
        });

        void it("includes sourcePath in metadata when provided", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function f() { return 1; }",
                symbolId: "gml/closure/scr/f",
                sourcePath: "scripts/scr_utils/scr_utils.gml"
            });

            assert.equal(patch.metadata?.sourcePath, "scripts/scr_utils/scr_utils.gml");
        });

        void it("omits sourcePath from metadata when not provided", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function f() { return 1; }",
                symbolId: "gml/closure/scr/f"
            });

            assert.equal(patch.metadata?.sourcePath, undefined);
        });

        void it("sets a numeric version (timestamp)", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function f() { return 0; }",
                symbolId: "gml/closure/scr/f"
            });

            assert.ok(typeof patch.version === "number");
            assert.ok(patch.version > 0);
        });
    });

    void describe("function unwrapping (single function declaration)", () => {
        void it("unwraps a parameterless function body", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function greet() { return 42; }",
                symbolId: "gml/closure/scr/greet"
            });

            assert.equal(patch.js_body, "return 42;");
        });

        void it("unpacks a single parameter from args[0]", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function double(x) { return x * 2; }",
                symbolId: "gml/closure/scr/double"
            });

            assert.match(patch.js_body, /^var x = args\[0\];/m);
            assert.match(patch.js_body, /return \(?x \* 2\)?;/);
        });

        void it("unpacks two parameters from args[0] and args[1]", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function add(a, b) { return a + b; }",
                symbolId: "gml/closure/scr/add"
            });

            assert.match(patch.js_body, /^var a = args\[0\];/m);
            assert.match(patch.js_body, /^var b = args\[1\];/m);
            assert.match(patch.js_body, /return \(?a \+ b\)?;/);
        });

        void it("unpacks a parameter with a default value", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function scale(x, factor = 2) { return x * factor; }",
                symbolId: "gml/closure/scr/scale"
            });

            assert.match(patch.js_body, /^var x = args\[0\];/m);
            assert.match(patch.js_body, /^var factor = args\[1\] === undefined \? 2 : args\[1\];/m);
            assert.match(patch.js_body, /return \(?x \* factor\)?;/);
        });

        void it("emits an empty body for a parameterless no-op function", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "function noop() { }",
                symbolId: "gml/closure/scr/noop"
            });

            // Body should be empty or whitespace only (no statements)
            assert.equal(patch.js_body.trim(), "");
        });
    });

    void describe("non-function source (bare statements)", () => {
        void it("emits a bare statement block without unwrapping", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "var result = 5 + 3;",
                symbolId: "gml/closure/scr/inline"
            });

            // The emitter may constant-fold `5 + 3` to `8` or keep the original
            // expression; either output is valid. We verify the declaration exists
            // rather than pinning to a specific arithmetic evaluation strategy.
            assert.match(patch.js_body, /var result = /);
        });

        void it("emits multiple statements as-is", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const patch = transpiler.transpileClosure({
                sourceText: "var x = 1;\nvar y = 2;",
                symbolId: "gml/closure/scr/multi"
            });

            assert.match(patch.js_body, /var x = 1;/);
            assert.match(patch.js_body, /var y = 2;/);
        });
    });

    void describe("AST reuse", () => {
        void it("accepts a pre-parsed AST to skip parsing", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            const preBuiltAst = {
                type: "Program",
                body: [
                    {
                        type: "FunctionDeclaration",
                        id: "multiply",
                        params: ["x", "y"],
                        body: {
                            type: "BlockStatement",
                            body: [
                                {
                                    type: "ReturnStatement",
                                    argument: {
                                        type: "BinaryExpression",
                                        operator: "*",
                                        left: { type: "Identifier", name: "x" },
                                        right: { type: "Identifier", name: "y" }
                                    }
                                }
                            ]
                        }
                    }
                ]
            };

            const patch = transpiler.transpileClosure({
                sourceText: "function multiply(x, y) { return x * y; }",
                symbolId: "gml/closure/scr/multiply",
                ast: preBuiltAst
            });

            assert.equal(patch.kind, "closure");
            assert.match(patch.js_body, /^var x = args\[0\];/m);
            assert.match(patch.js_body, /^var y = args\[1\];/m);
        });

        void it("rejects a non-Program AST", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileClosure({
                        sourceText: "function f() {}",
                        symbolId: "gml/closure/scr/f",
                        ast: { type: "BlockStatement", body: [] }
                    }),
                { name: "Error" }
            );
        });
    });

    void describe("input validation", () => {
        void it("throws TypeError when request is not an object", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(() => transpiler.transpileClosure(null as unknown as TranspileClosureArgs), {
                name: "TypeError"
            });
        });

        void it("throws TypeError when sourceText is missing", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileClosure({
                        symbolId: "gml/closure/scr/f"
                    } as unknown as TranspileClosureArgs),
                { name: "TypeError" }
            );
        });

        void it("throws TypeError when sourceText is empty", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileClosure({
                        sourceText: "",
                        symbolId: "gml/closure/scr/f"
                    }),
                { name: "TypeError" }
            );
        });

        void it("throws TypeError when symbolId is missing", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileClosure({
                        sourceText: "function f() {}",
                        symbolId: ""
                    }),
                { name: "TypeError" }
            );
        });

        void it("throws TypeError when sourcePath is an empty string", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileClosure({
                        sourceText: "function f() { return 1; }",
                        symbolId: "gml/closure/scr/f",
                        sourcePath: ""
                    }),
                { name: "TypeError" }
            );
        });

        void it("wraps transpilation errors with the symbolId in the message", () => {
            const transpiler = new Transpiler.GmlTranspiler();
            assert.throws(
                () =>
                    transpiler.transpileClosure({
                        sourceText: "function f() {}",
                        symbolId: "gml/closure/scr/broken",
                        ast: "not-an-object" as unknown
                    }),
                (err: unknown) => err instanceof Error && err.message.includes("gml/closure/scr/broken")
            );
        });
    });
});
