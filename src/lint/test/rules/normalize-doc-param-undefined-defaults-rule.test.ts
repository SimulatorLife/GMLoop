import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeDocParamUndefinedDefaultsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-doc-param-undefined-defaults"],
        code,
        programNode: { type: "Program" }
    });
}

void test("normalize-doc-param-undefined-defaults removes explicit undefined defaults", () => {
    const input = [
        "/// @param {Struct.MyCustomStruct} [first=undefined] first typed description should remain.",
        "/// @param [second = undefined] second description should remain.",
        "function bake(first, second) {",
        "    return first;",
        "}"
    ].join("\n");

    const result = runNormalizeDocParamUndefinedDefaultsRule(input);

    assert.equal(result.messageCount, 2);
    assert.equal(
        result.output,
        [
            "/// @param {Struct.MyCustomStruct} [first] first typed description should remain.",
            "/// @param [second] second description should remain.",
            "function bake(first, second) {",
            "    return first;",
            "}"
        ].join("\n")
    );
});

void test("normalize-doc-param-undefined-defaults preserves concrete defaults and ordinary comments", () => {
    const input = [
        "/// @param [first=0] first default should stay.",
        "// @param [second=undefined] ordinary comments are not doc params.",
        "function bake(first, second) {",
        "    return first;",
        "}"
    ].join("\n");

    const result = runNormalizeDocParamUndefinedDefaultsRule(input);

    assert.equal(result.messageCount, 0);
    assert.equal(result.output, input);
});

void test("normalize-doc-param-undefined-defaults preserves CRLF line endings", () => {
    const input = [
        "/// @param [first=undefined] first description should remain.",
        "function bake(first) {",
        "    return first;",
        "}"
    ].join("\r\n");

    const result = runNormalizeDocParamUndefinedDefaultsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        [
            "/// @param [first] first description should remain.",
            "function bake(first) {",
            "    return first;",
            "}"
        ].join("\r\n")
    );
});
