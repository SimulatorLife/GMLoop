import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { parseProgramNode } from "./lint-rule-test-harness.js";
import { runGmlRule } from "./rule-test-harness.js";

function runRequireRegionPairsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["require-region-pairs"],
        code,
        programNode: parseProgramNode(code)
    });
}

void test("require-region-pairs leaves balanced nested regions unchanged", () => {
    const input = [
        "#region This is my region",
        "var outer = 1;",
        "    #region Inner region",
        "    var inner = 2;",
        "    #endregion This is the closing part of the inner region",
        "#endregion This is the closing part of the region",
        ""
    ].join("\n");

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("require-region-pairs appends a missing endregion at EOF", () => {
    const input = ["#region This is my region", "var value = 1;", ""].join("\n");
    const expected = ["#region This is my region", "var value = 1;", "#endregion", ""].join("\n");

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("require-region-pairs appends a missing endregion when the file has no final newline", () => {
    const input = ["#region This is my region", "var value = 1;"].join("\n");
    const expected = ["#region This is my region", "var value = 1;", "#endregion"].join("\n");

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("require-region-pairs appends multiple endregions for embedded unclosed regions", () => {
    const input = ["#region Outer", "value = 1;", "    #region Inner", "    value = 2;", ""].join("\n");
    const expected = [
        "#region Outer",
        "value = 1;",
        "    #region Inner",
        "    value = 2;",
        "#endregion",
        "#endregion",
        ""
    ].join("\n");

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("require-region-pairs removes standalone endregions with comments", () => {
    const input = ["#endregion This is the closing part of the region", "var value = 1;", ""].join("\n");
    const expected = ["var value = 1;", ""].join("\n");

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("require-region-pairs removes extra endregions around a balanced nested region", () => {
    const input = [
        "#endregion Stray before any region",
        "#region Outer",
        "    #region Inner",
        "    value = 1;",
        "    #endregion Inner",
        "#endregion Outer",
        "#endregion Stray after the region stack is empty",
        ""
    ].join("\n");
    const expected = [
        "#region Outer",
        "    #region Inner",
        "    value = 1;",
        "    #endregion Inner",
        "#endregion Outer",
        ""
    ].join("\n");

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("require-region-pairs preserves CRLF line endings when appending missing endregions", () => {
    const input = "#region Outer\r\nvalue = 1;\r\n    #region Inner\r\n";
    const expected = "#region Outer\r\nvalue = 1;\r\n    #region Inner\r\n#endregion\r\n#endregion\r\n";

    const result = runRequireRegionPairsRule(input);
    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});
