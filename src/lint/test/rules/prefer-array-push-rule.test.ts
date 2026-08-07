import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("prefer-array-push rewrites direct identifier append assignments", () => {
    const input = ["items[array_length(items)] = value;", ""].join("\n");
    const expected = ["array_push(items, value);", ""].join("\n");

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-array-push rewrites side-effect-free member receiver appends", () => {
    const input = ["self.inventory[array_length(self.inventory)] = pickup;", ""].join("\n");
    const expected = ["array_push(self.inventory, pickup);", ""].join("\n");

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-array-push preserves complex appended value expressions", () => {
    const input = ["rows[array_length(rows)] = {x: origin_x + 4, y: origin_y};", ""].join("\n");
    const expected = ["array_push(rows, {x: origin_x + 4, y: origin_y});", ""].join("\n");

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-array-push does not rewrite mismatched array_length arguments", () => {
    const input = ["items[array_length(other_items)] = value;", ""].join("\n");

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-array-push does not rewrite append targets with impure receivers", () => {
    const input = ["get_inventory()[array_length(get_inventory())] = pickup;", ""].join("\n");

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-array-push does not rewrite comment-bearing assignment ranges", () => {
    const input = ["items[array_length(items)] = /* preserve */ value;", ""].join("\n");

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-array-push does not rewrite non-statement append expressions inside for headers", () => {
    const input = ["for (var i = 0; i < 10; items[array_length(items)] = value) {", "    total += i;", "}", ""].join(
        "\n"
    );

    const result = lintWithRule("prefer-array-push", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});
