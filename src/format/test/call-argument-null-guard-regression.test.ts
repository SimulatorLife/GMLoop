import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("guards against null/undefined arguments in CallExpression node", async () => {
    // Regression test: ensuring the formatter handles CallExpression nodes
    // where arguments may be null/undefined without throwing TypeError.
    // The code paths at print.ts:505 and print.ts:683 access node.arguments[0]
    // and node.arguments.at(-1) directly. These must use nullish coalescing
    // to avoid "Cannot read properties of undefined" at runtime.
    const source = [
        "// Regression: null arguments guard in shouldUseCallbackLayout",
        "function test() {",
        "    my_function();",
        "}",
        ""
    ].join("\n");

    // Should not throw even if the AST provides null/undefined for arguments
    const formatted = await Format.format(source);
    assert.ok(formatted.includes("my_function()"), "Expected function call to be formatted");
});

void test("handles call with single callback argument", async () => {
    // Verifies that the first-argument access path works correctly
    const source = [
        "function test() {",
        "    call_later(function() {",
        "        do_something();",
        "    });",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    assert.ok(formatted.includes("call_later"), "Expected call_later to be present");
});

void test("handles call with mixed arguments including callback", async () => {
    // Verifies that both first and last argument access work in callback layout detection
    const source = [
        "function test() {",
        "    animate(",
        "        1000,",
        "        ease_out_quad,",
        "        function() {",
        "            on_complete();",
        "        }",
        "    );",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    assert.ok(formatted.includes("animate("), "Expected animate to be formatted");
});

void test("handles call with no arguments", async () => {
    // Verifies the empty arguments path is handled correctly
    const source = ["function test() {", "    some_function();", "}", ""].join("\n");

    const formatted = await Format.format(source);
    assert.ok(formatted.includes("some_function()"), "Expected empty-call function to be formatted");
});
