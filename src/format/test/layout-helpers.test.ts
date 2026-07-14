import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    countTrailingBlankLines,
    getNextNonWhitespaceCharacter,
    isWhitespaceCharacterCode
} from "../src/shared/layout-helpers.js";

void describe("layout-helpers.isWhitespaceCharacterCode", () => {
    void it("treats the ASCII whitespace fast path as whitespace", () => {
        // HT, LF, VT, FF, CR, SP – the documented ASCII branch coverage.
        assert.strictEqual(isWhitespaceCharacterCode(0x09), true, "HT (tab)");
        assert.strictEqual(isWhitespaceCharacterCode(0x0a), true, "LF");
        assert.strictEqual(isWhitespaceCharacterCode(0x0b), true, "VT");
        assert.strictEqual(isWhitespaceCharacterCode(0x0c), true, "FF");
        assert.strictEqual(isWhitespaceCharacterCode(0x0d), true, "CR");
        assert.strictEqual(isWhitespaceCharacterCode(0x20), true, "SP (space)");
    });

    void it("rejects ASCII control codes that are not whitespace", () => {
        // BS sits one code point below HT and must not be classified as
        // whitespace, otherwise the fast path would over-skip characters.
        assert.strictEqual(isWhitespaceCharacterCode(0x08), false, "BS (not whitespace)");

        // 0x21 is the first non-whitespace ASCII printable character.
        assert.strictEqual(isWhitespaceCharacterCode(0x21), false, "! (not whitespace)");

        // 0x7f is the last ASCII code point; it is DEL, not whitespace.
        assert.strictEqual(isWhitespaceCharacterCode(0x7f), false, "DEL (not whitespace)");
    });

    void it("recognises Unicode whitespace beyond the ASCII fast path", () => {
        // U+00A0 NO-BREAK SPACE, U+2003 EM SPACE, U+2009 THIN SPACE,
        // U+1680 OGHAM SPACE MARK, U+2028 LINE SEPARATOR.
        assert.strictEqual(isWhitespaceCharacterCode(0x00_a0), true, "NBSP");
        assert.strictEqual(isWhitespaceCharacterCode(0x20_03), true, "EM SPACE");
        assert.strictEqual(isWhitespaceCharacterCode(0x20_09), true, "THIN SPACE");
        assert.strictEqual(isWhitespaceCharacterCode(0x16_80), true, "OGHAM SPACE MARK");
        assert.strictEqual(isWhitespaceCharacterCode(0x20_28), true, "LINE SEPARATOR");
    });

    void it("rejects Unicode non-whitespace code points", () => {
        // U+00A1 is the first non-whitespace Latin-1 code point.
        assert.strictEqual(isWhitespaceCharacterCode(0x00_a1), false, "¡");
        // U+4E2D is a CJK ideograph; should never be treated as whitespace.
        assert.strictEqual(isWhitespaceCharacterCode(0x4e_2d), false, "CJK ideograph");
    });
});

void describe("layout-helpers.countTrailingBlankLines", () => {
    void it("counts blank lines after the provided index, ignoring semicolons and whitespace", () => {
        const text = "foo();\n\n\nbar();";
        const newlineIndex = text.indexOf("\n");
        assert.strictEqual(countTrailingBlankLines(text, newlineIndex), 2);
    });

    void it("returns zero for non-string input", () => {
        assert.strictEqual(countTrailingBlankLines(null, 0), 0);
        assert.strictEqual(countTrailingBlankLines(undefined, 0), 0);
    });

    void it("counts blank lines correctly when Unicode whitespace separates the line breaks", () => {
        const text = "foo();\n\u2003\n\u2003\nbar();";
        const newlineIndex = text.indexOf("\n");
        assert.strictEqual(countTrailingBlankLines(text, newlineIndex), 2);
    });
});

void describe("layout-helpers.getNextNonWhitespaceCharacter", () => {
    void it("returns the next non-whitespace character", () => {
        const text = "  \n  }";
        assert.strictEqual(getNextNonWhitespaceCharacter(text, 0), "}");
    });

    void it("returns null for non-string input or end-of-text", () => {
        assert.strictEqual(getNextNonWhitespaceCharacter(null, 0), null);
        assert.strictEqual(getNextNonWhitespaceCharacter("", 0), null);
    });

    void it("skips Unicode whitespace", () => {
        assert.strictEqual(getNextNonWhitespaceCharacter("\u2003\u2003}", 0), "}", "EM SPACE");
        assert.strictEqual(getNextNonWhitespaceCharacter("\u2009\u2009bar", 0), "b", "THIN SPACE");
        assert.strictEqual(getNextNonWhitespaceCharacter("\u1680{", 0), "{", "OGHAM SPACE MARK");
    });
});
