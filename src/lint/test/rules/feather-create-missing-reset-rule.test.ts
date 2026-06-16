import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithFeatherRule } from "./rule-test-harness.js";

void test("createMissingResetRule appends the reset line when the detection pattern matches", () => {
    const input = "gpu_set_blendmode(bm_add);\ndraw_self();\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2000", input);

    assertEquals(result.output, `${input}gpu_set_blendmode(bm_normal);\n`);
});

void test("createMissingResetRule does not duplicate the reset line when it is already present", () => {
    const input = ["gpu_set_blendmode(bm_add);", "draw_self();", "gpu_set_blendmode(bm_normal);", ""].join("\n");

    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2000", input);
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("createMissingResetRule is a no-op when the detection pattern does not match", () => {
    const input = "draw_self();\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2000", input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("createMissingResetRule handles file input that lacks a trailing newline", () => {
    const input = "draw_set_alpha(0.25);\ndraw_text(0, 0, 'x');";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2023", input);

    assertEquals(result.output, `${input}\ndraw_set_alpha(1);\n`);
});
