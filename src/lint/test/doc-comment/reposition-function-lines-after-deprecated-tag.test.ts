import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { repositionFunctionLinesAfterDeprecatedTag } from "../../src/doc-comment/index.js";
import { createDocTagHelpers } from "../../src/doc-comment/synthetic-merge-tag-helpers.js";

const helpers = createDocTagHelpers();

/**
 * Build a `MutableDocCommentLines`-shaped array for tests. The actual
 * runtime type lives in `@gmloop/core` and carries a few well-known
 * sentinel flags (`_suppressLeadingBlank`, `_preserveDescriptionBreaks`).
 * The helper installs the same string-array surface the merge pipeline
 * hands the production helper, so the test exercises the same code path
 * without depending on the core package's mutable-array type alias.
 */
function createMutableDocLines(lines: Array<string>, options: { suppressLeadingBlank?: boolean } = {}): Array<string> {
    const result = lines.slice();
    if (options.suppressLeadingBlank) {
        Object.defineProperty(result, "_suppressLeadingBlank", {
            configurable: true,
            enumerable: false,
            writable: true,
            value: true
        });
    }
    return result;
}

void describe("repositionFunctionLinesAfterDeprecatedTag", () => {
    void it("returns the original lines untouched when no function line is present", () => {
        const original = createMutableDocLines(["/// @description", "/// @deprecated", "/// @param x"]);

        const result = repositionFunctionLinesAfterDeprecatedTag(original, helpers);

        assert.strictEqual(result, original);
        assert.deepStrictEqual([...result], ["/// @description", "/// @deprecated", "/// @param x"]);
    });

    void it("returns the original lines untouched when no @deprecated tag is present", () => {
        const original = createMutableDocLines(["/// @description", "/// @function example", "/// @param x"]);

        const result = repositionFunctionLinesAfterDeprecatedTag(original, helpers);

        assert.strictEqual(result, original);
        assert.deepStrictEqual([...result], ["/// @description", "/// @function example", "/// @param x"]);
    });

    void it("moves function lines directly after the @deprecated tag, dropping blank padding between them", () => {
        // Regression: the previous implementation relied on a
        // `while (insertIndex < ... && remainingLines[insertIndex] === "")`
        // loop with `splice(insertIndex, 1)` to drop blank lines that
        // followed the @deprecated tag. That worked because each splice
        // shifts subsequent elements down by one and exposes the next
        // candidate at the same slot, but the contract was non-obvious
        // and a future edit that added a manual `insertIndex += 1`
        // would silently skip past non-empty lines. The filter-based
        // rewrite makes the skip-blanks rule explicit in a single
        // predicate and the assertion below pins down the expected
        // final ordering so any future regression is caught here.
        const result = repositionFunctionLinesAfterDeprecatedTag(
            createMutableDocLines([
                "/// @description Legacy helper",
                "/// @deprecated",
                "",
                "",
                "/// @function example",
                "/// @param x",
                "/// @returns {real}"
            ]),
            helpers
        );

        assert.deepStrictEqual(
            [...result],
            [
                "/// @description Legacy helper",
                "/// @deprecated",
                "/// @function example",
                "/// @param x",
                "/// @returns {real}"
            ]
        );
    });

    void it("uses the LAST @deprecated tag as the insertion anchor", () => {
        // Two @deprecated tags are rare in real fixtures but the helper
        // selects the last one via `findLastIndex`. Pin that contract so
        // a future regression that switches back to `findIndex` is caught
        // here without needing a full merge-pipeline integration test.
        // The helper also consolidates every function line after the last
        // @deprecated tag; we lock that in here so a future refactor that
        // accidentally anchors on the first tag (and would leave an
        // earlier function line stranded between the two @deprecated
        // tags) is caught.
        const result = repositionFunctionLinesAfterDeprecatedTag(
            createMutableDocLines([
                "/// @description Two deprecation waves",
                "/// @deprecated since 1.0",
                "/// @function oldImpl",
                "/// @deprecated since 2.0",
                "",
                "/// @function currentImpl",
                "/// @param x"
            ]),
            helpers
        );

        assert.deepStrictEqual(
            [...result],
            [
                "/// @description Two deprecation waves",
                "/// @deprecated since 1.0",
                "/// @deprecated since 2.0",
                "/// @function oldImpl",
                "/// @function currentImpl",
                "/// @param x"
            ]
        );
    });

    void it("preserves the _suppressLeadingBlank sentinel on the rewritten array", () => {
        const original = createMutableDocLines(["/// @deprecated", "", "/// @function example", "/// @param x"], {
            suppressLeadingBlank: true
        });

        const result = repositionFunctionLinesAfterDeprecatedTag(original, helpers);

        assert.notStrictEqual(result, original, "the helper should return a fresh array when it relocates lines");
        assert.strictEqual((result as { _suppressLeadingBlank?: boolean })._suppressLeadingBlank, true);
        assert.deepStrictEqual([...result], ["/// @deprecated", "/// @function example", "/// @param x"]);
    });

    void it("does not mutate the input array while relocating lines", () => {
        // Defensive guarantee: the rewrite is supposed to return a fresh
        // array built from a filtered snapshot. If a future change
        // re-introduced an in-place splice-during-iteration pattern on
        // the caller's array, this assertion would catch the regression
        // because the original would no longer match its pre-call shape.
        const original = createMutableDocLines([
            "/// @description Example",
            "/// @deprecated",
            "",
            "",
            "/// @function example",
            "/// @param x"
        ]);
        const snapshot = [...original];

        const result = repositionFunctionLinesAfterDeprecatedTag(original, helpers);

        assert.deepStrictEqual([...original], snapshot, "input array must remain unchanged");
        assert.notDeepStrictEqual([...result], snapshot, "rewritten array should differ from the input");
    });
});
