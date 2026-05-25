import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void describe("Transpiler.emitJavaScript macro handling", () => {
    void it("converts macro declarations to const declarations", () => {
        const source = "#macro TEST_VALUE 123";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.strictEqual(js.trim(), "const TEST_VALUE = 123;");
    });

    void it("handles string macro values", () => {
        const source = '#macro MESSAGE "hello world"';
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.strictEqual(js.trim(), 'const MESSAGE = "hello world";');
    });

    void it("handles multi-token macro values", () => {
        const source = "#macro CONFIG_PATH global.config";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.strictEqual(js.trim(), "const CONFIG_PATH = global.config;");
    });
});
