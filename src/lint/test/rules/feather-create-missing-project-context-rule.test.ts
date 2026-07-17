import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithFeatherRule } from "./rule-test-harness.js";

void test("createMissingProjectContextRule reports missingProjectContext when the detection pattern matches", () => {
    const input = "event_user(0);\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2025", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule does not report when the detection pattern does not match", () => {
    const input = "draw_self();\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2025", input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule does not emit a fix for the diagnostic", () => {
    const input = "function crash() {}\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1064", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule is used by every project-context-required feather rule", () => {
    // These rules share an identical report-only body that used to be
    // copy-pasted into each factory. Routing them through the same helper
    // keeps the diagnostics uniform; a regression in one rule would
    // surface here as a divergence in messageId or zero-message output.
    const inputs = {
        gm1021: "some_call();\n",
        gm1064: "function helper() {}\n",
        gm2025: "event_user(1);\n",
        gm2040: "event_inherited();\n",
        gm2064: "instance_create_depth(0, 0, 0, obj) {\n"
    };

    for (const [ruleName, source] of Object.entries(inputs)) {
        const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, ruleName, source);
        assertEquals(result.messages.length, 1, `${ruleName} should report a single diagnostic`);
        assertEquals(
            result.messages[0].messageId,
            "missingProjectContext",
            `${ruleName} should report missingProjectContext`
        );
        assertEquals(result.output, source, `${ruleName} must not rewrite source text`);
    }
});
