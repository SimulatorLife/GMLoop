import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";
import {
    canStartArgumentExpression,
    canTerminateArgumentExpression,
    findNextLineStart,
    findNextNonWhitespaceIndex,
    findPreviousNonWhitespaceIndex,
    forEachWhitespaceRunWithAdjacentTokens,
    type IdentifierToken,
    isArgumentBoundaryCharacter,
    isDirectiveLineAtIndex,
    isIdentifierCharacter,
    isLikelyCallArgumentGap,
    isLineTerminator,
    maskCommentsAndStringsForRecovery,
    readIdentifierTokenEndingAt,
    readIdentifierTokenStartingAt
} from "../../src/text/argument-separator-detection.js";

void describe("argument-separator-detection character predicates", () => {
    void it("isIdentifierCharacter matches ASCII letters, digits, and underscore only", () => {
        assert.equal(isIdentifierCharacter("a"), true);
        assert.equal(isIdentifierCharacter("Z"), true);
        assert.equal(isIdentifierCharacter("_"), true);
        assert.equal(isIdentifierCharacter("7"), true);
        assert.equal(isIdentifierCharacter("$"), false);
        assert.equal(isIdentifierCharacter(" "), false);
    });

    void it("canTerminateArgumentExpression accepts identifiers, quotes, and closing brackets", () => {
        for (const character of ["a", "Z", "_", "9", '"', "'", ")", "]", "}"]) {
            assert.equal(canTerminateArgumentExpression(character), true, `expected "${character}" to terminate`);
        }

        for (const character of ["(", "[", "{", "+", ";", " "]) {
            assert.equal(canTerminateArgumentExpression(character), false, `expected "${character}" not to terminate`);
        }
    });

    void it("canStartArgumentExpression accepts identifiers, quotes, and opening brackets", () => {
        for (const character of ["a", "Z", "_", "9", '"', "'", "(", "[", "{"]) {
            assert.equal(canStartArgumentExpression(character), true, `expected "${character}" to start`);
        }

        for (const character of [")", "]", "}", "+", ";", " "]) {
            assert.equal(canStartArgumentExpression(character), false, `expected "${character}" not to start`);
        }
    });

    void it("isArgumentBoundaryCharacter recognizes closers and commas only", () => {
        for (const character of [")", "]", "}", ","]) {
            assert.equal(isArgumentBoundaryCharacter(character), true);
        }
        for (const character of ["(", "[", "{", "a", " ", "\n"]) {
            assert.equal(isArgumentBoundaryCharacter(character), false);
        }
    });

    void it("isLineTerminator matches CR and LF only", () => {
        assert.equal(isLineTerminator("\n"), true);
        assert.equal(isLineTerminator("\r"), true);
        assert.equal(isLineTerminator("\u2028"), false);
        assert.equal(isLineTerminator("a"), false);
    });

    void it("matches the values exported through Core", () => {
        assert.equal(Core.isIdentifierCharacter("a"), isIdentifierCharacter("a"));
        assert.equal(Core.canTerminateArgumentExpression("a"), canTerminateArgumentExpression("a"));
        assert.equal(Core.canStartArgumentExpression("("), canStartArgumentExpression("("));
        assert.equal(Core.isArgumentBoundaryCharacter("]"), isArgumentBoundaryCharacter("]"));
        assert.equal(Core.isLineTerminator("\n"), isLineTerminator("\n"));
    });
});

void describe("identifier token reads", () => {
    void it("readIdentifierTokenEndingAt returns the identifier ending at the cursor", () => {
        const token: IdentifierToken | null = readIdentifierTokenEndingAt("foo bar", 2);
        assert.deepEqual(token, Object.freeze({ value: "foo", start: 0 }));
    });

    void it("readIdentifierTokenEndingAt returns null when the cursor is not on an identifier", () => {
        assert.equal(readIdentifierTokenEndingAt("foo bar", 3), null);
    });

    void it("readIdentifierTokenStartingAt returns the identifier beginning at the cursor", () => {
        assert.equal(readIdentifierTokenStartingAt("foo bar", 4), "bar");
    });

    void it("readIdentifierTokenStartingAt returns null when the cursor is not on an identifier", () => {
        assert.equal(readIdentifierTokenStartingAt("foo bar", 3), null);
    });
});

