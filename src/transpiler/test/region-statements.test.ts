import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void test("GmlToJsEmitter handles RegionStatement by emitting empty string", () => {
    const source = `#region My Region
var x = 1;`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Region statements should not appear in the output
    assert.ok(!result.includes("#region"), "Should not include #region directive");
    assert.ok(result.includes("var x = 1"), "Should include variable declaration");
});

void test("GmlToJsEmitter handles EndRegionStatement by emitting empty string", () => {
    const source = `var x = 1;
#endregion`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // EndRegion statements should not appear in the output
    assert.ok(!result.includes("#endregion"), "Should not include #endregion directive");
    assert.ok(!result.includes("endregion"), "Should not include endregion text");
    assert.ok(result.includes("var x = 1"), "Should include variable declaration");
});

void test("GmlToJsEmitter handles region pair correctly", () => {
    const source = `#region Test Region
var x = 1;
var y = 2;
#endregion`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Neither region marker should appear
    assert.ok(!result.includes("#region"), "Should not include #region directive");
    assert.ok(!result.includes("#endregion"), "Should not include #endregion directive");
    // Content should be preserved
    assert.ok(result.includes("var x = 1"), "Should include first variable declaration");
    assert.ok(result.includes("var y = 2"), "Should include second variable declaration");
});

void test("GmlToJsEmitter handles nested regions correctly", () => {
    const source = `#region Outer
var a = 1;
#region Inner
var b = 2;
#endregion
var c = 3;
#endregion`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // No region markers should appear
    assert.ok(!result.includes("#region"), "Should not include any #region directives");
    assert.ok(!result.includes("#endregion"), "Should not include any #endregion directives");
    // All content should be preserved
    assert.ok(result.includes("var a = 1"), "Should include outer variable");
    assert.ok(result.includes("var b = 2"), "Should include inner variable");
    assert.ok(result.includes("var c = 3"), "Should include trailing variable");
});

void test("GmlToJsEmitter preserves code around region markers", () => {
    const source = `var before = 0;
#region Section
var inside = 1;
#endregion
var after = 2;`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Verify structure
    const lines = result.split("\n").filter((line) => line.trim().length > 0);
    assert.strictEqual(lines.length, 3, "Should have exactly 3 non-empty lines");
    assert.ok(result.includes("var before = 0"), "Should include code before region");
    assert.ok(result.includes("var inside = 1"), "Should include code inside region");
    assert.ok(result.includes("var after = 2"), "Should include code after region");
});

void test("GmlToJsEmitter handles DefineStatement for region markers", () => {
    // DefineStatement nodes can also represent region markers
    const source = `#region My Code
var x = 1;
#endregion`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Region directives should not appear in output
    assert.ok(!result.includes("#region"), "Should not include #region");
    assert.ok(!result.includes("#endregion"), "Should not include #endregion");
    assert.ok(result.includes("var x = 1"), "Should include variable declaration");
});
