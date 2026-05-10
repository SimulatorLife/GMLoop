import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { runGmlRule } from "./rule-test-harness.js";

function runNoEmptyCommentsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["no-empty-comments"],
        code,
        programNode: { type: "Program" }
    });
}

void test("no-empty-comments removes a bare // line", () => {
    const input = ['show_debug_message("hello");', "//", "value = 1;", ""].join("\n");
    const expected = ['show_debug_message("hello");', "value = 1;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("no-empty-comments removes a // line with trailing spaces", () => {
    const input = ["a = 1;", "//   ", "b = 2;", ""].join("\n");
    const expected = ["a = 1;", "b = 2;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("no-empty-comments removes an empty block comment on its own line", () => {
    const input = ["a = 1;", "/** */", "b = 2;", ""].join("\n");
    const expected = ["a = 1;", "b = 2;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("no-empty-comments removes /* */ variants", () => {
    const input = ["a = 1;", "/*  */", ""].join("\n");
    const expected = ["a = 1;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("no-empty-comments removes multiple empty comment lines in one fix", () => {
    const input = ["//", "a = 1;", "//", "b = 2;", "//", ""].join("\n");
    const expected = ["a = 1;", "b = 2;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("no-empty-comments preserves triple-slash blank doc lines", () => {
    const input = [
        "/// @desc Emulation of string_height()",
        "///",
        "///       **Please do not use this function with string_copy()**",
        "///",
        "/// @param string The string to draw",
        "function scribble_height(string) {",
        "    return 0;",
        "}",
        ""
    ].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("no-empty-comments preserves non-empty // comments", () => {
    const input = ["// Keep this note", "value = 1;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("no-empty-comments preserves non-empty block comments", () => {
    const input = ["/** Some documentation */", "value = 1;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("no-empty-comments preserves inline block comments with surrounding code", () => {
    // Inline empty block comments are left alone — this rule only removes
    // lines that are *entirely* an empty comment.
    const input = ["value = /* empty */ 1;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("no-empty-comments preserves CRLF line endings when autofixing", () => {
    const input = "a = 1;\r\n//\r\nb = 2;\r\n";
    const expected = "a = 1;\r\nb = 2;\r\n";

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("no-empty-comments does not report on a source with no empty comments", () => {
    const input = ["// Normal comment", "a = 1;", ""].join("\n");

    const result = runNoEmptyCommentsRule(input);
    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("no-empty-comments is registered in the recommended config", () => {
    const recommended = LintWorkspace.Lint.configs.recommended;
    const allRules = recommended.flatMap((config) => Object.keys(config.rules ?? {}));
    assertEquals(
        allRules.includes("gml/no-empty-comments"),
        true,
        "Expected gml/no-empty-comments to be in the recommended config"
    );
});
