import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getOriginalTextFromOptions,
    hasBlankLineBeforeLeadingComment,
    hasBlankLineBetweenLastCommentAndClosingBrace,
    macroTextHasExplicitTrailingBlankLine,
    resolveNodeIndexRangeWithSource,
    resolvePrinterSourceMetadata,
    sliceOriginalText,
    stripTrailingLineTerminators
} from "../src/printer/source-text.js";

void describe("printer source text helpers", () => {
    void it("trims trailing line terminators without regex allocation", () => {
        assert.equal(stripTrailingLineTerminators("macro\n\r\n"), "macro");
        assert.equal(stripTrailingLineTerminators("macro"), "macro");
    });

    void it("normalizes printer metadata inputs", () => {
        assert.deepEqual(resolvePrinterSourceMetadata(null), {
            originalText: null,
            locStart: null,
            locEnd: null
        });

        const locStart = () => 1;
        const metadata = resolvePrinterSourceMetadata({
            originalText: "text",
            locStart,
            locEnd: () => 3
        });

        assert.equal(metadata.originalText, "text");
        assert.equal(metadata.locStart, locStart);
        assert.equal(metadata.locEnd?.({}), 3);
    });

    void it("extracts original text from printer options", () => {
        assert.equal(
            getOriginalTextFromOptions({
                originalText: "body"
            }),
            "body"
        );

        assert.equal(getOriginalTextFromOptions({ originalText: 42 }), null);
    });

    void it("computes node ranges with metadata overrides", () => {
        const range = resolveNodeIndexRangeWithSource(
            { start: 5, end: 8 },
            { originalText: null, locStart: () => 10, locEnd: () => 15 }
        );

        assert.deepEqual(range, { startIndex: 10, endIndex: 14 });
    });

    void it("slices text only when bounds are valid", () => {
        assert.equal(sliceOriginalText("abcdef", 1, 4), "bcd");
        assert.equal(sliceOriginalText("abcdef", 4, 1), null);
    });

    void it("detects explicit trailing blank lines in macro text", () => {
        assert.equal(macroTextHasExplicitTrailingBlankLine("macro\n\n"), true);
        assert.equal(macroTextHasExplicitTrailingBlankLine("macro\n"), false);
        assert.equal(macroTextHasExplicitTrailingBlankLine("macro\n\u2003\n\u2003"), true);
    });

    void it("reports absence of surrounding blank lines for compact blocks", () => {
        const blockNode = {
            start: 0,
            end: 10,
            comments: [{ type: "CommentLine", value: "first", start: 2, end: 8 }]
        };

        const originalText = "{\n//first\n}";
        const metadata = resolvePrinterSourceMetadata({
            originalText
        });

        assert.equal(hasBlankLineBeforeLeadingComment(blockNode, metadata, originalText, 8), false);

        assert.equal(hasBlankLineBetweenLastCommentAndClosingBrace(blockNode, metadata, originalText), false);
    });
});
