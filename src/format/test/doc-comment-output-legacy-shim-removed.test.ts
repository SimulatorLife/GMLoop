/**
 * Regression guard: the `options.gml.buildPrintableDocCommentLines`
 * indirection was a backward-compatibility shim that read from
 * `options.gml` with a fallback to a directly-imported canonical
 * implementation. The shim was removed; this test prevents re-introducing
 * it and verifies the canonical path is wired correctly.
 *
 * Why this guard exists:
 *   - The `format-entry.ts` composition root used to inject
 *     `buildPrintableDocCommentLines` into `defaultOptions.gml`.
 *   - `printNodeDocComments` used to look it up from `options.gml` and
 *     fall back to a static import of the canonical implementation.
 *   - No caller bypassed `createGmlFormat`, so the fallback path served no
 *     real workload. The cleaner forward-looking design imports the
 *     canonical helper directly from the comments subsystem.
 *
 * (target-state.md §2.3, §3.2 — no backward-compatibility shims; printer
 * depends on the comments subsystem through direct import boundaries.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Format } from "../src/format-entry.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOC_COMMENT_OUTPUT_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/printer/doc-comment-output.ts");
const FORMAT_ENTRY_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/format-entry.ts");

void test("doc-comment-output no longer resolves buildPrintableDocCommentLines from options.gml", async () => {
    const source = await readFile(DOC_COMMENT_OUTPUT_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /resolveBuildPrintableDocCommentLines/u,
        "doc-comment-output.ts must not re-introduce the resolveBuildPrintableDocCommentLines shim"
    );
    assert.doesNotMatch(
        source,
        /options\?\.gml\?\.buildPrintableDocCommentLines/u,
        "doc-comment-output.ts must not read from options.gml.buildPrintableDocCommentLines"
    );
    assert.match(
        source,
        /import\s*\{\s*buildPrintableDocCommentLines\s*\}\s*from\s*["']\.\.\/comments\/description-doc\.js["']/u,
        "doc-comment-output.ts must import buildPrintableDocCommentLines directly from the canonical comments helper"
    );
});

void test("format-entry no longer injects buildPrintableDocCommentLines into defaultOptions.gml", async () => {
    const source = await readFile(FORMAT_ENTRY_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /buildPrintableDocCommentLines/u,
        "format-entry.ts must not reference buildPrintableDocCommentLines; the injection is retired alongside its read-side shim"
    );
});

void test("canonical doc-comment rendering works end-to-end without an injected helper", async () => {
    // Round-trip a function with a doc-comment through Format.format. The
    // printer must rely on the canonical implementation directly; the
    // previous shim would have allowed a caller to override the helper
    // by populating `options.gml.buildPrintableDocCommentLines`, and the
    // test below confirms no such override is required for the format
    // pipeline to produce the expected doc-comment text.
    const source = [
        "/// @function demo(value)",
        "/// @description Demonstrates a doc-comment",
        "/// @param {real} value",
        "function demo(value) {",
        "    return value;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.match(formatted, /\/\/\/ @function demo\(value\)/u);
    assert.match(formatted, /\/\/\/ @description Demonstrates a doc-comment/u);
    assert.match(formatted, /\/\/\/ @param \{real\} value/u);
    assert.match(formatted, /function demo\(value\)/u);
});
