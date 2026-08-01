import assert from "node:assert/strict";
import test from "node:test";

import type { MutableDocCommentLines } from "@gmloop/core";

import {
    convertLegacyReturnsDescriptionLinesToMetadata,
    dedupeReturnDocLines,
    reorderDescriptionLinesToTop
} from "../../src/doc-comment/index.js";

void test("convertLegacyReturnsDescriptionLinesToMetadata ignores non-return descriptions with hyphens", () => {
    const input = [
        "/// @desc Base class for all shapes. Shapes can be solid or not solid.",
        "///       Solid shapes will collide with other solid shapes, and",
        "///       non-solid shapes will not collide with anything."
    ];

    const output = convertLegacyReturnsDescriptionLinesToMetadata(input);

    assert.deepStrictEqual(output, input);
});

void test("convertLegacyReturnsDescriptionLinesToMetadata converts valid legacy returns", () => {
    const input = ["/// @function my_func", "/// Returns: real, the result"];

    const expected = ["/// @returns {real} The result"];

    const output = convertLegacyReturnsDescriptionLinesToMetadata(input);

    assert.deepStrictEqual(output, expected);
});

void test("convertLegacyReturnsDescriptionLinesToMetadata converts hyphen style returns", () => {
    const input = ["/// @function my_func", "/// real - the result"];

    const expected = ["/// @returns {real} The result"];

    const output = convertLegacyReturnsDescriptionLinesToMetadata(input);

    assert.deepStrictEqual(output, expected);
});

void test("convertLegacyReturnsDescriptionLinesToMetadata preserves doc-comment flags after conversion", () => {
    const input = ["/// @function my_func", "/// Returns: real, the result"] as MutableDocCommentLines;
    input._suppressLeadingBlank = true;
    input._preserveDescriptionBreaks = true;
    input._blockCommentDocs = true;

    const output = convertLegacyReturnsDescriptionLinesToMetadata(input);
    const outputWithFlags = output as MutableDocCommentLines;

    assert.deepStrictEqual(Array.from(output), ["/// @returns {real} The result"]);
    assert.equal(outputWithFlags._suppressLeadingBlank, true);
    assert.equal(outputWithFlags._preserveDescriptionBreaks, true);
    assert.equal(outputWithFlags._blockCommentDocs, true);
});

void test("dedupeReturnDocLines preserves doc-comment flags while removing duplicate @returns lines", () => {
    const input = ["/// @returns {real} Value", "/// @returns {real} Value"] as MutableDocCommentLines;
    input._suppressLeadingBlank = true;
    input._preserveDescriptionBreaks = true;
    input._blockCommentDocs = true;

    const deduped = dedupeReturnDocLines(input);
    const output = deduped.lines as MutableDocCommentLines;

    assert.deepStrictEqual(Array.from(output), ["/// @returns {real} Value"]);
    assert.equal(deduped.removed, true);
    assert.equal(output._suppressLeadingBlank, true);
    assert.equal(output._preserveDescriptionBreaks, true);
    assert.equal(output._blockCommentDocs, true);
});

void test("reorderDescriptionLinesToTop preserves doc-comment flags after description promotion", () => {
    const input = ["/// @param {real} value", "/// @description Main description"] as MutableDocCommentLines;
    input._suppressLeadingBlank = true;
    input._preserveDescriptionBreaks = true;
    input._blockCommentDocs = true;

    const output = reorderDescriptionLinesToTop(input) as MutableDocCommentLines;

    assert.deepStrictEqual(Array.from(output), ["/// @description Main description", "/// @param {real} value"]);
    assert.equal(output._suppressLeadingBlank, true);
    assert.equal(output._preserveDescriptionBreaks, true);
    assert.equal(output._blockCommentDocs, true);
});
