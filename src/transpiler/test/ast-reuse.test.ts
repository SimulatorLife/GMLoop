/**
 * Tests for AST reuse optimization in transpileScript.
 *
 * Verifies that pre-parsed ASTs can be passed to the transpiler to avoid
 * redundant parsing, which is critical for hot-reload performance.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";

import { Transpiler } from "../index.js";

void describe("Transpiler AST reuse", () => {
    void it("accepts pre-parsed AST and produces valid patch", () => {
        const sourceText = "var x = 10;";
        const symbolId = "gml/script/test_script";

        const parser = new Parser.GMLParser(sourceText, {});
        const ast = parser.parse();

        const transpiler = new Transpiler.GmlTranspiler();
        const patch = transpiler.transpileScript({
            sourceText,
            symbolId,
            ast
        });

        assert.strictEqual(patch.kind, "script");
        assert.strictEqual(patch.id, symbolId);
        assert.ok(patch.js_body.includes("x"));
        assert.strictEqual(patch.sourceText, sourceText);
    });

    void it("produces identical output with and without pre-parsed AST", () => {
        const sourceText = `function helper_function() {
    return 42;
}`;
        const symbolId = "gml/script/helper";

        const parser = new Parser.GMLParser(sourceText, {});
        const ast = parser.parse();

        const transpiler = new Transpiler.GmlTranspiler();

        const patchWithAst = transpiler.transpileScript({
            sourceText,
            symbolId,
            ast
        });

        const patchWithoutAst = transpiler.transpileScript({
            sourceText,
            symbolId
        });

        assert.strictEqual(patchWithAst.id, patchWithoutAst.id);
        assert.strictEqual(patchWithAst.kind, patchWithoutAst.kind);
        assert.strictEqual(patchWithAst.js_body, patchWithoutAst.js_body);
        assert.strictEqual(patchWithAst.sourceText, patchWithoutAst.sourceText);
    });

    void it("handles complex GML with pre-parsed AST", () => {
        const sourceText = `function player_movement(speed) {
    if (keyboard_check(vk_left)) {
        x -= speed;
    }
    if (keyboard_check(vk_right)) {
        x += speed;
    }
    return x;
}`;
        const symbolId = "gml/script/player_movement";

        const parser = new Parser.GMLParser(sourceText, {});
        const ast = parser.parse();

        const transpiler = new Transpiler.GmlTranspiler();
        const patch = transpiler.transpileScript({
            sourceText,
            symbolId,
            ast
        });

        assert.strictEqual(patch.kind, "script");
        assert.strictEqual(patch.id, symbolId);
        assert.ok(patch.js_body.includes("keyboard_check"));
        assert.ok(patch.js_body.includes("vk_left"));
        assert.ok(patch.js_body.includes("vk_right"));
    });

    void it("falls back to parsing when AST is not provided", () => {
        const sourceText = "var y = 20;";
        const symbolId = "gml/script/fallback_test";

        const transpiler = new Transpiler.GmlTranspiler();
        const patch = transpiler.transpileScript({
            sourceText,
            symbolId
        });

        assert.strictEqual(patch.kind, "script");
        assert.strictEqual(patch.id, symbolId);
        assert.ok(patch.js_body.includes("y"));
    });

    void it("uses a provided AST without re-parsing sourceText", () => {
        const transpiler = new Transpiler.GmlTranspiler();
        assert.throws(() => Parser.GMLParser.parse("invalid syntax %%%%"));

        const patch = transpiler.transpileScript({
            sourceText: "invalid syntax %%%%",
            symbolId: "gml/script/ast_only",
            ast: {
                type: "Program",
                body: [
                    {
                        type: "ExpressionStatement",
                        expression: {
                            type: "AssignmentExpression",
                            operator: "=",
                            left: { type: "Identifier", name: "score" },
                            right: { type: "Literal", value: 100 }
                        }
                    }
                ]
            }
        });

        assert.strictEqual(patch.kind, "script");
        assert.match(patch.js_body, /score = 100;/);
    });
});
