/**
 * Regression guard: `buildPrintableDocCommentLines` must build a fresh doc
 * array without rewriting the caller's input.
 *
 * Why this guard exists:
 *   - The previous implementation called a `coerceDocCommentEntriesToRawLines`
 *     helper that wrote raw-text strings back into the input array via
 *     `docCommentDocs[index] = rawText` while iterating it. Callers that
 *     passed the array by reference observed their data being silently
 *     mutated, which is the same class of "loop modifies the iterable
 *     during traversal" hazard the recent batch-helper cleanup removed
 *     elsewhere (see PR #10603, `ScopeTracker` empty invalidation sets).
 *   - The doc-comment printer worked around that hazard by taking a
 *     defensive shallow copy before each call. Removing the in-place
 *     mutation lets callers drop the defensive copy.
 *   - The tests below pin the new contract: the caller's input array is
 *     left alone regardless of entry shape, and the returned array owns
 *     its own contents so subsequent rewrites of the input cannot bleed
 *     into the printable output.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPrintableDocCommentLines } from "../src/comments/description-doc.js";

void describe("buildPrintableDocCommentLines", () => {
    void it("does not mutate the input array of string entries", () => {
        const input = ["/// @function demo", "/// @param {real} value"];
        const snapshot = [...input];

        const output = buildPrintableDocCommentLines(input, null);

        assert.deepStrictEqual(input, snapshot, "Input array must be left untouched after the call");
        assert.deepStrictEqual(output, snapshot, "Output mirrors the input for plain string entries");
    });

    void it("does not overwrite AST comment-node slots in the input array", () => {
        const input = [
            { type: "CommentLine", start: { index: 0 }, end: { index: 22 } },
            { type: "CommentLine", start: { index: 23 }, end: { index: 46 } }
        ];
        const snapshot = input.map((entry) => ({ ...entry }));

        buildPrintableDocCommentLines(input, "/// @function demo\n/// @param {real} value\n");

        assert.deepStrictEqual(
            input,
            snapshot,
            "AST comment nodes in the input array must stay intact; the helper must not coerce them in place"
        );
        assert.ok(
            typeof input[0] === "object" && !Array.isArray(input[0]),
            "Input slot zero must remain an object (not a coerced string)"
        );
        assert.ok(
            typeof input[1] === "object" && !Array.isArray(input[1]),
            "Input slot one must remain an object (not a coerced string)"
        );
    });

    void it("returns an output array that is independent of later caller mutations", () => {
        const input = ["/// first", "/// second"];
        const output = buildPrintableDocCommentLines(input, null);

        // Simulate a downstream caller rewriting the input after taking the
        // printable output. The old implementation mutated the input first
        // and then reused values from the same backing array, which meant
        // later caller-side rewrites could be observable via the cached
        // output. Pin the new contract that `output` is owned by the helper
        // and immune to caller-side rewrites of the input.
        input.length = 0;
        input.push("/// replaced");

        assert.deepStrictEqual(output, ["/// first", "/// second"]);
    });

    void it("returns a fresh array even when the input is a frozen shared reference", () => {
        const shared = ["/// @function demo", "/// @param {real} value"];
        const snapshot = Object.freeze([...shared]);

        const output = buildPrintableDocCommentLines(shared, null);

        assert.deepStrictEqual(
            shared,
            snapshot,
            "Even frozen arrays must remain untouched; the helper must not attempt in-place rewrites"
        );
        assert.deepStrictEqual(output, ["/// @function demo", "/// @param {real} value"]);
        assert.notStrictEqual(output, shared, "Returned array is not the same reference as the input");
    });
});
