import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";
import { isValidSourceTextType, SourceTextValidationError, validateSourceText } from "../../src/text/source-text.js";

function isFunctionSourceTextValidationError(error: unknown): boolean {
    return (
        error instanceof SourceTextValidationError &&
        error.message.includes("must be a string") &&
        error.message.includes("function")
    );
}

function invalidFunctionSourceText(): string {
    return "x = 42;";
}

void describe("validateSourceText", () => {
    void describe("successful validation", () => {
        void it("should accept valid non-empty strings", () => {
            const input = "x = 42;";
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept empty strings by default", () => {
            const input = "";
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept strings with special characters", () => {
            const input = 'var msg = "Hello, 世界! 🚀";';
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept multiline strings", () => {
            const input = "line1\nline2\rline3\r\nline4";
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept strings up to the maximum length", () => {
            const maxLength = 1000;
            const input = "x".repeat(maxLength);
            const result = validateSourceText(input, { maxLength });
            assert.equal(result, input);
        });
    });

    void describe("null and undefined handling", () => {
        void it("should reject null with descriptive error", () => {
            assert.throws(
                () => validateSourceText(null),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be null");
                }
            );
        });

        void it("should reject undefined with descriptive error", () => {
            assert.throws(
                () => validateSourceText(undefined),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be undefined");
                }
            );
        });
    });

    void describe("type validation", () => {
        void it("should reject numbers", () => {
            assert.throws(
                () => validateSourceText(123),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("number")
                    );
                }
            );
        });

        void it("should reject booleans", () => {
            assert.throws(
                () => validateSourceText(true),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("boolean")
                    );
                }
            );
        });

        void it("should reject objects", () => {
            assert.throws(
                () => validateSourceText({ text: "x = 42;" }),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("object")
                    );
                }
            );
        });

        void it("should reject arrays with descriptive type label", () => {
            assert.throws(
                () => validateSourceText(["x = 42;"] as unknown),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("array")
                    );
                }
            );
        });

        void it("should reject functions", () => {
            assert.throws(() => validateSourceText(invalidFunctionSourceText), isFunctionSourceTextValidationError);
        });

        void it("should reject symbols", () => {
            assert.throws(
                () => validateSourceText(Symbol("test")),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("symbol")
                    );
                }
            );
        });
    });

    void describe("length validation", () => {
        void it("should reject strings exceeding default maximum length", () => {
            const maxLength = 10 * 1024 * 1024;
            const input = "x".repeat(maxLength + 1);

            assert.throws(
                () => validateSourceText(input),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("exceeds maximum allowed length") &&
                        error.message.includes(String(maxLength))
                    );
                }
            );
        });

        void it("should reject strings exceeding custom maximum length", () => {
            const maxLength = 100;
            const input = "x".repeat(maxLength + 1);

            assert.throws(
                () => validateSourceText(input, { maxLength }),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("exceeds maximum allowed length") &&
                        error.message.includes(String(maxLength)) &&
                        error.message.includes(String(input.length))
                    );
                }
            );
        });

        void it("should accept strings at exact maximum length boundary", () => {
            const maxLength = 100;
            const input = "x".repeat(maxLength);
            const result = validateSourceText(input, { maxLength });
            assert.equal(result, input);
        });
    });

    void describe("empty string handling", () => {
        void it("should reject empty strings when allowEmpty is false", () => {
            assert.throws(
                () => validateSourceText("", { allowEmpty: false }),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be empty");
                }
            );
        });

        void it("should accept empty strings when allowEmpty is true", () => {
            const result = validateSourceText("", { allowEmpty: true });
            assert.equal(result, "");
        });

        void it("should accept whitespace-only strings even when allowEmpty is false", () => {
            const input = "   \n\t  ";
            const result = validateSourceText(input, { allowEmpty: false });
            assert.equal(result, input);
        });
    });

    void describe("combined options", () => {
        void it("should enforce both maxLength and allowEmpty constraints", () => {
            const maxLength = 50;
            const input = "x".repeat(maxLength + 1);

            assert.throws(
                () => validateSourceText(input, { maxLength, allowEmpty: false }),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("exceeds maximum allowed length")
                    );
                }
            );
        });

        void it("should validate empty string rejection before length check", () => {
            assert.throws(
                () => validateSourceText("", { maxLength: 100, allowEmpty: false }),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be empty");
                }
            );
        });
    });
});

