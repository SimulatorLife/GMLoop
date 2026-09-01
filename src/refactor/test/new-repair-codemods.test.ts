import assert from "node:assert";
import { test } from "node:test";

import { type PartialSemanticAnalyzer, Refactor } from "../src/index.js";

const { applyRepairLogicalNotCodemod } = Refactor.RepairLogicalNot;
const { applyRepairArgumentSeparatorsCodemod } = Refactor.RepairArgumentSeparators;

void test("repairLogicalNot codemod", async () => {
    // Lowercase and uppercase operators should be repaired
    const r1 = await applyRepairLogicalNotCodemod("if (not left) {}");
    assert.strictEqual(r1.outputText, "if (! left) {}");

    const r2 = await applyRepairLogicalNotCodemod("if (NOT left) {}");
    assert.strictEqual(r2.outputText, "if (! left) {}");

    // Comments, strings, macro declarations, and call expressions should be preserved
    const r3 = await applyRepairLogicalNotCodemod("var not = 1;");
    assert.strictEqual(r3.outputText, "var not = 1;");

    const r4 = await applyRepairLogicalNotCodemod("called = not(value);");
    assert.strictEqual(r4.outputText, "called = not(value);");

    const r5 = await applyRepairLogicalNotCodemod("// this is not a comment to rewrite");
    assert.strictEqual(r5.outputText, "// this is not a comment to rewrite");

    const r6 = await applyRepairLogicalNotCodemod('var s = "not a string";');
    assert.strictEqual(r6.outputText, 'var s = "not a string";');

    const r7 = await applyRepairLogicalNotCodemod("#macro not 1\nval = not;");
    assert.strictEqual(r7.outputText, "#macro not 1\nval = not;");
});

void test("repairLogicalNot codemod preserves user-defined 'not' / 'NOT' symbols from semantic index", async () => {
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

void test("repairArgumentSeparators codemod", () => {
    // Missing argument separators should be repaired
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a b c)").outputText, "foo(a, b, c)");
    // Comments, strings, and standard layouts should be preserved
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a, b, c)").outputText, "foo(a, b, c)");
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("if (a b) {}").outputText, "if (a b) {}");

    // Constructor/New instantiations, binary operators, prefix operators should not insert commas
    assert.strictEqual(
        applyRepairArgumentSeparatorsCodemod("ai.set_target(new TargetInstance(plyr_inst, false, true, false));")
            .outputText,
        "ai.set_target(new TargetInstance(plyr_inst, false, true, false));"
    );
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a and b)").outputText, "foo(a and b)");
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(a div b)").outputText, "foo(a div b)");
    assert.strictEqual(applyRepairArgumentSeparatorsCodemod("foo(not a)").outputText, "foo(not a)");
});

void test("repairArgumentSeparators codemod preserves comments, strings, and region directives", () => {
    const examples = [
        "#region Shared functions (this is only overwritten for the dynamic)",
        "\t#region Shared functions (this is only overwritten for the dynamic)",
        "// Shared functions (this is only overwritten for the dynamic)",
        "/// Shared functions (this is only overwritten for the dynamic)",
        "/* Shared functions (this is only overwritten for the dynamic) */",
        'var note = "Shared functions (this is only overwritten for the dynamic)";'
    ];

    for (const sourceText of examples) {
        assert.strictEqual(applyRepairArgumentSeparatorsCodemod(sourceText).outputText, sourceText);
    }

    assert.strictEqual(
        applyRepairArgumentSeparatorsCodemod(
            "#region Shared functions (this is only overwritten for the dynamic)\nfoo(a b c)\n#endregion"
        ).outputText,
        "#region Shared functions (this is only overwritten for the dynamic)\nfoo(a, b, c)\n#endregion"
    );
});
