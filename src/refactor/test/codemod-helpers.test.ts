import assert from "node:assert/strict";
import test from "node:test";

import { applySourceTextEdits } from "../src/codemods/codemod-helpers.js";

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
