import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeDocParamDefaultsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-doc-param-defaults"],
        code,
        programNode: { type: "Program" }
    });
}

void test("normalize-doc-param-defaults removes multiline optional @param defaults", () => {
    const input = [
        "/// @param [matrix=matrix_build_identity(",
        ")]",
        "function bake(matrix) {",
        "    return matrix;",
        "}"
    ].join("\n");

    const result = runNormalizeDocParamDefaultsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        ["/// @param [matrix]", "function bake(matrix) {", "    return matrix;", "}"].join("\n")
    );
});

void test("normalize-doc-param-defaults preserves valid single-line optional defaults", () => {
    const input = ["/// @param [count=0]", "function bake(count) {", "    return count;", "}"].join("\n");

    const result = runNormalizeDocParamDefaultsRule(input);

    assert.equal(result.messageCount, 0);
    assert.equal(result.output, input);
});

void test("normalize-doc-param-defaults preserves explicit undefined optional defaults", () => {
    const input = ["/// @param [first=undefined]", "function bake(first) {", "    return first;", "}"].join("\n");

    const result = runNormalizeDocParamDefaultsRule(input);

    assert.equal(result.messageCount, 0);
    assert.equal(result.output, input);
});

void test("normalize-doc-param-defaults preserves CRLF line endings", () => {
    const input = [
        "/// @param [matrix=matrix_build_identity(",
        ")]",
        "function bake(matrix) {",
        "    return matrix;",
        "}"
    ].join("\r\n");

    const result = runNormalizeDocParamDefaultsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        ["/// @param [matrix]", "function bake(matrix) {", "    return matrix;", "}"].join("\r\n")
    );
});