void describe("whitespace index helpers", () => {
    void it("findPreviousNonWhitespaceIndex skips whitespace before startIndex", () => {
        assert.equal(findPreviousNonWhitespaceIndex("ab   c", 4, false), 1);
    });

    void it("findPreviousNonWhitespaceIndex honours line breaks when requested", () => {
        assert.equal(findPreviousNonWhitespaceIndex("ab\n  c", 4, true), null);
        assert.equal(findPreviousNonWhitespaceIndex("ab\n  c", 4, false), 1);
    });

    void it("findNextNonWhitespaceIndex skips whitespace after startIndex", () => {
        assert.equal(findNextNonWhitespaceIndex("ab   cd", 1), 5);
    });

    void it("findNextNonWhitespaceIndex returns null when there is no following token", () => {
        assert.equal(findNextNonWhitespaceIndex("abc   ", 2), null);
    });

    void it("matches the values exposed through Core", () => {
        assert.equal(
            Core.findPreviousNonWhitespaceIndex("ab c", 3, false),
            findPreviousNonWhitespaceIndex("ab c", 3, false)
        );
        assert.equal(Core.findNextNonWhitespaceIndex("ab c", 0), findNextNonWhitespaceIndex("ab c", 0));
    });
});

void describe("findNextLineStart", () => {
    void it("returns the offset immediately after the next newline", () => {
        assert.equal(findNextLineStart("foo\nbar\nbaz", 0), 4);
        assert.equal(findNextLineStart("foo\nbar\nbaz", 4), 8);
    });

    void it("returns sourceText.length when the line has no terminator", () => {
        assert.equal(findNextLineStart("single line", 0), "single line".length);
    });
});

void describe("isDirectiveLineAtIndex", () => {
    void it("recognises #region, #macro, and #define lines", () => {
        const sourceText = "var x = 1;\n#region Shared\n#macro foo 1\n  #define bar 2\nval = x;";
        assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("#region")), true);
        assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("#macro")), true);
        assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("#define")), true);
        assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("val")), false);
    });

    void it("ignores non-# first non-whitespace characters", () => {
        const sourceText = "// comment\nvar x = 1;\n  val = x;";
        assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("var")), false);
        assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("val")), false);
    });
});

void describe("maskCommentsAndStringsForRecovery", () => {
    void it("replaces line comment contents with spaces while preserving the trailing newline", () => {
        const sourceText = "foo // hide me\nbar";
        const masked = maskCommentsAndStringsForRecovery(sourceText);
        assert.equal(masked.length, sourceText.length);
        assert.equal(masked.startsWith("foo  "), true);
        assert.equal(masked.includes("//"), false);
        assert.equal(masked.includes("hide"), false);
        assert.equal(masked.endsWith("\nbar"), true);
    });

    void it("replaces block comment contents with spaces while preserving length", () => {
        const sourceText = "foo /* drop\nthis */ bar";
        const masked = maskCommentsAndStringsForRecovery(sourceText);
        assert.equal(masked.length, sourceText.length);
        assert.equal(masked.startsWith("foo  "), true);
        assert.equal(masked.includes("/*"), false);
        assert.equal(masked.includes("*/"), false);
        assert.equal(masked.includes("drop"), false);
        assert.equal(masked.includes("this"), false);
        assert.equal(masked.endsWith(" bar"), true);
    });

    void it("replaces string literal contents with spaces but preserves the closing delimiter quote", () => {
        const sourceText = 'foo "hello world" bar';
        const masked = maskCommentsAndStringsForRecovery(sourceText);
        assert.equal(masked.length, sourceText.length);
        assert.equal(masked.includes("hello"), false);
        assert.equal(masked.endsWith('" bar'), true);
        // Confirm the closing delimiter survives by looking up its source offset.
        const closingQuoteIndex = sourceText.lastIndexOf('"');
        assert.equal(masked[closingQuoteIndex], '"');
    });

    void it("masks directive lines when maskDirectiveLines is true", () => {
        const sourceText = "var x = 1;\n#region Shared\nval = x;";
        const masked = maskCommentsAndStringsForRecovery(sourceText, { maskDirectiveLines: true });
        assert.equal(masked.includes("#region"), false);
        assert.equal(masked.includes("Shared"), false);
    });

    void it("leaves directive lines alone when maskDirectiveLines is false", () => {
        const sourceText = "#region Shared\nval = x;";
        const masked = maskCommentsAndStringsForRecovery(sourceText);
        assert.equal(masked.startsWith("#region Shared"), true);
    });

    void it("is reachable through the Core namespace", () => {
        const sourceText = "foo /* drop */ bar";
        assert.equal(Core.maskCommentsAndStringsForRecovery(sourceText), maskCommentsAndStringsForRecovery(sourceText));
    });
});

