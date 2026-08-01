import assert from "node:assert/strict";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";

void test("source document positions use UTF-16 columns", () => {
    const sourceText = ["alpha", 'emoji = "😀";', "omega"].join("\n");
    const document = Lsp.createGmlDocumentStore().open({
        uri: Lsp.filePathToUri("/tmp/example.gml"),
        languageId: "gml",
        version: 1,
        text: sourceText
    });

    const emojiOffset = sourceText.indexOf("😀");
    const position = Lsp.offsetToPosition(document, emojiOffset + 2);

    assert.deepEqual(position, { line: 1, character: 11 });
    assert.equal(Lsp.positionToOffset(document, position), emojiOffset + 2);
});

void test("LSP identifier lookup uses lexer-owned Unicode ranges", () => {
    const sourceText = "var café = 1;\n😀 café;\n";
    const document = Lsp.createGmlDocumentStore().open({
        uri: Lsp.filePathToUri("/tmp/unicode-identifiers.gml"),
        languageId: "gml",
        version: 1,
        text: sourceText
    });
    const useOffset = sourceText.lastIndexOf("café") + 3;

    assert.deepEqual(Lsp.readGmlIdentifierAtPosition(document, useOffset), {
        name: "café",
        range: {
            start: { line: 1, character: 3 },
            end: { line: 1, character: 7 }
        }
    });
    assert.equal(Lsp.readGmlIdentifierAtPosition(document, sourceText.indexOf("😀") + 1), null);
});

void test("source document store applies incremental multiline changes", () => {
    const store = Lsp.createGmlDocumentStore();
    const document = store.open({
        uri: Lsp.filePathToUri("/tmp/update.gml"),
        languageId: "gml",
        version: 1,
        text: "var value = 1;\nshow_debug_message(value);\n"
    });

    const updated = store.update(document.uri, 2, [
        {
            range: {
                start: { line: 0, character: 12 },
                end: { line: 1, character: 18 }
            },
            text: "2;\ntrace"
        }
    ]);

    assert.ok(updated);
    assert.equal(updated.sourceText, "var value = 2;\ntrace(value);\n");
});

void test("positionToOffset clamps line and character to source bounds", () => {
    const store = Lsp.createGmlDocumentStore();
    const document = store.open({
        uri: Lsp.filePathToUri("/tmp/clamp.gml"),
        languageId: "gml",
        version: 1,
        text: "ab\ncd\n"
    });

    const lineStart0 = 0;
    const lineStart1 = 3;
    const lineEnd1 = 6;

    assert.equal(
        Lsp.positionToOffset(document, { line: -100, character: -100 }),
        lineStart0,
        "negative line clamps to first line and negative character clamps to its start"
    );
    assert.equal(
        Lsp.positionToOffset(document, { line: 999, character: 999 }),
        lineEnd1,
        "out-of-range line clamps to last line and oversize character clamps to its end"
    );
    assert.equal(
        Lsp.positionToOffset(document, { line: 1.9, character: 1 }),
        lineStart1 + 1,
        "fractional line is truncated to the integer row before clamping"
    );
    assert.equal(
        Lsp.positionToOffset(document, { line: 0, character: 1.7 }),
        lineStart0 + 1.7,
        "characters within range pass through unclamped while the line is still clamped to a real row"
    );
});

void test("offsetToPosition clamps the offset into the source range", () => {
    const store = Lsp.createGmlDocumentStore();
    const document = store.open({
        uri: Lsp.filePathToUri("/tmp/clamp-offset.gml"),
        languageId: "gml",
        version: 1,
        text: "ab\ncd"
    });

    const sourceLength = document.sourceText.length;
    const tailLineStart = document.lineStarts[1] ?? 0;

    assert.deepEqual(Lsp.offsetToPosition(document, -10), { line: 0, character: 0 });
    assert.deepEqual(Lsp.offsetToPosition(document, sourceLength + 50), {
        line: 1,
        character: sourceLength - tailLineStart
    });
    assert.deepEqual(Lsp.offsetToPosition(document, 1.9), { line: 0, character: 1 });
});
