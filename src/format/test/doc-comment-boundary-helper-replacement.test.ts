/**
 * Regression guard: the printer used to expose two private helpers,
 * `resolveDocCommentStartIndex` and `resolveDocCommentEndIndex`, that
 * discriminated the `number | { index }` boundary shapes produced by the
 * parser. They were mirror copies of `Core.getCommentBoundaryIndex` and
 * have been retired in favour of that canonical helper.
 *
 * Why this guard exists
 * ---------------------
 * - Both helpers handled the same parser boundary variants
 *   (`start` / `end` as either a numeric offset or an object containing
 *   `{ index }`). `Core.getCommentBoundaryIndex` does exactly the same
 *   shape normalisation and is already used elsewhere in the format
 *   workspace (`comments/description-doc.ts`) and the lint workspace
 *   (`rules/gml/transforms/comment-tracker.ts`,
 *   `doc-comment/collection.ts`).
 * - Re-introducing bespoke boundary-resolution helpers in the printer
 *   would invite drift between the formatter and the canonical helper
 *   (e.g., divergent `Number.isFinite` handling, missing `null`-safe
 *   guards). The test below both pins the canonical helper as the
 *   single source of truth and exercises the full doc-comment path so
 *   any regression in boundary extraction is caught by the normal
 *   formatter end-to-end behaviour.
 *
 * (target-state.md §2.2, §3.2 — printers consume Core primitives
 * directly; no parallel helpers for the same domain concept.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import { Format } from "../src/index.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOC_COMMENT_OUTPUT_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/printer/doc-comment-output.ts");

void test("doc-comment-output no longer defines resolveDocCommentStartIndex/EndIndex", async () => {
    const source = await readFile(DOC_COMMENT_OUTPUT_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /function\s+resolveDocCommentStartIndex/u,
        "doc-comment-output.ts must not re-introduce the bespoke start-boundary helper; use Core.getCommentBoundaryIndex instead"
    );
    assert.doesNotMatch(
        source,
        /function\s+resolveDocCommentEndIndex/u,
        "doc-comment-output.ts must not re-introduce the bespoke end-boundary helper; use Core.getCommentBoundaryIndex instead"
    );
});

void test("Core.getCommentBoundaryIndex normalises both boundary shapes", () => {
    // Raw numeric boundary.
    assert.strictEqual(
        Core.getCommentBoundaryIndex({ start: 12, end: 24 }, "start"),
        12,
        "numeric start boundary must be returned as-is"
    );
    assert.strictEqual(
        Core.getCommentBoundaryIndex({ start: 12, end: 24 }, "end"),
        24,
        "numeric end boundary must be returned as-is"
    );

    // Object-form boundary with `{ index }`.
    assert.strictEqual(
        Core.getCommentBoundaryIndex({ start: { index: 7 }, end: { index: 19 } }, "start"),
        7,
        "object-form start boundary must unwrap the index field"
    );
    assert.strictEqual(
        Core.getCommentBoundaryIndex({ start: { index: 7 }, end: { index: 19 } }, "end"),
        19,
        "object-form end boundary must unwrap the index field"
    );

    // Missing boundary.
    assert.strictEqual(
        Core.getCommentBoundaryIndex({ start: null, end: undefined }, "start"),
        null,
        "non-finite / missing start boundary must normalise to null"
    );
    assert.strictEqual(
        Core.getCommentBoundaryIndex({ type: "CommentLine" }, "end"),
        null,
        "absent end boundary must normalise to null"
    );

    // Non-object inputs.
    assert.strictEqual(Core.getCommentBoundaryIndex(null, "start"), null, "null entry must normalise to null");
    assert.strictEqual(
        Core.getCommentBoundaryIndex("not a comment", "start"),
        null,
        "string entry must normalise to null"
    );
});

void test("doc-comment round-trip preserves ordering and source spacing", async () => {
    // The printer uses the same boundary helper to (a) sort doc-comment
    // entries by source position, (b) compute spacing between
    // consecutive doc-comment blocks, and (c) extract the slice of
    // original source text for embedded leading comments. This end-to-end
    // test exercises all three paths with multi-line `///` doc
    // comments so any boundary-resolution regression surfaces here.
    const source = [
        "/// @function first(value)",
        "/// @description The first function",
        "function first(value) {",
        "    return value;",
        "}",
        "",
        "/// @function second(value)",
        "///",
        "/// @description The second function",
        "/// @param {real} value",
        "function second(value) {",
        "    return value * 2;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.match(formatted, /\/\/\/ @function first\(value\)/u, "first function doc-comment must be preserved");
    assert.match(formatted, /\/\/\/ @function second\(value\)/u, "second function doc-comment must be preserved");
    assert.match(formatted, /\/\/\/ @description The first function/u, "first description line must round-trip");
    assert.match(formatted, /\/\/\/ @description The second function/u, "second description line must round-trip");
    assert.match(formatted, /\/\/\/ @param \{real\} value/u, "second param line must round-trip");

    const firstIndex = formatted.indexOf("/// @function first");
    const secondIndex = formatted.indexOf("/// @function second");
    assert.ok(
        firstIndex !== -1 && secondIndex !== -1 && firstIndex < secondIndex,
        "doc comments must remain in source order"
    );
});
