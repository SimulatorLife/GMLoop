/**
 * Regression tests for the `printNewExpressionNode` arguments null/undefined guard.
 *
 * `printNewExpressionNode` previously read `node.arguments.length` directly when
 * deciding whether to render a `new Foo()` versus `new Foo(...)` form. A
 * malformed `NewExpression` (a synthetic node produced during normalization,
 * a partial fixture, or an in-memory AST built by lint/refactor rewrites) can
 * legitimately leave `arguments` as `null` or `undefined`. Without the guard
 * the printer threw `TypeError: Cannot read properties of undefined (reading
 * 'length')` and aborted the entire format pass.
 *
 * The fix mirrors the one already applied to the sibling `printCallExpressionNode`
 * / `buildCallLikeArgumentDocs` paths (commit d4f38981f, PR #9160) and pins
 * the contract here so a future regression that re-introduces a direct
 * `node.arguments.length` dereference on a possibly-undefined value surfaces
 * as a single, localised test failure rather than a wider cascade through
 * the format pipeline.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import { printNewExpressionNode } from "../src/printer/print.js";

/**
 * Builds a minimal Prettier `AstPath`-shaped mock where `getValue()`
 * returns the supplied value. `printNewExpressionNode` only invokes the
 * Prettier `print` callback on the `"expression"` key (handled below) and
 * never recurses, so the path mock does not need `call`/`each`/`map`.
 */
function makePath(currentValue: unknown): AstPath<any> {
    return {
        getValue: () => currentValue
    } as unknown as AstPath<any>;
}

/**
 * The `print` callback handed to `printNewExpressionNode` is only invoked on
 * the `"expression"` key in the guarded branch. Returning a literal "X" makes
 * the resulting doc deterministic and easy to inspect.
 */
const noOptions = {} as Parameters<typeof printNewExpressionNode>[2];
const recordingPrint: Parameters<typeof printNewExpressionNode>[3] = (key) => {
    assert.ok(key, "print should be invoked with a key");
    return `printed:${String(key)}`;
};

void describe("printNewExpressionNode arguments null safety guards", () => {
    void it("falls back to empty-parens form when arguments is undefined", () => {
        // Before the guard this threw "Cannot read properties of undefined
        // (reading 'length')" because the early-return branch read
        // `node.arguments.length` directly.
        const node = { type: "NewExpression", expression: { type: "Identifier", name: "Foo" } };
        const result = printNewExpressionNode(node, makePath(node), noOptions, recordingPrint);
        assert.ok(result, "Expected a non-empty doc for a NewExpression with undefined arguments");
    });

    void it("falls back to empty-parens form when arguments is null", () => {
        // A `null` `arguments` property is equally malformed from the AST
        // contract's perspective; the guard must treat it the same as
        // `undefined` rather than letting `null.length` throw.
        const node = { type: "NewExpression", expression: { type: "Identifier", name: "Foo" }, arguments: null };
        const result = printNewExpressionNode(node, makePath(node), noOptions, recordingPrint);
        assert.ok(result, "Expected a non-empty doc for a NewExpression with null arguments");
    });

    void it("falls back to empty-parens form when arguments is an empty array", () => {
        // The original (pre-guard) behaviour for an empty array is preserved
        // verbatim so callers relying on `new Foo()` formatting continue to
        // see the same output shape.
        const node = { type: "NewExpression", expression: { type: "Identifier", name: "Foo" }, arguments: [] };
        const result = printNewExpressionNode(node, makePath(node), noOptions, recordingPrint);
        assert.ok(result, "Expected a non-empty doc for a NewExpression with an empty arguments array");
    });

    void it("does not delegate to buildCallLikeArgumentDocs when arguments is missing", () => {
        // `buildCallLikeArgumentDocs` performs its own array-shape checks,
        // but the printer's outer guard short-circuits before reaching it
        // for missing-argument nodes. This test pins the contract that the
        // guarded branch stays inside `printNewExpressionNode` and never
        // hands off a malformed node to the layout helper.
        let callbackInvocations = 0;
        const countingPrint: Parameters<typeof printNewExpressionNode>[3] = (key) => {
            callbackInvocations += 1;
            return `printed:${String(key)}`;
        };

        const node = { type: "NewExpression", expression: { type: "Identifier", name: "Foo" } };
        printNewExpressionNode(node, makePath(node), noOptions, countingPrint);
        // The guarded branch invokes `print("expression")` exactly once; if
        // a future regression re-routes through `buildCallLikeArgumentDocs`
        // for a missing-arguments node, that helper would invoke the
        // callback on additional keys and the assertion would catch it.
        assert.strictEqual(callbackInvocations, 1, "Expected exactly one print callback invocation");
    });
});
