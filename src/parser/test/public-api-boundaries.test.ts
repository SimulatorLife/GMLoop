import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { Parser } from "../src/index.js";

void test("parser public API keeps internal doc-comment attachment normalization private", () => {
    assert.equal(
        "normalizeFunctionDocCommentAttachments" in Parser,
        false,
        "Parser should expose parsing/runtime contracts, not internal attachment normalizers."
    );
});

void test("parser implementation delegates doc-comment attachment normalization to Core", async () => {
    const parserSource = await readFile(new URL("../../src/gml-parser.ts", import.meta.url), "utf8");

    assert.match(
        parserSource,
        /Core\.normalizeFunctionDocCommentAttachments/u,
        "Parser should consume Core.normalizeFunctionDocCommentAttachments so the shared normalization primitive stays outside parser-owned internals."
    );
    assert.doesNotMatch(
        parserSource,
        /from "\.\/ast\/normalize-function-doc-comment-attachments\.js"/u,
        "Parser should not import a parser-local doc-comment attachment normalizer."
    );
});
