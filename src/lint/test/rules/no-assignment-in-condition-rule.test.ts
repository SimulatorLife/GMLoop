import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("no-assignment-in-condition rewrites a simple `if` header assignment", () => {
    const input = "if (x = 1) { return; }\n";
    const expected = "if (x == 1) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0]?.messageId, "noAssignmentInCondition");
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition rewrites an assignment that follows a function call", () => {
    // The previous implementation used `[^)]*` for the condition body, which
    // stopped at the first `)` and therefore could not detect the
    // assignment that lives *after* the call. The generalized helper uses
    // paren counting so the entire condition expression is considered.
    const input = "if (foo(bar) = 1) { return; }\n";
    const expected = "if (foo(bar) == 1) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition rewrites an assignment inside a multi-argument function call", () => {
    const input = "if (max(0, x) = 1) { return; }\n";
    const expected = "if (max(0, x) == 1) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition rewrites an assignment whose RHS is a function call", () => {
    const input = "if (x = func()) { return; }\n";
    const expected = "if (x == func()) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition rewrites a `while` header with nested parens", () => {
    const input = "while (compute() = 0) { return; }\n";
    const expected = "while (compute() == 0) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition rewrites a single-line `do until` header with nested parens", () => {
    // The `do until` keyword pair is matched as a single unit; the helper
    // still tracks paren depth to find the matching close paren even when
    // the condition contains a function call.
    const input = "do until (foo(bar) = 1) { return; }\n";
    const expected = "do until (foo(bar) == 1) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition does not count parens that appear inside a string literal", () => {
    // The string contains `)` characters; they must not be treated as the
    // condition's close paren. The existing behaviour for a literal `==`
    // comparison is preserved.
    const input = 'if (x == "test)") { return; }\n';

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-assignment-in-condition preserves an existing `==` comparison inside a function call", () => {
    const input = "if (foo(bar) == 1) { return; }\n";

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-assignment-in-condition does not rewrite a grouped multiline condition without assignments", () => {
    // Regression for the existing behaviour: an `if` header whose opening
    // paren sits on one line and the matching close paren sits several
    // lines later should be left untouched, because the rule operates on
    // a single line at a time.
    const input = [
        "if ((_index == undefined)",
        "||  (_index < 0)",
        "||  (_index >= array_length(_global.__gamepads)))",
        "{",
        "    return;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});
