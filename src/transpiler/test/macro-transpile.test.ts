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

    void it("preserves macro values at end of file", () => {
        const source = "#macro END_OF_FILE 123";
        const ast = Parser.GMLParser.parse(source);
        const definitions = Transpiler.extractMacroDefinitionsFromAst(ast, "/project/eof.gml", source);

        assert.equal(definitions.get("END_OF_FILE")?.value, "123");
    });

    void it("expands function-like define macros with argument expressions", () => {
        const source = `#define SQUARE(_value) ((_value) * (_value))
function square_value(value) {
    return SQUARE(value + 1);
}`;
        const ast = Parser.GMLParser.parse(source);
        const definitions = Transpiler.extractMacroDefinitionsFromAst(ast, "/project/function-macro.gml", source);
        const patch = new Transpiler.GmlTranspiler().transpileScript({
            sourceText: source,
            symbolId: "gml/script/square_value",
            ast,
            macroDefinitions: definitions
        });

        assert.equal(definitions.get("SQUARE")?.parameters.length, 1);
        assert.ok(patch.js_body.includes("value + 1"));
        assert.ok(!patch.js_body.includes("SQUARE"));
    });

    void it("finds direct macro references in chained definitions", () => {
        const source = `#macro BASE_VALUE 4
#macro DERIVED_VALUE BASE_VALUE + 1`;
        const ast = Parser.GMLParser.parse(source);
        const definitions = Transpiler.extractMacroDefinitionsFromAst(ast, "/project/chained.gml", source);

        assert.deepEqual(Transpiler.extractMacroReferencesFromAst(ast, definitions), ["BASE_VALUE"]);
    });

    void it("detects replacement and ownership changes even when names remain", () => {
        const firstSource = "#macro VALUE 1";
        const secondSource = "#macro VALUE 2";
        const firstAst = Parser.GMLParser.parse(firstSource);
        const secondAst = Parser.GMLParser.parse(secondSource);
        const first = Transpiler.extractMacroDefinitionsFromAst(firstAst, "/project/a.gml", firstSource);
        const second = Transpiler.extractMacroDefinitionsFromAst(secondAst, "/project/a.gml", secondSource);

        assert.deepEqual(Transpiler.findChangedMacroDefinitionNames(first, second), ["VALUE"]);
    });

    void it("expands project macros before a script patch is emitted", () => {
        const source = `#macro SHARED_VALUE 4
function use_shared_value() {
    return SHARED_VALUE;
}`;
        const ast = Parser.GMLParser.parse(source);
        const definitions = Transpiler.extractMacroDefinitionsFromAst(ast, "/project/constants.gml", source);
        const patch = new Transpiler.GmlTranspiler().transpileScript({
            sourceText: source,
            symbolId: "gml/script/use_shared_value",
            ast,
            macroDefinitions: definitions
        });

        assert.ok(patch.js_body.includes("return 4"));
    });

    void it("expands statement macros into the surrounding statement list", () => {
        const source = `#macro EARLY_RETURN if (should_return) { return true; }
function maybe_return() {
    EARLY_RETURN
    return false;
}`;
        const ast = Parser.GMLParser.parse(source);
        const definitions = Transpiler.extractMacroDefinitionsFromAst(ast, "/project/guards.gml", source);
        const patch = new Transpiler.GmlTranspiler().transpileScript({
            sourceText: source,
            symbolId: "gml/script/maybe_return",
            ast,
            macroDefinitions: definitions
        });

        assert.ok(!patch.js_body.includes("EARLY_RETURN"));
        assert.ok(patch.js_body.includes("should_return"));
        assert.ok(patch.js_body.includes("return true"));
    });
});