void describe("isLikelyCallArgumentGap", () => {
    void it("accepts whitespace inside a function call", () => {
        const sourceText = "foo(a   b)";
        const gapStart = sourceText.indexOf("a   ") + 1;
        assert.equal(isLikelyCallArgumentGap(sourceText, gapStart + 2), true);
    });

    void it("rejects whitespace inside an if (...) parenthesised group", () => {
        const sourceText = "if (a   b) {}";
        const gapStart = sourceText.indexOf("a   ") + 1;
        assert.equal(isLikelyCallArgumentGap(sourceText, gapStart + 2), false);
    });

    void it("rejects whitespace inside a function declaration", () => {
        const sourceText = "function foo(a   b) {}";
        const gapStart = sourceText.indexOf("a   ") + 1;
        assert.equal(isLikelyCallArgumentGap(sourceText, gapStart + 2), false);
    });

    void it("returns false when no enclosing parenthesis is found", () => {
        const sourceText = "a   b";
        const gapStart = sourceText.indexOf("   ") - 1;
        assert.equal(isLikelyCallArgumentGap(sourceText, gapStart), false);
    });

    void it("matches the behaviour exposed through the Core namespace", () => {
        const sourceText = "foo(a   b)";
        const gapStart = sourceText.indexOf("a   ") + 1;
        assert.equal(
            Core.isLikelyCallArgumentGap(sourceText, gapStart + 2),
            isLikelyCallArgumentGap(sourceText, gapStart + 2)
        );
    });
});

void describe("forEachWhitespaceRunWithAdjacentTokens", () => {
    void it("emits each whitespace run with the surrounding non-whitespace token offsets", () => {
        const runs: Array<{ start: number; end: number; prev: number; next: number }> = [];
        forEachWhitespaceRunWithAdjacentTokens("foo   bar\nbaz\tqux", (run) => {
            runs.push({
                start: run.whitespaceRunStart,
                end: run.whitespaceRunEnd,
                prev: run.previousIndex,
                next: run.nextIndex
            });
        });

        assert.equal(runs.length, 3);
        assert.deepEqual(runs[0], { start: 3, end: 5, prev: 2, next: 6 });
        assert.deepEqual(runs[1], { start: 9, end: 9, prev: 8, next: 10 });
        assert.deepEqual(runs[2], { start: 13, end: 13, prev: 12, next: 14 });
    });

    void it("skips runs that touch the beginning or end of the source", () => {
        const runs: Array<unknown> = [];
        forEachWhitespaceRunWithAdjacentTokens("   abc", (run) => {
            runs.push(run);
        });
        assert.equal(runs.length, 0);

        forEachWhitespaceRunWithAdjacentTokens("abc   ", (run) => {
            runs.push(run);
        });
        assert.equal(runs.length, 0);
    });

    void it("matches the behaviour exposed through the Core namespace", () => {
        const collected: Array<{ start: number; end: number }> = [];
        Core.forEachWhitespaceRunWithAdjacentTokens("a  b\n\tc", (run) => {
            collected.push({ start: run.whitespaceRunStart, end: run.whitespaceRunEnd });
        });
        assert.equal(collected.length, 2);
        assert.deepEqual(collected[0], { start: 1, end: 2 });
        assert.deepEqual(collected[1], { start: 4, end: 5 });
    });
});
