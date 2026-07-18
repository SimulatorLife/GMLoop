import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("no-multi-var-declarations splits every declarator in an ordinary statement", () => {
    const input = "var a = 1,\n    b = 2,\n    c = a + b;\n";
    const result = lintWithRule("no-multi-var-declarations", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.output, "var a = 1;\n    var b = 2;\n    var c = a + b;\n");
});

void test("no-multi-var-declarations preserves comments between declarators", () => {
    const input = "var first = 1 /* before */, // after\n    second = first;\n";
    const result = lintWithRule("no-multi-var-declarations", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.output, "var first = 1 /* before */; // after\n    var second = first;\n");
});

void test("no-multi-var-declarations reports but does not rewrite for initializers", () => {
    const input = "for (var first = 1, second = first; second < 3; second++) { }\n";
    const result = lintWithRule("no-multi-var-declarations", input);

    assertEquals(result.messages.length, 1);
    assertEquals(result.output, input);
});

void test("no-multi-var-declarations ignores single declarators", () => {
    const input = "var value = 1;\n";
    const result = lintWithRule("no-multi-var-declarations", input);

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});
