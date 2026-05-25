import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void describe("Transpiler.emitJavaScript empty statement handling", () => {
    void it("handles empty statements (represented as null in AST)", () => {
        const source = "x = 1;\n;\ny = 2;";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        // Empty statements (null in AST) should be filtered out by joinTruthy
        // The result should contain the two assignments
        assert.ok(js.includes("x = 1"));
        assert.ok(js.includes("y = 2"));

        // There should be no empty statements in output
        const lines = js.split("\n").filter((line) => line.trim().length > 0);
        assert.strictEqual(lines.length, 2, "Should only have two non-empty lines");
    });

    void it("handles multiple consecutive empty statements", () => {
        const source = ";;;\nx = 1;\n;;;";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        // Should only contain the one assignment
        assert.ok(js.includes("x = 1"));
        const lines = js.split("\n").filter((line) => line.trim().length > 0);
        assert.strictEqual(lines.length, 1, "Should only have one non-empty line");
    });
});
