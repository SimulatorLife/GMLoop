import assert from "node:assert/strict";
import test from "node:test";

import {
    getDirectElementChildren,
    parseManualDocument,
    replaceBreakElementsWithNewlines
} from "../src/modules/manual/html.js";

void test("parseManualDocument parses HTML into a document", () => {
    const document = parseManualDocument("<html><body><main id='root'></main></body></html>");

    assert.equal(document.querySelector("main")?.id, "root");
});

void test("getDirectElementChildren returns only direct matches", () => {
    const document = parseManualDocument(
        "<section><ul><li id='first'></li><li><span id='nested'></span></li></ul></section>"
    );
    const list = document.querySelector("ul");

    const directItems = getDirectElementChildren(list, "li");
    const nestedItems = getDirectElementChildren(list, "span");

    assert.equal(directItems.length, 2);
    assert.equal(nestedItems.length, 0);
});

void test("replaceBreakElementsWithNewlines preserves textual line breaks", () => {
    const document = parseManualDocument("<p>first<br>second</p>");
    const paragraph = document.querySelector("p");
    assert.ok(paragraph);

    replaceBreakElementsWithNewlines(paragraph);

    assert.equal(paragraph.querySelectorAll("br").length, 0);
    assert.equal(paragraph.textContent, "first\nsecond");
});
