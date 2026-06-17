/**
 * Regression tests for the `printInBlock` null/undefined guard.
 *
 * `printInBlock` reads the current AST node from the Prettier `AstPath` and
 * dereferences a named sub-node (e.g. `node.body`, `node.alternate`,
 * `node.block`). A malformed AST, a synthetic fixture, or a test mock can
 * leave either the path value or the requested sub-node as null/undefined.
 * Without a guard the function would throw `TypeError: Cannot read
 * properties of null/undefined (reading 'type')` and abort the entire
 * format pass.
 *
 * Each test pins one branch of the guard so the failure mode is
 * reproducible and so a future regression that removes the guard surfaces
 * as a single, localized test failure rather than a wider cascade.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import { printInBlock } from "../src/printer/print.js";

/**
 * Builds a minimal Prettier `AstPath`-shaped mock where `getValue()`
 * returns the supplied value and `call`/`each`/`map` would raise if
 * invoked.  `printInBlock` must never reach those for the guarded paths.
 */
function makePath(currentValue: unknown): AstPath<any> {
    return {
        getValue: () => currentValue
    } as unknown as AstPath<any>;
}

const noOptions = {} as Parameters<typeof printInBlock>[1];
const noPrint: Parameters<typeof printInBlock>[2] = () => null;

void describe("printInBlock null safety guards", () => {
    void it("returns a fallback block when path.getValue() yields null", () => {
        // Before the guard this threw "Cannot read properties of null
        // (reading 'body')" because `parentNode[expressionKey]` was
        // evaluated on a null parent.
        const result = printInBlock(makePath(null), noOptions, noPrint, "body");
        assert.strictEqual(result, "{}");
    });

    void it("returns a fallback block when path.getValue() yields undefined", () => {
        const result = printInBlock(makePath(undefined), noOptions, noPrint, "body");
        assert.strictEqual(result, "{}");
    });

    void it("returns a fallback block when the named sub-node is null", () => {
        // A real IfStatement-like node whose `alternate` is null (the
        // no-`else` branch) should not crash — even if the parent
        // dispatch path were to forget the upstream `=== null` guard.
        const parent = { type: "IfStatement", alternate: null };
        const result = printInBlock(makePath(parent), noOptions, noPrint, "alternate");
        assert.strictEqual(result, "{}");
    });

    void it("returns a fallback block when the named sub-node is undefined", () => {
        // Synthetic fixtures occasionally omit properties entirely.
        const parent = { type: "IfStatement" } as Record<string, unknown>;
        const result = printInBlock(makePath(parent), noOptions, noPrint, "alternate");
        assert.strictEqual(result, "{}");
    });

    void it("returns a fallback block when the sub-node is missing a type field", () => {
        // A partial node such as { body: {} } should not crash on the
        // `node.type` dereference; the guard now treats it as malformed.
        const parent = { type: "WhileStatement", body: {} };
        const result = printInBlock(makePath(parent), noOptions, noPrint, "body");
        assert.strictEqual(result, "{}");
    });

    void it("does not invoke the print callback when guarding against missing data", () => {
        // The fallback path must not recurse into `print(expressionKey)`;
        // otherwise downstream printers would observe a null `parent` and
        // blow up.  This pins the contract that the guard short-circuits.
        let printInvocations = 0;
        const recordingPrint = (key: string) => {
            printInvocations += 1;
            assert.ok(key, "print should not be called without a key");
            return null;
        };

        printInBlock(makePath(null), noOptions, recordingPrint, "body");
        assert.strictEqual(printInvocations, 0, "print callback should not be invoked when the parent node is missing");
    });
});
