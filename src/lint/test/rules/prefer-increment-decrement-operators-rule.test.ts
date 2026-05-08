import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("prefer-increment-decrement-operators rewrites standalone += 1 and -= 1 statements", () => {
    const input = ["count += 1;", "self.hp -= 1;", "items[i] += 1;", ""].join("\n");
    const expected = ["count++;", "self.hp--;", "items[i]++;", ""].join("\n");

    const result = lintWithRule("prefer-increment-decrement-operators", input);
    assertEquals(result.messages.length, 3);
    assertEquals(result.output, expected);
});

void test("prefer-increment-decrement-operators rewrites parenthesized and decimal one literals", () => {
    const input = ["score += (1);", "timer -= 1.0;", ""].join("\n");
    const expected = ["score++;", "timer--;", ""].join("\n");

    const result = lintWithRule("prefer-increment-decrement-operators", input);
    assertEquals(result.messages.length, 2);
    assertEquals(result.output, expected);
});

void test("prefer-increment-decrement-operators rewrites values within floating-point tolerance of one", () => {
    // "1." is a valid numeric literal that parses as 1.0. The strict equality
    // `Number("1.") === 1` passes in isolation, but a previous version of this
    // rule used `Number(literalText) === 1` which is vulnerable to subtle
    // floating-point representation differences (e.g., "1.0000" may not be
    // exactly 1.0). This test verifies epsilon-tolerant matching works.
    const input = ["count += 1.;", "index -= 1.0;", "items[i] += 1.0000;", ""].join("\n");
    const expected = ["count++;", "index--;", "items[i]++;", ""].join("\n");

    const result = lintWithRule("prefer-increment-decrement-operators", input);
    assertEquals(result.messages.length, 3);
    assertEquals(result.output, expected);
});

void test("prefer-increment-decrement-operators does not rewrite increments by values other than one", () => {
    const input = ["count += 2;", "timer -= 0.5;", ""].join("\n");

    const result = lintWithRule("prefer-increment-decrement-operators", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-increment-decrement-operators does not rewrite comment-bearing assignment ranges", () => {
    const input = ["count += /* preserve */ 1;", ""].join("\n");

    const result = lintWithRule("prefer-increment-decrement-operators", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-increment-decrement-operators does not rewrite header updates in for-loops", () => {
    const input = ["for (var i = 0; i < 10; count += 1) {", "    total += i;", "}", ""].join("\n");

    const result = lintWithRule("prefer-increment-decrement-operators", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-increment-decrement-operators is included in the recommended config", () => {
    const recommended = LintWorkspace.Lint.configs.recommended;
    const allRules = recommended.flatMap((config) => Object.keys(config.rules ?? {}));

    assertEquals(allRules.includes("gml/prefer-increment-decrement-operators"), true);
});
