import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { parseProgramNode } from "./lint-rule-test-harness.js";
import { runGmlRule } from "./rule-test-harness.js";

function runNoScientificNotationRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["no-scientific-notation"],
        code,
        programNode: parseProgramNode(code)
    });
}

void test("no-scientific-notation is registered in the lint plugin", () => {
    const rule = LintWorkspace.Lint.plugin.rules["no-scientific-notation"];
    assert.ok(rule, "Expected no-scientific-notation rule to be registered");
});

void test("no-scientific-notation auto-fixes negative-exponent scientific literals", () => {
    const input = "var epsilon = 1e-11;\n";
    const result = runNoScientificNotationRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, "var epsilon = 0.00000000001;\n");
});

void test("no-scientific-notation auto-fixes all scientific notation forms in code", () => {
    const input = ["var a = 1e3;", "var b = .5E+2;", "var c = 4.50e-1;"].join("\n");
    const result = runNoScientificNotationRule(`${input}\n`);

    assertEquals(result.messageCount, 3);
    assertEquals(result.output, "var a = 1000;\nvar b = 50;\nvar c = 0.45;\n");
});

void test("no-scientific-notation auto-fixes malformed __scribble_random scientific notation source", () => {
    const input = [
        "/// @returns {any}",
        "function __scribble_random() {",
        "    static _lcg = date_current_datetime() * 100;",
        "    _lcg = (48271 * _lcg) mod 2147483647; // Lehmer",
        "    return _lcg * 4.656612873077393e-10;",
        "}",
        ""
    ].join("\n");

    const result = runNoScientificNotationRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(
        result.output,
        [
            "/// @returns {any}",
            "function __scribble_random() {",
            "    static _lcg = date_current_datetime() * 100;",
            "    _lcg = (48271 * _lcg) mod 2147483647; // Lehmer",
            "    return _lcg * 0.0000000004656612873077393;",
            "}",
            ""
        ].join("\n")
    );
});

void test("no-scientific-notation does not touch scientific notation text in comments and strings", () => {
    const input = [
        'var message = "value: 1e-11";',
        "// 2e-9 should remain in a comment",
        "/* 3E+4 should remain in a block comment */",
        "var stable = 42;"
    ].join("\n");
    const result = runNoScientificNotationRule(`${input}\n`);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, `${input}\n`);
});

void test("no-scientific-notation is enabled in the recommended config", () => {
    const recommended = LintWorkspace.Lint.configs.recommended;
    const allRules = recommended.flatMap((config) => Object.keys(config.rules ?? {}));
    assert.ok(
        allRules.includes("gml/no-scientific-notation"),
        "Expected gml/no-scientific-notation to be in the recommended config"
    );
});
