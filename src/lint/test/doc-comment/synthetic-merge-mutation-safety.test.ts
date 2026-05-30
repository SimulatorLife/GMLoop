import assert from "node:assert/strict";
import test from "node:test";

import { mergeSyntheticDocComments } from "../../src/doc-comment/synthetic-merge.js";

const makeNode = () => ({
    type: "FunctionDeclaration",
    id: { type: "Identifier", name: "testFunc" },
    params: [],
    body: { type: "BlockStatement", body: [] },
    start: { index: 10 },
    end: { index: 20 }
});

/** Returns a doc-tag helpers instance so callers can use the same helpers used internally. */
const makeHelpers = () => ({
    isFunctionLine: (line: unknown): boolean => typeof line === "string" && /^\/\/\/\s*@function\b/i.test(line.trim()),
    isParamLine: (_line: unknown): boolean => false,
    docTagMatches: (_line: unknown, _pattern: RegExp): boolean => false,
    getParamCanonicalName: (_line: unknown): string | null => null
});

void test("mergeSyntheticDocComments does not mutate the caller's existingDocLines array", () => {
    // Lines that include @deprecated and @function trigger the reposition path.
    const existingDocLines = ["/// @deprecated", "/// @function myFunc", "/// @param {number} x"];
    const originalLength = existingDocLines.length;
    // Pin a specific element so we detect in-place splices on the original.
    const pinnedElement = existingDocLines[1];

    const node = makeNode();
    mergeSyntheticDocComments(node, existingDocLines, {}, makeHelpers());

    // The original array must not be mutated.
    assert.strictEqual(existingDocLines.length, originalLength, "original array length must not change");
    assert.strictEqual(existingDocLines[1], pinnedElement, "original array contents must not change");
});

void test("mergeSyntheticDocComments discards trailing empty lines when repositioning function lines", () => {
    const existingDocLines = ["/// @deprecated", "", "", "/// @function oldFunc"];

    const node = makeNode();
    const result = mergeSyntheticDocComments(node, existingDocLines, {}, makeHelpers());

    // The empty lines between @deprecated and @function should be consumed.
    const funcIndex = result.findIndex((line) => line.includes("@function"));
    const deprecIndex = result.findIndex((line) => line.includes("@deprecated"));
    assert.ok(
        funcIndex === deprecIndex + 1,
        `function line should immediately follow @deprecated, got funcIndex=${funcIndex} deprecIndex=${deprecIndex}`
    );
});

void test("mergeSyntheticDocComments appends multiple function lines after @deprecated", () => {
    const existingDocLines = [
        "/// @deprecated",
        "/// @function firstFunc",
        "/// @function secondFunc",
        "/// Some description"
    ];

    const node = makeNode();
    const result = mergeSyntheticDocComments(node, existingDocLines, {}, makeHelpers());

    const funcLines = result.filter((line) => line.includes("@function"));
    assert.strictEqual(funcLines.length, 2, "both function lines should appear in result");
    assert.ok(result.indexOf("/// @function firstFunc") > result.indexOf("/// @deprecated"));
    assert.ok(result.indexOf("/// @function secondFunc") > result.indexOf("/// @deprecated"));
});

void test("mergeSyntheticDocComments returns original reference when no function lines exist", () => {
    const existingDocLines = ["/// @deprecated", "/// @param {number} x"];

    const node = makeNode();
    const result = mergeSyntheticDocComments(node, existingDocLines, {}, makeHelpers());

    // When no function line exists, the reposition helper returns the original.
    // The result of mergeSyntheticDocComments may be a new array, but it should
    // not be a mutated version of the input.
    assert.notStrictEqual(result, existingDocLines, "result should be a new array");
    assert.strictEqual(existingDocLines.length, 2, "original array must be untouched");
});

void test("mergeSyntheticDocComments does not inject entries into the original array", () => {
    // With no @deprecated tag, the reposition helper returns the original array
    // reference directly. The result should be the same reference, not a mutated copy.
    // (Synthetic entries may be added by the merge, but they go into the result,
    // not into the original `existingDocLines`.)
    const existingDocLines = ["/// @function myFunc", "/// Some description line"];

    const node = makeNode();
    mergeSyntheticDocComments(node, existingDocLines, {}, makeHelpers());

    // The original array must not be mutated (no new elements added).
    assert.strictEqual(existingDocLines.length, 2, "original array must not be modified");
});
