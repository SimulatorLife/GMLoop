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
