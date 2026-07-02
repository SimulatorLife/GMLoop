import assert from "node:assert/strict";
import { test } from "node:test";

import { Lsp } from "@gmloop/lsp";

void test("offset edits convert to LSP text edits", () => {
    const document = Lsp.createGmlDocumentStore().open({
        uri: Lsp.filePathToUri("/tmp/edit.gml"),
        languageId: "gml",
        version: 1,
        text: "var value = 1;\n"
    });

    const [edit] = Lsp.sourceOffsetEditsToTextEdits(document, [{ start: 12, end: 13, text: "2" }]);

    assert.deepEqual(edit, {
        range: {
            start: { line: 0, character: 12 },
            end: { line: 0, character: 13 }
        },
        newText: "2"
    });
});

void test("parser errors become LSP diagnostics", () => {
    const document = Lsp.createGmlDocumentStore().open({
        uri: Lsp.filePathToUri("/tmp/error.gml"),
        languageId: "gml",
        version: 1,
        text: "var ="
    });

    const diagnostic = Lsp.parserErrorToDiagnostic(document, {
        name: "GameMakerSyntaxError",
        message: "Syntax Error",
        line: 1,
        column: 4
    });

    assert.equal(diagnostic.source, "gmloop-parser");
    assert.deepEqual(diagnostic.range.start, { line: 0, character: 4 });
});
