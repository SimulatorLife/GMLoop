import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";
import { ESLint } from "eslint";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

function lintPreferDirectBooleanReturn(sourceText: string): ReturnType<typeof lintWithRule> {
    return lintWithRule("prefer-direct-boolean-return", sourceText, {});
}

async function lintWithBooleanReturnAndLogicalFlow(
    sourceText: string
): Promise<Readonly<{ output: string | undefined; messageRuleIds: ReadonlyArray<string | null> }>> {
    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: [
            {
                files: ["**/*.gml"],
                language: "gml/gml",
                plugins: {
                    gml: LintWorkspace.Lint.plugin
                },
                rules: {
                    "gml/prefer-direct-boolean-return": "error",
                    "gml/optimize-logical-flow": "error"
                }
            }
        ]
    });

    const [result] = await eslint.lintText(sourceText, { filePath: "prefer-direct-boolean-return.gml" });
    return Object.freeze({
        output: result.output,
        messageRuleIds: Object.freeze(result.messages.map((message) => message.ruleId))
    });
}

async function lintWithEslintRule(
    sourceText: string,
    rules: Readonly<Record<string, "error">>
): Promise<Readonly<{ output: string; messages: ReadonlyArray<{ ruleId: string | null }> }>> {
    const eslint = new ESLint({
        overrideConfigFile: true,
        fix: true,
        overrideConfig: [
            {
                files: ["**/*.gml"],
                language: "gml/gml",
                plugins: {
                    gml: LintWorkspace.Lint.plugin
                },
                rules
            }
        ]
    });

    const [result] = await eslint.lintText(sourceText, { filePath: "prefer-direct-boolean-return.gml" });
    return Object.freeze({
        output: result.output ?? sourceText,
        messages: Object.freeze(result.messages.map((message) => Object.freeze({ ruleId: message.ruleId })))
    });
}

void test("prefer-direct-boolean-return collapses explicit if/else boolean returns", () => {
    const input = [
        "function can_run(ready) {",
        "    if (ready) {",
        "        return true;",
        "    } else {",
        "        return false;",
        "    }",
        "}",
        ""
    ].join("\n");

    const expected = ["function can_run(ready) {", "    return ready;", "}", ""].join("\n");
    const result = lintPreferDirectBooleanReturn(input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0]?.messageId, "preferDirectBooleanReturn");
    assertEquals(result.output, expected);
});

void test("prefer-direct-boolean-return collapses adjacent if and trailing boolean return", async () => {
    const input = [
        "function can_run(ready) {",
        "    if (!!ready) {",
        "        return true;",
        "    }",
        "",
        "    return false;",
        "}",
        ""
    ].join("\n");

    const expected = ["function can_run(ready) {", "    return ready;", "}", ""].join("\n");
    const result = await lintWithEslintRule(input, { "gml/prefer-direct-boolean-return": "error" });

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, expected);
});

void test("prefer-direct-boolean-return negates false-then-true branches", () => {
    const input = [
        "function should_skip(ready) {",
        "    if (ready) {",
        "        return false;",
        "    } else {",
        "        return true;",
        "    }",
        "}",
        ""
    ].join("\n");

    const expected = ["function should_skip(ready) {", "    return !ready;", "}", ""].join("\n");
    const result = lintPreferDirectBooleanReturn(input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-direct-boolean-return skips comment-bearing ranges", () => {
    const input = [
        "function can_run(ready) {",
        "    if (ready) {",
        "        // Preserve branch reasoning.",
        "        return true;",
        "    }",
        "",
        "    return false;",
        "}",
        ""
    ].join("\n");

    const result = lintPreferDirectBooleanReturn(input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-boolean-return skips else-if chains", () => {
    const input = [
        "function resolve_priority(flag_a, flag_b) {",
        "    if (flag_a) {",
        "        return true;",
        "    } else if (flag_b) {",
        "        return false;",
        "    } else {",
        "        return true;",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = lintPreferDirectBooleanReturn(input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-boolean-return skips missing and non-boolean return values", () => {
    const missingArgument = ["if (ready) {", "    return;", "} else {", "    return true;", "}", ""].join("\n");
    const nonBooleanArgument = ["if (ready) {", "    return 1;", "} else {", "    return 0;", "}", ""].join("\n");

    const missingResult = lintPreferDirectBooleanReturn(missingArgument);
    const nonBooleanResult = lintPreferDirectBooleanReturn(nonBooleanArgument);

    assertEquals(missingResult.messages.length, 0);
    assertEquals(missingResult.output, missingArgument);
    assertEquals(nonBooleanResult.messages.length, 0);
    assertEquals(nonBooleanResult.output, nonBooleanArgument);
});

void test("optimize-logical-flow alone no longer owns direct boolean return passthroughs", async () => {
    const input = [
        "function can_run(ready) {",
        "    if (!!ready) {",
        "        return true;",
        "    }",
        "",
        "    return false;",
        "}",
        ""
    ].join("\n");

    const result = await lintWithEslintRule(input, { "gml/optimize-logical-flow": "error" });

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-boolean-return and optimize-logical-flow converge together", async () => {
    const input = [
        "function can_run(ready) {",
        "    if (!!ready) {",
        "        return true;",
        "    }",
        "",
        "    return false;",
        "}",
        ""
    ].join("\n");
    const expected = ["function can_run(ready) {", "    return ready;", "}", ""].join("\n");

    const firstPass = await lintWithBooleanReturnAndLogicalFlow(input);
    assertEquals(firstPass.output, expected);
    assertEquals(firstPass.messageRuleIds.length, 0);

    const secondPass = await lintWithBooleanReturnAndLogicalFlow(expected);
    assertEquals(secondPass.output, undefined);
    assertEquals(secondPass.messageRuleIds.length, 0);
});

void test("prefer-direct-boolean-return is included in the recommended config", () => {
    const [recommendedGml] = LintWorkspace.Lint.configs.recommended;

    assert.equal(recommendedGml.rules["gml/prefer-direct-boolean-return"], "warn");
});
