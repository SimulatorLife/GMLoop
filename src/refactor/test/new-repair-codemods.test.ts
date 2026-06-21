import assert from "node:assert";
import { test } from "node:test";

import { type PartialSemanticAnalyzer, Refactor } from "../src/index.js";

const { applyRepairLogicalNotCodemod } = Refactor.RepairLogicalNot;
const { applyRepairArgumentSeparatorsCodemod } = Refactor.RepairArgumentSeparators;

test("repairLogicalNot codemod", async () => {
    // Lowercase and uppercase operators should be repaired
    assert.strictEqual((await applyRepairLogicalNotCodemod("if (not left) {}")).outputText, "if (! left) {}");
    assert.strictEqual((await applyRepairLogicalNotCodemod("if (NOT left) {}")).outputText, "if (! left) {}");

    // Comments, strings, macro declarations, and call expressions should be preserved
    assert.strictEqual((await applyRepairLogicalNotCodemod("var not = 1;")).outputText, "var not = 1;");
    assert.strictEqual((await applyRepairLogicalNotCodemod("called = not(value);")).outputText, "called = not(value);");
    assert.strictEqual(
        (await applyRepairLogicalNotCodemod("// this is not a comment to rewrite")).outputText,
        "// this is not a comment to rewrite"
    );
    assert.strictEqual(
        (await applyRepairLogicalNotCodemod('var s = "not a string";')).outputText,
        'var s = "not a string";'
    );
    assert.strictEqual(
        (await applyRepairLogicalNotCodemod("#macro not 1\nval = not;")).outputText,
        "#macro not 1\nval = not;"
    );
});

test("repairLogicalNot codemod preserves user-defined 'not' / 'NOT' symbols from semantic index", async () => {
    const mockSemantic: PartialSemanticAnalyzer = {
        resolveSymbolId(name: string) {
            if (name === "NOT" || name === "not") {
                return "some-symbol-id";
            }
            return null;
        }
    };

    // If 'NOT' is user-defined in project, it should not be rewritten
    const result1 = await applyRepairLogicalNotCodemod("if (NOT left) {}", mockSemantic);
    assert.strictEqual(result1.outputText, "if (NOT left) {}");

    // If 'not' (lowercase) is user-defined, it should not be rewritten
    const result2 = await applyRepairLogicalNotCodemod("if (not left) {}", mockSemantic);
    assert.strictEqual(result2.outputText, "if (not left) {}");

    // Other casings not in index (like 'Not') should still be rewritten unless in index
    const result3 = await applyRepairLogicalNotCodemod("if (Not left) {}", mockSemantic);
    assert.strictEqual(result3.outputText, "if (! left) {}");
});

test("repairArgumentSeparators codemod", () => {
    // Missing argument separators should be repaired
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a b c)").outputText, "foo(a, b, c)");
    // Comments, strings, and standard layouts should be preserved
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a, b, c)").outputText, "foo(a, b, c)");
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("if (a b) {}").outputText, "if (a b) {}");
});
