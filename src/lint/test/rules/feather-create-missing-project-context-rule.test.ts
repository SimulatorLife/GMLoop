import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithFeatherRule } from "./rule-test-harness.js";

void test("createMissingProjectContextRule reports a missingProjectContext diagnostic when the pattern matches", () => {
    const input = "event_user(0);\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2025", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule stays silent when the detection pattern does not match", () => {
    const input = "draw_self();\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2025", input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule matches the existing GM1021 call-detection pattern", () => {
    const input = "scr_run();\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1021", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule matches the existing GM1064 function-declaration pattern", () => {
    const input = "function spawn() {}\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1064", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule matches the existing GM2040 event_inherited pattern", () => {
    const input = "event_inherited();\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2040", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});

void test("createMissingProjectContextRule matches the existing GM2064 instance-create-with-block pattern", () => {
    const input = "instance_create_depth(x, y, 0, obj_foo) {\n    hp = 1;\n}\n";
    const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2064", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0].messageId, "missingProjectContext");
    assertEquals(result.output, input);
});
