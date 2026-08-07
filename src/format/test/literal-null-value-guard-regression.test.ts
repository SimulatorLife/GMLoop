/**
 * Regression tests for the `tryPrintLiteralNode` null/non-string-value guard.
 *
 * `tryPrintLiteralNode` (in `src/format/src/printer/print.ts`) handles the
 * GML `Literal` node type. After normalising the `undefined` sentinel it
 * reads `node.value` and immediately calls `value.startsWith('"')`. A
 * Literal node whose `value` is not a string — for example `null` from a
 * parser recovery path or a synthetic AST fixture, or a primitive number /
 * boolean that was not normalised to its string form — would reach that
 * call and throw
 *   `TypeError: Cannot read properties of null/undefined (reading 'startsWith')`,
 * aborting the entire format pass. The fix short-circuits to the existing
 * `concat(value)` doc builder, which the doc sanitiser already turns into
 * an empty string for nullish values and passes numbers/booleans through
 * unchanged.
 *
 * Each test below constructs a synthetic `AstPath` whose `getValue()`
 * returns a malformed Literal node and asserts that the public `gmlPrint`
 * entry point produces a doc fragment without throwing.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import { gmlPrint } from "../src/printer/print.js";

/**
 * Builds a minimal Prettier `AstPath`-shaped mock suitable for driving
 * `gmlPrint` against a single synthetic node. `tryPrintLiteralNode` does
 * not recurse into children for the `Literal` case, so the mock only
 * needs to honour `getValue()` — every other path method would otherwise
 * explode if invoked.
 */
function makePath(currentValue: unknown): AstPath<any> {
    return {
        getValue: () => currentValue
    } as unknown as AstPath<any>;
}

const noOptions = {} as Parameters<typeof gmlPrint>[1];
const noPrint: Parameters<typeof gmlPrint>[2] = () => null;

void describe("tryPrintLiteralNode null/non-string-value guards", () => {
    void it("does not throw when Literal value is null", () => {
        // Before the guard this raised:
        //   TypeError: Cannot read properties of null (reading 'startsWith')
        // because the `undefined` sentinel check above does not match
        // `value === null` and execution fell into the string-only
        // branches. The fix bails out via `concat(null)`, which the doc
        // sanitiser normalises to the empty string.
        const result = gmlPrint(makePath({ type: "Literal", value: null }), noOptions, noPrint);
        assert.deepStrictEqual(result, [""]);
    });

    void it("does not throw when Literal value is a number", () => {
        // Numbers are a plausible non-string literal value (a synthetic
        // AST or a custom parser plugin may emit them). The previous
        // implementation would throw on `value.startsWith`; the fix
        // delegates to `concat`, which passes the number through to
        // Prettier's doc renderer unchanged.
        const result = gmlPrint(makePath({ type: "Literal", value: 42 }), noOptions, noPrint);
        assert.deepStrictEqual(result, [42]);
    });

    void it("does not throw when Literal value is a boolean", () => {
        // The doc builder normalises `true` to the string "true" and
        // `false` to the empty string. The guard ensures we route through
        // `concat` rather than crashing on a non-string value.
        const trueResult = gmlPrint(makePath({ type: "Literal", value: true }), noOptions, noPrint);
        assert.deepStrictEqual(trueResult, ["true"]);

        const falseResult = gmlPrint(makePath({ type: "Literal", value: false }), noOptions, noPrint);
        assert.deepStrictEqual(falseResult, [""]);
    });

    void it("preserves existing behaviour for the string 'undefined' sentinel", () => {
        // The `isUndefinedSentinel` branch above the new guard should
        // keep producing the `undefined` identifier text for the
        // keyword-as-string representation the parser emits.
        const result = gmlPrint(makePath({ type: "Literal", value: "undefined" }), noOptions, noPrint);
        assert.deepStrictEqual(result, ["undefined"]);
    });

    void it("preserves existing behaviour for an unquoted numeric string", () => {
        // Non-string guard must not regress the normal numeric-literal
        // path: the existing branches still fire when `value` is a
        // string, including the canonical integer form.
        const result = gmlPrint(makePath({ type: "Literal", value: "1" }), noOptions, noPrint);
        assert.deepStrictEqual(result, ["1"]);
    });
});
