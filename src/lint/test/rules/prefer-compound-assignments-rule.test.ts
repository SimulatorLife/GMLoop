import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { parseProgramNode } from "./lint-rule-test-harness.js";
import { runGmlRule } from "./rule-test-harness.js";

function runPreferCompoundAssignmentsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["prefer-compound-assignments"],
        code,
        programNode: parseProgramNode(code)
    });
}

void test("prefer-compound-assignments rewrites addition, subtraction, multiplication, and division self-assignments", () => {
    const input = [
        "score = score + points;",
        "speed = speed * friction;",
        "lives = lives - 1;",
        "timer = timer / delta;",
        ""
    ].join("\n");
    const expected = ["score += points;", "speed *= friction;", "lives -= 1;", "timer /= delta;", ""].join("\n");

    const result = runPreferCompoundAssignmentsRule(input);
    assertEquals(result.messageCount, 4);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments preserves complex right operand text", () => {
    const input = "x = x * (a + b);\n";
    const expected = "x *= (a + b);\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = x ?? y to x ??= y", () => {
    const input = "x = x ?? y;\n";
    const expected = "x ??= y;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites nullish assignment with call-expression fallback", () => {
    const input = "cache = cache ?? ds_map_create();\n";
    const expected = "cache ??= ds_map_create();\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites nullish assignment with member fallback", () => {
    const input = "config = config ?? global.default_config;\n";
    const expected = "config ??= global.default_config;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites parenthesized nullish expressions", () => {
    const input = "value = (value ?? (a + b));\n";
    const expected = "value ??= (a + b);\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments does not rewrite when identifiers differ", () => {
    const input = "x = y - z;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite nullish assignments when identifiers differ", () => {
    const input = "x = y ?? z;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite non-identifier left-hand sides", () => {
    const input = "arr[i] = arr[i] - 1;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite nullish assignments on non-identifier left-hand sides", () => {
    const input = "arr[i] = arr[i] ?? 0;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite when comments exist in the right expression span", () => {
    const input = "lives = lives - /* keep */ 1;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments rewrites x = x + y to x += y", () => {
    const input = "name = name + suffix;\n";
    const expected = "name += suffix;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites addition with a complex right operand", () => {
    const input = "total = total + (base * multiplier);\n";
    const expected = "total += (base * multiplier);\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments is included in the recommended config", () => {
    const recommended = LintWorkspace.Lint.configs.recommended;
    const allRules = recommended.flatMap((config) => Object.keys(config.rules ?? {}));

    assertEquals(allRules.includes("gml/prefer-compound-assignments"), true);
});

// Commutative right-first patterns: `x = y + x` and `x = y * x` are
// semantically identical to their left-first counterparts and must be
// rewritten to the same compound form.

void test("prefer-compound-assignments rewrites x = y + x to x += y", () => {
    const input = "score = points + score;\n";
    const expected = "score += points;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = y * x to x *= y", () => {
    const input = "speed = friction * speed;\n";
    const expected = "speed *= friction;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = literal + x to x += literal", () => {
    const input = "count = 1 + count;\n";
    const expected = "count += 1;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = (complex_expr) * x to x *= (complex_expr)", () => {
    const input = "value = (base * factor) * value;\n";
    const expected = "value *= (base * factor);\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments does not rewrite x = y - x (non-commutative)", () => {
    const input = "x = y - x;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite x = y / x (non-commutative)", () => {
    const input = "x = y / x;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite x = y ?? x (non-commutative)", () => {
    const input = "x = y ?? x;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments rewrites modulo, bitwise, and shift self-assignments", () => {
    const input = [
        "angle = angle % 360;",
        "flags = flags | mask;",
        "bits = bits & mask;",
        "state = state ^ toggle;",
        "value = value << 2;",
        "value = value >> 1;",
        ""
    ].join("\n");
    const expected = [
        "angle %= 360;",
        "flags |= mask;",
        "bits &= mask;",
        "state ^= toggle;",
        "value <<= 2;",
        "value >>= 1;",
        ""
    ].join("\n");

    const result = runPreferCompoundAssignmentsRule(input);
    assertEquals(result.messageCount, 6);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = y | x to x |= y (commutative bitwise)", () => {
    const input = "flags = new_flag | flags;\n";
    const expected = "flags |= new_flag;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = y & x to x &= y (commutative bitwise)", () => {
    const input = "mask = filter & mask;\n";
    const expected = "mask &= filter;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments rewrites x = y ^ x to x ^= y (commutative bitwise)", () => {
    const input = "state = toggle ^ state;\n";
    const expected = "state ^= toggle;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 1);
    assertEquals(result.output, expected);
});

void test("prefer-compound-assignments does not rewrite x = y % x (non-commutative)", () => {
    const input = "x = y % x;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite x = y << x (non-commutative)", () => {
    const input = "x = y << x;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});

void test("prefer-compound-assignments does not rewrite x = y >> x (non-commutative)", () => {
    const input = "x = y >> x;\n";
    const result = runPreferCompoundAssignmentsRule(input);

    assertEquals(result.messageCount, 0);
    assertEquals(result.output, input);
});
