import assert from "node:assert/strict";
import test from "node:test";

import { tokenizeGmlIdentifierRanges } from "../src/gml-parser.js";

void test("tokenizeGmlIdentifierRanges uses lexer-owned identifier boundaries", () => {
    const sourceText = 'var café = value; // ignored_name\nshow_debug_message("ignored_string");';
    assert.deepEqual(tokenizeGmlIdentifierRanges(sourceText), [
        { start: 4, end: 8, name: "café" },
        { start: 11, end: 16, name: "value" },
        { start: 34, end: 52, name: "show_debug_message" }
    ]);
});

void test("tokenizeGmlIdentifierRanges tolerates incomplete GML", () => {
    assert.deepEqual(tokenizeGmlIdentifierRanges("function unfinished(value"), [
        { start: 9, end: 19, name: "unfinished" },
        { start: 20, end: 25, name: "value" }
    ]);
});
