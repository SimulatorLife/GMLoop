import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";
import { buildCallLikeArgumentDocs } from "../src/printer/call-argument-layout.js";

void test("guards against null/undefined arguments in CallExpression node", async () => {
    // Regression test: ensuring the formatter handles CallExpression nodes
    // where arguments may be null/undefined without throwing TypeError.
    // The code paths in print.ts and call-argument-layout.ts historically
    // accessed `node.arguments.length` directly. These must use nullish
    // coalescing to avoid "Cannot read properties of undefined" at runtime.
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

// ---------------------------------------------------------------------------
// Unit-level regression tests for the malformed-AST null safety guard.
//
// Before the guard was added, `buildCallLikeArgumentDocs` and the
// `printNewExpressionNode` helper in `print.ts` both read
// `node.arguments.length` directly. When the parser (or a synthetic AST
// producer) hands a node with `arguments: undefined` or `arguments: null`
// to the formatter, that access throws
// `TypeError: Cannot read properties of undefined (reading 'length')`,
// which then surfaces as an unhandled rejection from `Format.format`.
//
// These tests directly invoke `buildCallLikeArgumentDocs` with nodes
// whose `arguments` field is missing so that the guard is exercised
// without depending on a parser-produced AST regression.
// ---------------------------------------------------------------------------

/**
 * Minimal Prettier AstPath mock that exposes the handful of methods the
 * downstream helpers (`printEmptyParens` → `printDanglingCommentsAsGroup` →
 * `collectDanglingComments`) call while reporting no `comments` on the node.
 * The empty `comments` list short-circuits the trailing collection logic so
 * the test only exercises the null-safety guard under test.
 */
function createNullSafetyPathMock() {
    const noop = () => undefined;
    const emptyCall = () => undefined;

    return {
        each: noop,
        call: emptyCall,
        getName: () => 0,
        getParentNode: () => null,
        getValue: () => ({ comments: undefined })
    };
}

void test("buildCallLikeArgumentDocs returns empty parens when arguments is undefined", () => {
    // Cast to `any` so the test exercises the runtime guard even when the
    // upstream type signature has not yet been widened to mark `arguments`
    // as optional. Without this cast, the test would never compile against
    // the pre-fix code that required `arguments: Array<...>`.
    const malformedNode = { type: "CallExpression" } as any;
    const pathMock = createNullSafetyPathMock();

    assert.doesNotThrow(
        () => buildCallLikeArgumentDocs(malformedNode, pathMock, {}, () => null),
        "Expected buildCallLikeArgumentDocs to tolerate a missing arguments array."
    );
});

void test("buildCallLikeArgumentDocs returns empty parens when arguments is null", () => {
    const malformedNode = { type: "CallExpression", arguments: null } as any;
    const pathMock = createNullSafetyPathMock();

    assert.doesNotThrow(
        () => buildCallLikeArgumentDocs(malformedNode, pathMock, {}, () => null),
        "Expected buildCallLikeArgumentDocs to tolerate an explicit null arguments array."
    );
});

void test("buildCallLikeArgumentDocs returns empty parens when arguments is not an array", () => {
    const malformedNode = { type: "CallExpression", arguments: "not-an-array" } as any;
    const pathMock = createNullSafetyPathMock();

    assert.doesNotThrow(
        () => buildCallLikeArgumentDocs(malformedNode, pathMock, {}, () => null),
        "Expected buildCallLikeArgumentDocs to treat a non-array arguments field as empty."
    );
});
