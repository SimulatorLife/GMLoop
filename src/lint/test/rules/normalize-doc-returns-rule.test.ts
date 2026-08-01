import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeDocReturnsRule(code: string): string {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-doc-returns"],
        code,
        programNode: { type: "Program" }
    }).output;
}

void test("normalize-doc-returns converts legacy Returns colon lines to @returns metadata", () => {
    const input = [
        "/// Summary",
        "/// Returns: Boolean, indicating if check passed",
        "function demo() {",
        "    return true;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// Summary",
        "/// @returns {Boolean} Indicating if check passed",
        "function demo() {",
        "    return true;",
        "}",
        ""
    ].join("\n");

    assertEquals(runNormalizeDocReturnsRule(input), expected);
});

void test("normalize-doc-returns converts legacy type-description lines to @returns metadata", () => {
    const input = ["/// real - calculated movement speed", "function speed() {", "    return 1;", "}", ""].join("\n");
    const expected = [
        "/// @returns {real} Calculated movement speed",
        "function speed() {",
        "    return 1;",
        "}",
        ""
    ].join("\n");

    assertEquals(runNormalizeDocReturnsRule(input), expected);
});

void test("normalize-doc-returns preserves @param separators and ordinary summary text", () => {
    const input = [
        "/// Summary - not a returns line",
        "/// @param value - keep separator",
        "function demo(value) {}"
    ].join("\n");

    assertEquals(runNormalizeDocReturnsRule(input), input);
});

void test("normalize-doc-returns preserves CRLF line endings", () => {
    const input = '/// Returns: string - status\r\nfunction status() {\r\n    return "ok";\r\n}\r\n';
    const expected = '/// @returns {string} Status\r\nfunction status() {\r\n    return "ok";\r\n}\r\n';

    assertEquals(runNormalizeDocReturnsRule(input), expected);
});
