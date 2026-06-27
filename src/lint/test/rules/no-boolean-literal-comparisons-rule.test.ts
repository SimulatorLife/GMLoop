import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

function lintNoBooleanLiteralComparisons(sourceText: string): ReturnType<typeof lintWithRule> {
    return lintWithRule("no-boolean-literal-comparisons", sourceText, {});
}

void test("no-boolean-literal-comparisons removes comparisons that are equivalent to the expression", () => {
    const input = [
        "if (ready == true) { run(); }",
        "if (true == ready) { run(); }",
        "if (ready != false) { run(); }",
        ""
    ].join("\n");
    const expected = ["if (ready) { run(); }", "if (ready) { run(); }", "if (ready) { run(); }", ""].join("\n");

    const result = lintNoBooleanLiteralComparisons(input);

    assertEquals(result.messages.length, 3);
    assertEquals(result.messages[0]?.messageId, "noBooleanLiteralComparisons");
    assertEquals(result.output, expected);
});

void test("no-boolean-literal-comparisons negates comparisons that are opposite to the expression", () => {
    const input = [
        "if (ready == false) { stop(); }",
        "if (false == ready) { stop(); }",
        "if (ready != true) { stop(); }",
        ""
    ].join("\n");
    const expected = ["if (!ready) { stop(); }", "if (!ready) { stop(); }", "if (!ready) { stop(); }", ""].join("\n");

    const result = lintNoBooleanLiteralComparisons(input);

    assertEquals(result.messages.length, 3);
    assertEquals(result.output, expected);
});

void test("no-boolean-literal-comparisons handles parenthesized, member, and call expressions", () => {
    const input = [
        "if ((ready && enabled) == false) { stop(); }",
        "if (player.ready == true) { run(); }",
        "if (is_ready() != true) { stop(); }",
        ""
    ].join("\n");
    const expected = [
        "if (!(ready && enabled)) { stop(); }",
        "if (player.ready) { run(); }",
        "if (!is_ready()) { stop(); }",
        ""
    ].join("\n");

    const result = lintNoBooleanLiteralComparisons(input);

    assertEquals(result.messages.length, 3);
    assertEquals(result.output, expected);
});

void test("no-boolean-literal-comparisons ignores non-candidate comparisons", () => {
    const input = [
        'if (true == false) { show_debug_message("constant"); }',
        "if (ready == enabled) { run(); }",
        "if (count == 1) { run(); }",
        ""
    ].join("\n");

    const result = lintNoBooleanLiteralComparisons(input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-boolean-literal-comparisons skips comment-bearing comparison ranges", () => {
    const input = [
        "if (ready /* domain note */ == true) { run(); }",
        "if (ready == /* domain note */ false) { stop(); }",
        ""
    ].join("\n");

    const result = lintNoBooleanLiteralComparisons(input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-boolean-literal-comparisons converges after one autofix pass", () => {
    const input = "if (ready == true) { run(); }\n";
    const expected = "if (ready) { run(); }\n";

    const firstPass = lintNoBooleanLiteralComparisons(input);
    const secondPass = lintNoBooleanLiteralComparisons(firstPass.output);

    assertEquals(firstPass.output, expected);
    assertEquals(secondPass.messages.length, 0);
    assertEquals(secondPass.output, expected);
});

void test("optimize-logical-flow no longer owns boolean literal comparison cleanup", () => {
    const input = [
        "if (ready == true) { run(); }",
        "if (ready != false) { run(); }",
        "if (ready == false) { stop(); }",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});
