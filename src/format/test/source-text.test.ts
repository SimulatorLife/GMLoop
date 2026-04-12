import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as Printer from "../src/printer/index.js";

void describe("printer source text helpers", () => {
    void it("trims trailing line terminators without regex allocation", () => {
        assert.equal(Printer.SourceText.stripTrailingLineTerminators("macro\n\r\n"), "macro");
        assert.equal(Printer.SourceText.stripTrailingLineTerminators("macro"), "macro");
    });

    void it("normalizes printer metadata inputs", () => {
        assert.deepEqual(Printer.SourceText.resolvePrinterSourceMetadata(null), {
            originalText: null,
            locStart: null,
            locEnd: null
        });

        const locStart = () => 1;
        const metadata = Printer.SourceText.resolvePrinterSourceMetadata({
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
            Printer.SourceText.getOriginalTextFromOptions({
                originalText: "body"
            }),
            "body"
        );

        assert.equal(Printer.SourceText.getOriginalTextFromOptions({ originalText: 42 }), null);
    });

    void it("computes node ranges with metadata overrides", () => {
        const range = Printer.SourceText.resolveNodeIndexRangeWithSource(
            { start: 5, end: 8 },
            { originalText: null, locStart: () => 10, locEnd: () => 15 }
        );

        assert.deepEqual(range, { startIndex: 10, endIndex: 14 });
    });

    void it("slices text only when bounds are valid", () => {
        assert.equal(Printer.SourceText.sliceOriginalText("abcdef", 1, 4), "bcd");
        assert.equal(Printer.SourceText.sliceOriginalText("abcdef", 4, 1), null);
    });

    void it("detects explicit trailing blank lines in macro text", () => {
        assert.equal(Printer.SourceText.macroTextHasExplicitTrailingBlankLine("macro\n\n"), true);
        assert.equal(Printer.SourceText.macroTextHasExplicitTrailingBlankLine("macro\n"), false);
    });

    void it("reports absence of surrounding blank lines for compact blocks", () => {
        const blockNode = {
            start: 0,
            end: 10,
            comments: [{ type: "CommentLine", value: "first", start: 2, end: 8 }]
        };

        const originalText = "{\n//first\n}";
        const metadata = Printer.SourceText.resolvePrinterSourceMetadata({
            originalText
        });

        assert.equal(Printer.SourceText.hasBlankLineBeforeLeadingComment(blockNode, metadata, originalText, 8), false);

        assert.equal(
            Printer.SourceText.hasBlankLineBetweenLastCommentAndClosingBrace(blockNode, metadata, originalText),
            false
        );
    });
});
