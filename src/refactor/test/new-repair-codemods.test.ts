import assert from "node:assert";
import { test } from "node:test";

import { Refactor } from "../src/index.js";

const { applyRepairLogicalNotCodemod } = Refactor.RepairLogicalNot;
const { applyRepairArgumentSeparatorsCodemod } = Refactor.RepairArgumentSeparators;
const { applyRepairUppercaseOperatorsCodemod } = Refactor.RepairUppercaseOperators;

test("repairLogicalNot codemod", () => {
    // Lowercase and uppercase operators should be repaired
    assert.strictEqual(applyRepairLogicalNotCodemod("if (not left) {}").outputText, "if (! left) {}");
    assert.strictEqual(applyRepairLogicalNotCodemod("if (NOT left) {}").outputText, "if (! left) {}");

    // Comments, strings, macro declarations, and call expressions should be preserved
    assert.strictEqual(applyRepairLogicalNotCodemod("var not = 1;").outputText, "var not = 1;");
    assert.strictEqual(applyRepairLogicalNotCodemod("called = not(value);").outputText, "called = not(value);");
    assert.strictEqual(
        applyRepairLogicalNotCodemod("// this is not a comment to rewrite").outputText,
        "// this is not a comment to rewrite"
    );
    assert.strictEqual(applyRepairLogicalNotCodemod('var s = "not a string";').outputText, 'var s = "not a string";');
    assert.strictEqual(applyRepairLogicalNotCodemod("#macro not 1\nval = not;").outputText, "#macro not 1\nval = not;");
});

test("repairArgumentSeparators codemod", () => {
    // Missing argument separators should be repaired
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a b c)").outputText, "foo(a, b, c)");
    // Comments, strings, and standard layouts should be preserved
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a, b, c)").outputText, "foo(a, b, c)");
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("if (a b) {}").outputText, "if (a b) {}");
});

test("repairUppercaseOperators codemod", () => {
    // Uppercase operator aliases should be repaired to canonical forms
    assert.strictEqual(
        applyRepairUppercaseOperatorsCodemod("if (left AND right) {}").outputText,
        "if (left && right) {}"
    );
    assert.strictEqual(
        applyRepairUppercaseOperatorsCodemod("if (left OR right) {}").outputText,
        "if (left || right) {}"
    );
    assert.strictEqual(
        applyRepairUppercaseOperatorsCodemod("if (left XOR right) {}").outputText,
        "if (left ^^ right) {}"
    );
    assert.strictEqual(applyRepairUppercaseOperatorsCodemod("a DIV b").outputText, "a div b");
    assert.strictEqual(applyRepairUppercaseOperatorsCodemod("a MOD b").outputText, "a % b");

    // Lowercase operators should be preserved
    assert.strictEqual(
        applyRepairUppercaseOperatorsCodemod("if (left and right) {}").outputText,
        "if (left and right) {}"
    );
    assert.strictEqual(
        applyRepairUppercaseOperatorsCodemod("if (left or right) {}").outputText,
        "if (left or right) {}"
    );
});
