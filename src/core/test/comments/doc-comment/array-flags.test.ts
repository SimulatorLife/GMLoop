import assert from "node:assert/strict";
import { test } from "node:test";

import { copyDocCommentArrayFlags } from "../../../src/comments/doc-comment/node-metadata.js";

void test("copyDocCommentArrayFlags copies all three flags when present", () => {
    const source = ["line1", "line2"] as any;
    source._preserveDescriptionBreaks = true;
    source._suppressLeadingBlank = true;
    source._blockCommentDocs = true;

    const target = ["line3", "line4"] as any;
    copyDocCommentArrayFlags(source, target);

    assert.strictEqual(target._preserveDescriptionBreaks, true);
    assert.strictEqual(target._suppressLeadingBlank, true);
    assert.strictEqual(target._blockCommentDocs, true);
});

void test("copyDocCommentArrayFlags only copies flags that are true", () => {
    const source = ["line1"] as any;
    source._preserveDescriptionBreaks = true;
    // _suppressLeadingBlank is not set
    source._blockCommentDocs = false;

    const target = ["line2"] as any;
    copyDocCommentArrayFlags(source, target);

    assert.strictEqual(target._preserveDescriptionBreaks, true);
    assert.strictEqual(target._suppressLeadingBlank, undefined);
    assert.strictEqual(target._blockCommentDocs, undefined);
});

void test("copyDocCommentArrayFlags returns target for chaining", () => {
    const source = ["line1"] as any;
    const target = ["line2"] as any;

    const result = copyDocCommentArrayFlags(source, target);

    assert.strictEqual(result, target);
});

void test("copyDocCommentArrayFlags handles non-array inputs gracefully", () => {
    const target = ["line"] as any;

    assert.doesNotThrow(() => copyDocCommentArrayFlags(null, target));
    assert.doesNotThrow(() => copyDocCommentArrayFlags(["line"], null));
});
