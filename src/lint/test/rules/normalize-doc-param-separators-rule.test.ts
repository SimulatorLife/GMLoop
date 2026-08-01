import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeDocParamSeparatorsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-doc-param-separators"],
        code,
        programNode: { type: "Program" }
    });
}

void test("normalize-doc-param-separators removes separator hyphens from typed optional param docs", () => {
    const input = [
        "/// @param {real} [xup=0] - The camera's up vector (default +Z axis)",
        "/// @param {real} [yup=0] - The camera's up vector (default +Z axis)",
        "function build_camera(xup = 0, yup = 0) {",
        "    return;",
        "}"
    ].join("\n");

    const result = runNormalizeDocParamSeparatorsRule(input);

    assert.equal(result.messageCount, 2);
    assert.match(result.output, /^\/\/\/ @param \{real\} \[xup=0\] The camera's up vector \(default \+Z axis\)$/m);
    assert.match(result.output, /^\/\/\/ @param \{real\} \[yup=0\] The camera's up vector \(default \+Z axis\)$/m);
    assert.doesNotMatch(result.output, /\[xup=0\] - The camera's up vector/m);
    assert.doesNotMatch(result.output, /\[yup=0\] - The camera's up vector/m);
});

void test("normalize-doc-param-separators removes separator hyphens from required param docs", () => {
    const input = ["/// @param value - value to return", "function identity(value) {", "    return value;", "}"].join(
        "\n"
    );

    const result = runNormalizeDocParamSeparatorsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        ["/// @param value value to return", "function identity(value) {", "    return value;", "}"].join("\n")
    );
});

void test("normalize-doc-param-separators preserves already-normalized docs and ordinary comments", () => {
    const input = [
        "/// @param value value to return",
        "// @param value - not a doc comment",
        "function identity(value) {",
        "    return value;",
        "}"
    ].join("\n");

    const result = runNormalizeDocParamSeparatorsRule(input);

    assert.equal(result.messageCount, 0);
    assert.equal(result.output, input);
});

void test("normalize-doc-param-separators preserves CRLF line endings", () => {
    const input = ["/// @param value - value to return", "function identity(value) {", "    return value;", "}"].join(
        "\r\n"
    );

    const result = runNormalizeDocParamSeparatorsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        ["/// @param value value to return", "function identity(value) {", "    return value;", "}"].join("\r\n")
    );
});
