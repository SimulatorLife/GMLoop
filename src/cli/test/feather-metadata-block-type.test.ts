import assert from "node:assert/strict";
import test from "node:test";

import { isManualBlockType, normalizeContent } from "../src/commands/generate-feather-metadata.js";

void test("isManualBlockType accepts every known manual block type", () => {
    for (const type of ["note", "paragraph", "heading", "list", "table", "code", "html"]) {
        assert.equal(isManualBlockType(type), true, `expected "${type}" to be a recognized block type`);
    }
});

void test("isManualBlockType rejects unrecognized strings", () => {
    for (const type of ["Note", "para", "quote", ""]) {
        assert.equal(isManualBlockType(type), false, `expected "${type}" to be rejected`);
    }
});

void test("normalizeContent routes each known block type into its bucket", () => {
    const content = normalizeContent([
        { type: "paragraph", text: "intro paragraph" },
        { type: "note", text: "heads up" },
        { type: "heading", text: "Example" },
        { type: "code", text: "show_debug_message(1);" },
        { type: "list", text: "", items: ["one", "two"] },
        { type: "html", text: "raw html fallback" }
    ]);

    assert.deepEqual(content.paragraphs, ["intro paragraph", "raw html fallback"]);
    assert.deepEqual(content.notes, ["heads up"]);
    assert.deepEqual(content.headings, ["Example"]);
    assert.deepEqual(content.codeExamples, ["show_debug_message(1);"]);
    assert.deepEqual(content.lists, [["one", "two"]]);
});

void test("normalizeContent fails fast on an unrecognized block type instead of silently discarding it", () => {
    const invalidBlocks = [{ type: "quote", text: "silently dropped before this change" }];

    assert.throws(() => normalizeContent(invalidBlocks), /Unrecognized Feather manual block type: "quote"/);
});
