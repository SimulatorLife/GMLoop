import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

import type { CallExpressionNode } from "../src/emitter/ast.js";

/**
 * Helper function to create a mock CallExpressionNode for testing.
 * Reduces duplication and improves type safety in tests.
 */
function createMockCallExpression(calleeName: string): CallExpressionNode {
    return {
        type: "CallExpression" as const,
        object: { name: calleeName },
        arguments: []
    } as unknown as CallExpressionNode;
}

void test("createSemanticOracle returns an oracle with both interfaces", () => {
    const oracle = Transpiler.createSemanticOracle();

    assert.ok(typeof oracle.kindOfIdent === "function");
    assert.ok(typeof oracle.nameOfIdent === "function");
    assert.ok(typeof oracle.qualifiedSymbol === "function");
    assert.ok(typeof oracle.callTargetKind === "function");
    assert.ok(typeof oracle.callTargetSymbol === "function");
});

void test("createSemanticOracle classifies built-in functions correctly", () => {
    const oracle = Transpiler.createSemanticOracle();

    const builtinNode = createMockCallExpression("abs");
    const kind = oracle.callTargetKind(builtinNode);

    assert.equal(kind, "builtin", "Should classify abs as a builtin");
});

void test("createSemanticOracle with script names classifies scripts", () => {
    const scriptNames = new Set(["scr_player_move", "scr_enemy_ai"]);
    const oracle = Transpiler.createSemanticOracle({ scriptNames });

    const scriptNode = createMockCallExpression("scr_player_move");
    const kind = oracle.callTargetKind(scriptNode);

    assert.equal(kind, "script", "Should classify scr_player_move as a script");
});

void test("createSemanticOracle generates SCIP symbols for scripts", () => {
    const scriptNames = new Set(["scr_test"]);
    const oracle = Transpiler.createSemanticOracle({ scriptNames });

    const scriptNode = {
        type: "CallExpression" as const,
        object: { name: "scr_test" },
        arguments: []
    };
    const symbol = oracle.callTargetSymbol(scriptNode as unknown as CallExpressionNode);

    assert.ok(symbol, "Should generate a symbol");
    assert.ok(symbol.includes("script"), "Symbol should include 'script'");
    assert.ok(symbol.includes("scr_test"), "Symbol should include script name");
});

void test("createSemanticOracle handles unknown call targets", () => {
    const oracle = Transpiler.createSemanticOracle();

    const unknownNode = {
        type: "CallExpression" as const,
        object: { name: "unknown_function" },
        arguments: []
    };
    const kind = oracle.callTargetKind(unknownNode as unknown as CallExpressionNode);

    assert.equal(kind, "unknown", "Should classify unknown functions as unknown");
});

void test("emitJavaScript uses semantic oracle for built-in classification", () => {
    const source = "abs(-5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // With semantic oracle, abs should be recognized as a builtin
    assert.ok(result.includes("abs"), "Should include abs function call");
});

void test("emitJavaScript with custom oracle classifies scripts", () => {
    const source = "scr_custom()";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();

    const oracle = Transpiler.createSemanticOracle({
        scriptNames: new Set(["scr_custom"])
    });

    const result = Transpiler.emitJavaScript(ast, oracle);

    // Script calls should go through the runtime wrapper
    assert.ok(result.includes("__call_script"), "Should use script wrapper");
    assert.ok(result.includes("scr_custom"), "Should reference script name");
});

void test("createSemanticOracle creates oracle with builtin knowledge", () => {
    const oracle = Transpiler.createSemanticOracle();

    const builtinNode = {
        type: "CallExpression" as const,
        object: { name: "sqrt" },
        arguments: []
    };
    const kind = oracle.callTargetKind(builtinNode as unknown as CallExpressionNode);

    assert.equal(kind, "builtin", "Should recognize sqrt as builtin");
});

void test("createSemanticOracle can opt out of builtin classification", () => {
    const oracle = Transpiler.createSemanticOracle({ builtinNames: new Set<string>() });

    const builtinNode = {
        type: "CallExpression" as const,
        object: { name: "sqrt" },
        arguments: []
    };
    const kind = oracle.callTargetKind(builtinNode as unknown as CallExpressionNode);

    assert.equal(kind, "unknown", "Empty builtin set should classify sqrt as unknown");
});

void test("semantic oracle identifies global variables", () => {
    const oracle = Transpiler.createSemanticOracle();

    const globalNode = { name: "test_var", isGlobalIdentifier: true };
    const kind = oracle.kindOfIdent(globalNode);

    assert.equal(kind, "global_field", "Should classify marked globals as global_field");
});

void test("semantic oracle generates SCIP symbols for globals", () => {
    const oracle = Transpiler.createSemanticOracle();

    const globalNode = { name: "player_health", isGlobalIdentifier: true };
    const symbol = oracle.qualifiedSymbol(globalNode);

    assert.ok(symbol, "Should generate a symbol for globals");
    assert.ok(symbol.includes("var"), "Symbol should indicate variable");
    assert.ok(symbol.includes("global"), "Symbol should indicate global scope");
});

void test("emitJavaScript with semantic oracle handles global variables", () => {
    const source = "global.player_score = 100";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Global variables should be prefixed with global.
    assert.ok(result.includes("global.player_score"), "Should prefix global variables");
});

void test("semantic oracle handles identifiers with no name", () => {
    const oracle = Transpiler.createSemanticOracle();

    const emptyNode = { name: "" };
    const kind = oracle.kindOfIdent(emptyNode);

    assert.equal(kind, "local", "Should default to local for empty names");
});

void test("semantic oracle handles null identifiers", () => {
    const oracle = Transpiler.createSemanticOracle();

    const kind = oracle.kindOfIdent(null);

    assert.equal(kind, "local", "Should default to local for null nodes");
});

void test("semantic oracle nameOfIdent extracts name correctly", () => {
    const oracle = Transpiler.createSemanticOracle();

    const node = { name: "test_variable" };
    const name = oracle.nameOfIdent(node);

    assert.equal(name, "test_variable", "Should extract name from node");
});

void test("semantic oracle nameOfIdent handles null gracefully", () => {
    const oracle = Transpiler.createSemanticOracle();

    const name = oracle.nameOfIdent(null);

    assert.equal(name, "", "Should return empty string for null");
});
