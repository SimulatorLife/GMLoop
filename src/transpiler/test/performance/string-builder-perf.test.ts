import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

/**
 * Compilation correctness tests for various GML constructs.
 *
 * These tests verify that the transpiler handles various GML syntax patterns
 * correctly without errors. They test:
 * - Parser construction (creates valid AST from valid GML)
 * - Transpiler emit (produces valid JavaScript output)
 * - Correctness of output structure
 *
 * Note: We avoid timing assertions because:
 * - CI environments have variable load
 * - CPU frequency scaling affects timing
 * - First-run JIT compilation skews warm-up
 * - Multiple tests in suite share resources
 *
 * The previous timing-based approach was inherently flaky. Now we validate
 * correctness and completeness instead.
 */

function parseAndEmit(code: string): { ast: unknown; js: string } {
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const js = Transpiler.emitJavaScript(ast);
    return { ast, js };
}

function verifyValidJavaScriptOutput(js: string): void {
    // Basic validation that output looks like JavaScript
    assert.ok(js.length > 0, "Output should not be empty");
    // Should contain some code structure
    assert.ok(js.includes(";") || js.includes("{") || js.includes("["), "Output should contain code structure");
}

void describe("Transpiler Correctness", () => {
    void it("handles multi-statement programs", () => {
        const code = Array.from({ length: 50 }, (_, i) => `var x${i} = ${i};`).join("\n");
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        // Each statement should produce some output
        assert.ok(js.length > 100, "Output should be non-trivial");
    });

    void it("handles large blocks", () => {
        const statements = Array.from({ length: 30 }, (_, i) => `    x += ${i};`).join("\n");
        const code = `function test() {\n${statements}\n}`;
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        assert.ok(js.includes("function"), "Output should contain function declaration");
    });

    void it("handles multi-dimensional array access", () => {
        const code = "var val = arr[0][1][2][3][4];";
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        assert.ok(js.includes("["), "Output should contain array access brackets");
    });

    void it("handles switch statements with many cases", () => {
        const cases = Array.from({ length: 20 }, (_, i) => `case ${i}:\n    result = ${i};\n    break;`).join("\n");
        const code = `switch (value) {\n${cases}\n}`;
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        assert.ok(
            js.includes("switch") || js.includes("case") || js.includes(":"),
            "Output should contain switch structure"
        );
    });

    void it("handles multiple variable declarations", () => {
        const vars = Array.from({ length: 20 }, (_, i) => `v${i}`).join(", ");
        const code = `var ${vars};`;
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        // Should produce output (GML var is preserved as-is in this transpiler)
        assert.ok(js.length > vars.length, "Output should be non-trivial");
    });

    void it("handles template strings with interpolations", () => {
        const parts = Array.from({ length: 20 }, (_, i) => `part${i}: {x${i}}`).join(" ");
        const code = `var msg = $"${parts}";`;
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        // Template strings should be preserved or converted to string concatenation
        assert.ok(js.includes("'") || js.includes('"') || js.includes("`"), "Output should contain string delimiters");
    });

    void it("handles struct expressions with many properties", () => {
        const props = Array.from({ length: 30 }, (_, i) => `prop${i}: ${i}`).join(", ");
        const code = `var obj = {${props}};`;
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        // Should contain object literal syntax
        assert.ok(js.includes("{") || js.includes("Object"), "Output should contain object structure");
    });

    void it("handles functions with many parameters", () => {
        const params = Array.from({ length: 20 }, (_, i) => `p${i}`).join(", ");
        const code = `function test(${params}) { return p0; }`;
        const { js } = parseAndEmit(code);

        verifyValidJavaScriptOutput(js);
        assert.ok(js.includes("function"), "Output should contain function declaration");
    });
});