void describe("isValidSourceTextType", () => {
    void it("should return true for non-empty strings", () => {
        assert.equal(isValidSourceTextType("x = 42;"), true);
    });

    void it("should return true for empty strings", () => {
        assert.equal(isValidSourceTextType(""), true);
    });

    void it("should return false for null", () => {
        assert.equal(isValidSourceTextType(null), false);
    });

    void it("should return false for undefined", () => {
        assert.equal(isValidSourceTextType(undefined), false);
    });

    void it("should return false for numbers", () => {
        assert.equal(isValidSourceTextType(123), false);
    });

    void it("should return false for booleans", () => {
        assert.equal(isValidSourceTextType(true), false);
    });

    void it("should return false for objects", () => {
        assert.equal(isValidSourceTextType({ text: "x = 42;" }), false);
    });

    void it("should return false for arrays", () => {
        assert.equal(isValidSourceTextType(["x = 42;"]), false);
    });

    void it("should narrow type in conditional branches", () => {
        const input: unknown = "x = 42;";
        if (isValidSourceTextType(input)) {
            const length: number = input.length;
            assert.equal(typeof length, "number");
        }
    });
});

void describe("SourceTextValidationError", () => {
    void it("should be an instance of TypeError", () => {
        const error = new SourceTextValidationError("test error");
        assert.ok(error instanceof TypeError);
    });

    void it("should have correct error name", () => {
        const error = new SourceTextValidationError("test error");
        assert.equal(error.name, "SourceTextValidationError");
    });

    void it("should preserve error message", () => {
        const message = "custom validation failure";
        const error = new SourceTextValidationError(message);
        assert.equal(error.message, message);
    });

    void it("should be catchable as Error", () => {
        try {
            throw new SourceTextValidationError("test");
        } catch (error) {
            assert.ok(error instanceof Error);
        }
    });
});

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

void describe("string-comment scan helpers", () => {
    void it("tracks quoted strings and escapes", () => {
        const text = String.raw`"a\"b"`;
        const state = Core.createStringCommentScanState();

        let index = Core.tryStartStringOrComment(text, text.length, 0, state);
        assert.strictEqual(index, 1);
        assert.strictEqual(state.stringQuote, '"');

        index = Core.advanceThroughStringLiteral(text, index, state);
        assert.strictEqual(index, 2);

        index = Core.advanceThroughStringLiteral(text, index, state);
        assert.strictEqual(index, 3);

        index = Core.advanceThroughStringLiteral(text, index, state);
        assert.strictEqual(index, 4);

        index = Core.advanceThroughStringLiteral(text, index, state);
        assert.strictEqual(index, 5);

        index = Core.advanceThroughStringLiteral(text, index, state);
        assert.strictEqual(index, 6);
        assert.strictEqual(state.stringQuote, null);
    });

    void it("advances through line comments until newline", () => {
        const text = "// hi\nx";
        const state = Core.createStringCommentScanState();

        let index = Core.tryStartStringOrComment(text, text.length, 0, state);
        assert.strictEqual(state.inLineComment, true);

        while (state.inLineComment && index < text.length) {
            index = Core.advanceThroughComment(text, text.length, index, state);
        }

        assert.strictEqual(state.inLineComment, false);
        assert.strictEqual(text[index], "x");
    });

    void it("advances through block comments until closing token", () => {
        const text = "/* note */x";
        const state = Core.createStringCommentScanState();

        let index = Core.tryStartStringOrComment(text, text.length, 0, state);
        assert.strictEqual(state.inBlockComment, true);

        while (state.inBlockComment && index < text.length) {
            index = Core.advanceThroughComment(text, text.length, index, state);
        }

        assert.strictEqual(state.inBlockComment, false);
        assert.strictEqual(text[index], "x");
    });

    void it("advances through @-prefixed strings when enabled", () => {
        const text = '@"hi" {';
        const state = Core.createStringCommentScanState();

        let index = Core.advanceStringCommentScan(text, text.length, 0, state, true);
        assert.strictEqual(index, 2);
        assert.strictEqual(state.stringQuote, '"');

        while (state.stringQuote && index < text.length) {
            index = Core.advanceStringCommentScan(text, text.length, index, state, true);
        }

        assert.strictEqual(state.stringQuote, null);
        assert.strictEqual(text[index], " ");
    });

    void it("skips @-prefixed strings when disabled", () => {
        const text = '@"hi"';
        const state = Core.createStringCommentScanState();

        const index = Core.advanceStringCommentScan(text, text.length, 0, state, false);
        assert.strictEqual(index, 0);
        assert.strictEqual(state.stringQuote, null);
    });
});

function computeDominantLineEndingWithReferenceRegex(text: string): "\r\n" | "\n" {
    const crlfCount = (text.match(/\r\n/g) ?? []).length;
    const lfCount = (text.match(/(?<!\r)\n/g) ?? []).length;
    return crlfCount > lfCount ? "\r\n" : "\n";
}
