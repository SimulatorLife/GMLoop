import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";

void describe("line-breaks", () => {
    void describe("splitLines", () => {
        void it("splits common newline sequences", () => {
            const text = "alpha\r\nbeta\ngamma\rdelta\u2028epsilon\u2029theta\u0085iota";

            assert.deepStrictEqual(Core.splitLines(text), [
                "alpha",
                "beta",
                "gamma",
                "delta",
                "epsilon",
                "theta",
                "iota"
            ]);
        });

        void it("returns a single entry for text without newlines", () => {
            const text = "single line";
            assert.deepStrictEqual(Core.splitLines(text), [text]);
        });

        void it("normalizes non-string input to an empty array", () => {
            // explicit undefined mirrors optional metadata usage
            assert.deepStrictEqual(Core.splitLines(undefined), []);
            assert.deepStrictEqual(Core.splitLines(null), []);
        });

        void it("mirrors String#split for empty strings", () => {
            assert.deepStrictEqual(Core.splitLines(""), [""]);
        });
    });

    void describe("getLineBreakCount", () => {
        void it("counts the number of recognized break characters", () => {
            const text = "line1\r\nline2\nline3\rline4\u2028line5\u2029line6";
            assert.strictEqual(Core.getLineBreakCount(text), 5);
        });
    });

    void describe("getLineBreakSpans", () => {
        void it("locates each line break sequence", () => {
            const text = "alpha\r\nbeta\n\r\u2028gamma\u2029delta\u0085";
            assert.deepStrictEqual(Core.getLineBreakSpans(text), [
                { index: 5, length: 2 },
                { index: 11, length: 1 },
                { index: 12, length: 1 },
                { index: 13, length: 1 },
                { index: 19, length: 1 },
                { index: 25, length: 1 }
            ]);
        });
    });

    void describe("dominantLineEnding", () => {
        void it("returns LF for a file that uses only LF line endings", () => {
            assert.strictEqual(Core.dominantLineEnding("line1\nline2\nline3\n"), "\n");
        });

        void it("returns CRLF for a file that uses only CRLF line endings", () => {
            assert.strictEqual(Core.dominantLineEnding("line1\r\nline2\r\nline3\r\n"), "\r\n");
        });

        void it("returns the dominant ending when CRLF is strictly more common than LF", () => {
            // 3 CRLF vs 1 bare LF → dominant is CRLF
            assert.strictEqual(Core.dominantLineEnding("a\r\nb\r\nc\r\nd\ne"), "\r\n");
        });

        void it("returns LF when LF is strictly more common than CRLF", () => {
            // 1 CRLF vs 3 bare LF → dominant is LF
            assert.strictEqual(Core.dominantLineEnding("a\r\nb\nc\nd\ne"), "\n");
        });

        void it("returns LF as the tie-break default when counts are equal", () => {
            // 1 CRLF vs 1 bare LF → tie, defaults to LF
            assert.strictEqual(Core.dominantLineEnding("a\r\nb\nc"), "\n");
        });

        void it("ignores bare carriage returns when counting LF-vs-CRLF dominance", () => {
            assert.strictEqual(Core.dominantLineEnding("a\rb\r\nc\rd\n"), "\n");
        });

        void it("matches a reference implementation across mixed newline sequences", () => {
            const text = ["alpha", "\r\n", "beta", "\n", "gamma", "\r", "delta", "\r\n", "epsilon", "\n", "zeta"].join(
                ""
            );
            const expected = computeDominantLineEndingWithReferenceRegex(text);

            assert.strictEqual(Core.dominantLineEnding(text), expected);
        });

        void it("returns LF for text with no line breaks", () => {
            assert.strictEqual(Core.dominantLineEnding("no newlines here"), "\n");
        });
    });
});

function computeDominantLineEndingWithReferenceRegex(text: string): "\r\n" | "\n" {
    const crlfCount = (text.match(/\r\n/g) ?? []).length;
    const lfCount = (text.match(/(?<!\r)\n/g) ?? []).length;
    return crlfCount > lfCount ? "\r\n" : "\n";
}
