import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

const { Lint } = LintWorkspace;

const gmlRules = Lint.plugin.rules;

void test("require-ztest-enabled-reset reports and appends enable when only disable is present", () => {
    const input = ["gpu_set_ztestenable(false);", ""].join("\n");
    const expected = ["gpu_set_ztestenable(false);", "gpu_set_ztestenable(true);", ""].join("\n");

    const result = lintWithRule("require-ztest-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("require-ztest-enabled-reset stays silent when disable is followed by enable", () => {
    const input = ["gpu_set_ztestenable(false);", "draw_self();", "gpu_set_ztestenable(true);", ""].join("\n");

    const result = lintWithRule("require-ztest-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("require-ztest-enabled-reset only inspects enable calls after the last disable call", () => {
    const input = ["gpu_set_ztestenable(true);", "gpu_set_ztestenable(false);", "draw_self();", ""].join("\n");
    const expected = [
        "gpu_set_ztestenable(true);",
        "gpu_set_ztestenable(false);",
        "draw_self();",
        "gpu_set_ztestenable(true);",
        ""
    ].join("\n");

    const result = lintWithRule("require-ztest-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("require-ztest-enabled-reset inserts a leading newline when the file lacks a trailing newline", () => {
    const input = "gpu_set_ztestenable(false);";
    const expected = "gpu_set_ztestenable(false);\ngpu_set_ztestenable(true);\n";

    const result = lintWithRule("require-ztest-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("require-zwrite-enabled-reset reports and appends enable when only disable is present", () => {
    const input = ["gpu_set_zwriteenable(false);", ""].join("\n");
    const expected = ["gpu_set_zwriteenable(false);", "gpu_set_zwriteenable(true);", ""].join("\n");

    const result = lintWithRule("require-zwrite-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("require-zwrite-enabled-reset stays silent when disable is followed by enable", () => {
    const input = ["gpu_set_zwriteenable(false);", "draw_self();", "gpu_set_zwriteenable(true);", ""].join("\n");

    const result = lintWithRule("require-zwrite-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("require-zwrite-enabled-reset preserves CRLF line endings when appending enable reset", () => {
    const input = "gpu_set_zwriteenable(false);\r\n";
    const expected = "gpu_set_zwriteenable(false);\r\ngpu_set_zwriteenable(true);\r\n";

    const result = lintWithRule("require-zwrite-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("require-zwrite-enabled-reset only inspects enable calls after the last disable call", () => {
    const input = ["gpu_set_zwriteenable(false);", "gpu_set_zwriteenable(false);", "draw_self();", ""].join("\n");
    const expected = [
        "gpu_set_zwriteenable(false);",
        "gpu_set_zwriteenable(false);",
        "draw_self();",
        "gpu_set_zwriteenable(true);",
        ""
    ].join("\n");

    const result = lintWithRule("require-zwrite-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("require-zwrite-enabled-reset stays silent when the source contains no disable call", () => {
    const input = ["draw_self();", ""].join("\n");

    const result = lintWithRule("require-zwrite-enabled-reset", input, {}, gmlRules);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});
