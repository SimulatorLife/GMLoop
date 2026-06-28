import assert from "node:assert/strict";
import test from "node:test";

import { applySourceTextEdits, findNextLineStart, isDirectiveLineAtIndex } from "../src/codemods/codemod-helpers.js";

void test("applySourceTextEdits applies unordered non-overlapping edits", () => {
    const output = applySourceTextEdits("alpha beta gamma", [
        { start: 11, end: 16, text: "delta" },
        { start: 0, end: 5, text: "omega" }
    ]);

    assert.equal(output, "omega beta delta");
});

void test("applySourceTextEdits rejects overlapping edits before corrupting output", () => {
    assert.throws(
        () =>
            applySourceTextEdits("abcdef", [
                { start: 1, end: 4, text: "X" },
                { start: 3, end: 5, text: "Y" }
            ]),
        /overlap/u
    );
});

void test("applySourceTextEdits rejects edits outside the source text", () => {
    assert.throws(() => applySourceTextEdits("abc", [{ start: 1, end: 4, text: "Z" }]), /exceeds source length/u);
});

void test("isDirectiveLineAtIndex recognizes #region, #macro, and #define lines", () => {
    const sourceText = "var x = 1;\n#region Shared\n#macro foo 1\n  #define bar 2\nval = x;";
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("#region")), true);
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("#macro")), true);
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("#define")), true);
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("val")), false);
});

void test("isDirectiveLineAtIndex ignores non-# first non-whitespace characters", () => {
    const sourceText = "// comment\nvar x = 1;\n  val = x;";
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("var")), false);
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("val")), false);
});

void test("isDirectiveLineAtIndex returns false for an offset on a non-directive line and true for one on a directive line", () => {
    const sourceText = "var x = 1;\n#region Shared\nfoo();";

    assert.equal(isDirectiveLineAtIndex(sourceText, 0), false);
    assert.equal(isDirectiveLineAtIndex(sourceText, sourceText.indexOf("foo")), false);

    const directiveIndex = sourceText.indexOf("#region");
    assert.equal(isDirectiveLineAtIndex(sourceText, directiveIndex), true);
    assert.equal(isDirectiveLineAtIndex(sourceText, directiveIndex + 4), true);
});

void test("findNextLineStart returns the offset immediately after the next newline", () => {
    assert.equal(findNextLineStart("foo\nbar\nbaz", 0), 4);
    assert.equal(findNextLineStart("foo\nbar\nbaz", 4), 8);
});

void test("findNextLineStart returns sourceText.length when the line has no terminator", () => {
    assert.equal(findNextLineStart("single line", 0), "single line".length);
});
