import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("prefer-direct-return collapses adjacent local assignment and return into a direct return", () => {
    const input = [
        "function make_stats() {",
        "    var stats = { hp: 100, mp: 50 };",
        "    return stats;",
        "}",
        ""
    ].join("\n");
    const expected = ["function make_stats() {", "    return { hp: 100, mp: 50 };", "}", ""].join("\n");

    const result = lintWithRule("prefer-direct-return", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-direct-return does not rewrite when the returned identifier differs", () => {
    const input = ["function make_stats() {", "    var stats = hp + mp;", "    return hp;", "}", ""].join("\n");
    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-return does not rewrite when comments would be dropped", () => {
    const input = [
        "function make_stats() {",
        "    var stats = { hp: 100, mp: 50 }; // keep this note",
        "    return stats;",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-return preserves comments inside a multiline initializer when rewriting", () => {
    const input = [
        "function make_stats() {",
        "    var stats = {",
        "        hp: 100, // keep the property note",
        "        mp: 50",
        "    };",
        "    return stats;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "function make_stats() {",
        "    return {",
        "        hp: 100, // keep the property note",
        "        mp: 50",
        "    };",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-direct-return does not rewrite when initializer references the declared identifier", () => {
    const input = ["function step_score() {", "    var score = score + 1;", "    return score;", "}", ""].join("\n");
    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-return does not rewrite when the returned identifier is not declared", () => {
    // GML does not require `var` in function scope, so an undeclared identifier
    // being returned should not be rewritten — the declaration is not present.
    const input = ["function step_score() {", "    score = score + 1;", "    return score;", "}", ""].join("\n");
    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-return collapses adjacent static declaration and return into a direct return", () => {
    const input = [
        "function cache_stats() {",
        "    static stats = ds_map_create();",
        "    return stats;",
        "}",
        ""
    ].join("\n");
    const expected = ["function cache_stats() {", "    return ds_map_create();", "}", ""].join("\n");

    const result = lintWithRule("prefer-direct-return", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-direct-return does not rewrite multi-declarator declarations", () => {
    const input = ["function cache_stats() {", "    var hp = 100, mp = 50;", "    return hp;", "}", ""].join("\n");
    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-return does not rewrite static declaration without initializer", () => {
    const input = ["function cache_stats() {", "    static stats;", "    return stats;", "}", ""].join("\n");
    const result = lintWithRule("prefer-direct-return", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-direct-return is included in the recommended config", () => {
    const recommended = LintWorkspace.Lint.configs.recommended;
    const allRules = recommended.flatMap((config) => Object.keys(config.rules ?? {}));

    assertEquals(allRules.includes("gml/prefer-direct-return"), true);
});
