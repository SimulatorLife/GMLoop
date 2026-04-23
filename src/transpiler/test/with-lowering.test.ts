import { strictEqual } from "node:assert";
import { test } from "node:test";

import { lowerWithStatement } from "../src/emitter/with-lowering.js";

void test("lowerWithStatement generates correct structure", () => {
    const result = lowerWithStatement("obj_player", "x += 1;", "globalThis.__resolve_with_targets");

    strictEqual(result.includes("const __with_prev_self = self;"), true);
    strictEqual(result.includes("const __with_prev_other = other;"), true);
    strictEqual(result.includes("const __with_value = obj_player;"), true);
    strictEqual(result.includes("const __with_targets = (() => {"), true);
    strictEqual(result.includes("for ("), true);
    strictEqual(result.includes("self = __with_prev_self;"), true);
    strictEqual(result.includes("other = __with_prev_other;"), true);
});

void test("lowerWithStatement includes runtime resolver check", () => {
    const result = lowerWithStatement("all", "hp = 0;", "globalThis.__resolve_with_targets");

    strictEqual(result.includes('if (typeof globalThis.__resolve_with_targets === "function")'), true);
    strictEqual(result.includes("return globalThis.__resolve_with_targets("), true);
});

void test("lowerWithStatement includes null check fallback", () => {
    const result = lowerWithStatement("noone", "visible = false;", "runtime.resolveTargets");

    strictEqual(result.includes("if (__with_value == null)"), true);
    strictEqual(result.includes("return [];"), true);
});

void test("lowerWithStatement includes array check fallback", () => {
    const result = lowerWithStatement("[obj_a, obj_b]", "speed = 0;", "resolver");

    strictEqual(result.includes("if (Array.isArray(__with_value))"), true);
    strictEqual(result.includes("return __with_value;"), true);
});

void test("lowerWithStatement embeds indented body correctly", () => {
    const rawBody = "x += 1;\ny += 2;";
    const result = lowerWithStatement("self", rawBody, "globalThis.__resolve_with_targets");

    strictEqual(result.includes("        x += 1;\n        y += 2;"), true);
});

void test("lowerWithStatement preserves test expression", () => {
    const testExpr = "(x > 10 ? obj_red : obj_blue)";
    const result = lowerWithStatement(testExpr, "visible = true;", "resolver");

    strictEqual(result.includes(`const __with_value = ${testExpr};`), true);
});

void test("lowerWithStatement uses custom resolver identifier", () => {
    const customResolver = "myGame.resolveWithTargets";
    const result = lowerWithStatement("target", "destroy();", customResolver);

    strictEqual(result.includes(`if (typeof ${customResolver} === "function")`), true);
    strictEqual(result.includes(`return ${customResolver}(`), true);
});

void test("lowerWithStatement wraps in block scope", () => {
    const result = lowerWithStatement("obj", "code;", "resolver");

    strictEqual(result.startsWith("{"), true);
    strictEqual(result.endsWith("}"), true);
});

void test("lowerWithStatement ensures self/other restoration in finally", () => {
    const result = lowerWithStatement("obj", "code;", "resolver");

    strictEqual(result.includes("try {"), true);
    strictEqual(result.includes("} finally {"), true);
    strictEqual(result.includes("self = __with_prev_self;"), true);
    strictEqual(result.includes("other = __with_prev_other;"), true);
});

void test("lowerWithStatement assigns self and other in loop", () => {
    const result = lowerWithStatement("targets", "action();", "resolver");

    strictEqual(result.includes("const __with_self = __with_targets[__with_index];"), true);
    strictEqual(result.includes("self = __with_self;"), true);
    strictEqual(result.includes("other = __with_prev_self;"), true);
});

void test("lowerWithStatement uses correct loop structure", () => {
    const result = lowerWithStatement("obj", "body;", "resolver");

    strictEqual(result.includes("let __with_index = 0;"), true);
    strictEqual(result.includes("__with_index < __with_targets.length;"), true);
    strictEqual(result.includes("__with_index += 1"), true);
});
