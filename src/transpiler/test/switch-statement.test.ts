import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void test("GmlToJsEmitter handles switch with fall-through cases", () => {
    const source = `switch (value) {
    case 1:
    case 2:
        show_debug_message("One or two");
        break;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Fall-through cases should be on separate lines without body
    assert.ok(result.includes("case 1:\ncase 2:"), "Should have fall-through cases on separate lines");
    // Break should have a semicolon
    assert.ok(result.includes("break;"), "Break statement should have semicolon");
    assert.ok(!result.includes("break\n"), "Break should not be without semicolon");
});

void test("GmlToJsEmitter adds semicolons to break statements", () => {
    const source = `switch (x) {
    case 1:
        break;
    case 2:
        break;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // All break statements should have semicolons
    const breakCount = (result.match(/break;/g) ?? []).length;
    assert.strictEqual(breakCount, 2, "Should have 2 break statements with semicolons");
    assert.ok(!result.includes("break\n"), "Should not have break without semicolon");
});

void test("GmlToJsEmitter adds semicolons to continue statements in switch", () => {
    const source = `switch (x) {
    case 1:
        continue;
    case 2:
        continue;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // All continue statements should have semicolons
    const continueCount = (result.match(/continue;/g) ?? []).length;
    assert.strictEqual(continueCount, 2, "Should have 2 continue statements with semicolons");
});

void test("GmlToJsEmitter handles switch with default case", () => {
    const source = `switch (value) {
    case 1:
        x = 1;
        break;
    default:
        x = 0;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("default:"), "Should include default case");
    assert.ok(result.includes("x = 0;"), "Should include default case body");
});

void test("GmlToJsEmitter handles switch with multiple statements per case", () => {
    const source = `switch (value) {
    case 1:
        x = 1;
        y = 2;
        z = 3;
        break;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("x = 1;"), "Should include first statement");
    assert.ok(result.includes("y = 2;"), "Should include second statement");
    assert.ok(result.includes("z = 3;"), "Should include third statement");
    assert.ok(result.includes("break;"), "Should include break with semicolon");
});

void test("GmlToJsEmitter handles switch with block statement in case", () => {
    const source = `switch (value) {
    case 1: {
        var temp = 1;
        show_debug_message(temp);
        break;
    }
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("case 1:"), "Should include case label");
    assert.ok(result.includes("var temp = 1;"), "Should include variable declaration");
    // Block statement should end with }
    assert.ok(result.includes("}"), "Should include closing brace");
});

void test("GmlToJsEmitter handles switch with return statements", () => {
    const source = `switch (value) {
    case 1:
        return "one";
    case 2:
        return "two";
    default:
        return "other";
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes('return "one";'), "Should include first return");
    assert.ok(result.includes('return "two";'), "Should include second return");
    assert.ok(result.includes('return "other";'), "Should include default return");
});

void test("GmlToJsEmitter handles empty switch", () => {
    const source = `switch (value) {}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("switch (value)"), "Should include switch statement");
    // Empty switch may have whitespace between braces
    assert.match(result, /switch.*\{[\s\n]*\}/s, "Should have empty or whitespace-only body");
});

void test("GmlToJsEmitter handles switch with only fall-through cases", () => {
    const source = `switch (value) {
    case 1:
    case 2:
    case 3:
        show_debug_message("Multiple");
        break;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // All fall-through cases should be present
    assert.ok(result.includes("case 1:"), "Should include case 1");
    assert.ok(result.includes("case 2:"), "Should include case 2");
    assert.ok(result.includes("case 3:"), "Should include case 3");
    // Body should only appear once
    const bodyCount = (result.match(/show_debug_message/g) ?? []).length;
    assert.strictEqual(bodyCount, 1, "Should have exactly one show_debug_message call");
});

void test("GmlToJsEmitter handles switch with expression in discriminant", () => {
    const source = `switch (x + y * 2) {
    case 1:
        break;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Expression should be in switch discriminant
    assert.ok(result.includes("switch"), "Should have switch statement");
    assert.ok(result.includes("x") && result.includes("y"), "Should include variables from expression");
});

void test("GmlToJsEmitter handles switch with case expression calculations", () => {
    const source = `switch (value) {
    case 1 + 1:
        x = 2;
        break;
    case 5 * 2:
        x = 10;
        break;
}`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Note: Depending on how the parser represents literals, constant folding may or may not occur
    // The important thing is that the transpiler handles both cases correctly
    assert.ok(
        result.includes("case 2:") ||
            result.includes("case (1 + 1):") ||
            result.includes("case 1 + 1:") ||
            result.includes('case "'),
        "Should include first case (either folded or unfolded)"
    );
    assert.ok(
        result.includes("case 10:") ||
            result.includes("case (5 * 2):") ||
            result.includes("case 5 * 2:") ||
            result.includes('case "'),
        "Should include second case (either folded or unfolded)"
    );
});
