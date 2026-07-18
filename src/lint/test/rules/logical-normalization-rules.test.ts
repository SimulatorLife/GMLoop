import assert from "node:assert/strict";
import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

const cases = [
    ["no-double-negation", "var ready = !!condition;\n", "var ready = condition;\n"],
    ["prefer-de-morgan", "var ready = !(a && b);\n", "var ready = !a || !b;\n"],
    ["no-redundant-negation-parentheses", "var ready = !((condition));\n", "var ready = !condition;\n"],
    ["no-redundant-logical-operands", "var ready = true && condition;\n", "var ready = condition;\n"],
    ["no-logical-absorption", "var ready = condition || (condition && fallback);\n", "var ready = condition;\n"],
    ["prefer-logical-factorization", "var ready = (a && b) || (a && c);\n", "var ready = a && (b || c);\n"],
    ["no-logical-complements", "var ready = (a && b) || (a && !b);\n", "var ready = a;\n"],
    ["prefer-logical-xor", "var ready = (a && !b) || (!a && b);\n", "var ready = (a || b) && !(a && b);\n"],
    [
        "prefer-conditional-assignment",
        "if (condition) { value = a; } else { value = b; }\n",
        "value = condition ? a : b;\n"
    ]
] as const;

for (const [ruleName, input, expected] of cases) {
    void test(`${ruleName} owns one logical rewrite`, () => {
        const result = lintWithRule(ruleName, input, {});

        assert.equal(result.messages.length, 1);
        assertEquals(result.output, expected);
    });
}

void test("focused logical rules do not cross-own another rule's rewrite", () => {
    const input = "var ready = !(a && b);\n";
    const result = lintWithRule("no-double-negation", input, {});

    assert.equal(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("focused logical rules skip comment-bearing expressions", () => {
    const input = "var ready = true && condition /* preserve this comment */;\n";
    const result = lintWithRule("no-redundant-logical-operands", input, {});

    assert.equal(result.messages.length, 0);
    assertEquals(result.output, input);
});
