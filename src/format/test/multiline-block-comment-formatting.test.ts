import assert from "node:assert";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";
import { normalizeFormattedOutput } from "../src/printer/normalize-formatted-output.js";

void describe("multi-line block comment formatting", () => {
    void it("formats multi-line block comments without * prefix on each line", async () => {
        const input = `/*
This is a multi-line comment
It continues on this line
Woah, still going
Almost done!
*/

var x = 1;`;

        const unexpected = `/*
 * This is a multi-line comment
 * It continues on this line
 * Woah, still going
 * Almost done!
 */

var x = 1;
`;

        const formatted = await Format.format(input, { parser: "gml" });
        assert.notEqual(formatted, unexpected);
        // The formatter always adds a trailing newline. The block comment body and
        // surrounding structure must be preserved verbatim — only a trailing "\n" is
        // appended. (The old `preserveTrailingNewlineForVerbatimTopLevelMultilineBlockComment`
        // fallback returned source unchanged, but that recovery strategy violated
        // target-state.md §3.2 and has been removed.)
        assert.equal(formatted, `${input}\n`);
    });

    void it("preserves non-doc top-level multi-line block comments without adding * prefixes", async () => {
        const input = `/*
This comment should remain plain text
No doc-style stars should be inserted
*/

var x = 1;
`;

        const formatted = await Format.format(input, { parser: "gml" });
        assert.strictEqual(formatted, input);
    });

    void it("preserves empty lines in multi-line block comments", async () => {
        const input = `/*

This is a comment with empty lines

And another line

*/

var x = 1;`;

        const expected = `/*

This is a comment with empty lines

And another line

*/

var x = 1;
`;

        const formatted = await Format.format(input, { parser: "gml" });
        assert.strictEqual(formatted, expected);
    });

    void it("preserves single-line block comments as-is", async () => {
        const input = `/* This is a single-line comment */
var x = 1;`;

        const expected = `/* This is a single-line comment */
var x = 1;
`;

        const formatted = await Format.format(input, { parser: "gml" });
        assert.strictEqual(formatted, expected);
    });

    void it("inserts blank line before top-level line comment following a single-line block comment", () => {
        // Regression: updateBlockCommentState incorrectly treated /* ... */ as
        // opening a block comment, causing the following top-level /// @description
        // to be skipped for blank-line insertion.
        const input =
            "/* single-line block comment */\n/// @description A description of this function\nfunction foo() {}\n";

        const normalized = normalizeFormattedOutput(input);

        assert.ok(
            normalized.includes("*/\n\n///"),
            `Expected a blank line between the block comment and the function's doc-comment.\nActual output:\n${normalized}`
        );
    });

    void it("does not remove duplicate doc-comment lines (deduplication is a lint-only operation)", () => {
        // The formatter must not strip or rewrite doc-comment content — that is a
        // semantic/content rewrite owned exclusively by the `@gmloop/lint`
        // `normalize-doc-comments` rule (target-state.md §2.2, §3.2).
        const input = "/* helper */\n/// @description Foo\n/// @description Foo\nfunction foo() {}\n";

        const normalized = normalizeFormattedOutput(input);
        const docLineCount = (normalized.match(/\/\/\/ @description Foo/g) ?? []).length;

        assert.strictEqual(
            docLineCount,
            2,
            `normalizeFormattedOutput must not remove duplicate doc lines — that is a lint-workspace responsibility.\nActual output:\n${normalized}`
        );
    });
});
