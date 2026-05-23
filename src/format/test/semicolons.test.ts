import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import * as Semicolons from "../src/printer/semicolons.js";

void describe("semicolon helpers", () => {
    void it("flags statement nodes that require a terminator", () => {
        assert.strictEqual(Semicolons.optionalSemicolon("ExpressionStatement"), ";");
        assert.strictEqual(Semicolons.optionalSemicolon("IfStatement"), "");
    });

    void it("does not treat prototype keys as semicolon node types", () => {
        assert.strictEqual(Semicolons.optionalSemicolon("__proto__"), "");
        assert.strictEqual(Semicolons.optionalSemicolon("toString"), "");
    });

    void it("counts trailing blank lines after a given index", () => {
        const text = "foo();\n\n\nbar();";
        const newlineIndex = text.indexOf("\n");
        assert.strictEqual(Semicolons.countTrailingBlankLines(text, newlineIndex), 2);
        assert.strictEqual(Semicolons.countTrailingBlankLines(null, 0), 0);
    });

    void it("finds the next non-whitespace character", () => {
        const text = "  \n  }";
        assert.strictEqual(Semicolons.getNextNonWhitespaceCharacter(text, 0), "}");
        assert.strictEqual(Semicolons.getNextNonWhitespaceCharacter(null, 0), null);
    });

    void it("recognizes whitespace characters the semicolon scanner skips", () => {
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(9), true);
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x20_28), true);
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x41), false);
    });

    void it("covers the ASCII fast path for skippable whitespace", () => {
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x09), true, "HT (tab)");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x0a), true, "LF");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x0b), true, "VT");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x0c), true, "FF");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x0d), true, "CR");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x20), true, "SP (space)");

        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x08), false, "BS (not whitespace)");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x21), false, "! (not whitespace)");
        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x7f), false, "DEL (not whitespace)");

        assert.strictEqual(Semicolons.isSkippableSemicolonWhitespace(0x7f), false, "boundary 0x7f");
    });

    void it("determines whether the path references the last statement", () => {
        const body = ["first", "second", "third"];
        const parent = { body };

        const pathForLast = {
            getParentNode: () => parent,
            getValue: () => body.at(-1)
        } as unknown as AstPath<unknown>;

        assert.strictEqual(Semicolons.isLastStatement(pathForLast), true);

        const pathForFirst = {
            getParentNode: () => parent,
            getValue: () => body[0]
        } as unknown as AstPath<unknown>;

        assert.strictEqual(Semicolons.isLastStatement(pathForFirst), false);

        const orphanPath = {
            getParentNode: () => null,
            getValue: () => ({})
        } as unknown as AstPath<unknown>;

        assert.strictEqual(Semicolons.isLastStatement(orphanPath), true);
    });

    void it("handles Unicode whitespace beyond ASCII", () => {
        const textWithEmSpace = "\u2003\u2003}";
        assert.strictEqual(
            Semicolons.getNextNonWhitespaceCharacter(textWithEmSpace, 0),
            "}",
            "Should skip Unicode em-space (U+2003) whitespace"
        );

        const textWithThinSpace = "\u2009\u2009bar";
        assert.strictEqual(
            Semicolons.getNextNonWhitespaceCharacter(textWithThinSpace, 0),
            "b",
            "Should skip Unicode thin-space (U+2009) whitespace"
        );

        const textWithOghamSpace = "\u1680{";
        assert.strictEqual(
            Semicolons.getNextNonWhitespaceCharacter(textWithOghamSpace, 0),
            "{",
            "Should skip Unicode Ogham space (U+1680) whitespace"
        );
    });

    void it("handles Unicode whitespace in blank line counting", () => {
        const textWithUnicodeSpaces = "foo();\n\u2003\n\u2003\nbar();";
        const newlineIndex = textWithUnicodeSpaces.indexOf("\n");

        assert.strictEqual(
            Semicolons.countTrailingBlankLines(textWithUnicodeSpaces, newlineIndex),
            2,
            "Should count blank lines correctly with Unicode whitespace"
        );
    });
});
