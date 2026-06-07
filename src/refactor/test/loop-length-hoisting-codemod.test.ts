import assert from "node:assert/strict";
import test from "node:test";

import { applyLoopLengthHoistingCodemod } from "../src/codemods/loop-length-hoisting/index.js";

void test("loopLengthHoisting hoists array_length from safe for-loop conditions", () => {
    const sourceText = [
        "function demo(items) {",
        "    for (var i = 0; i < array_length(items); i++) {",
        "        total += i;",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(sourceText);

    assert.equal(result.changed, true);
    assert.match(result.outputText, / {4}var len = array_length\(items\);/);
    assert.match(result.outputText, /for \(var i = 0; i < len; i\+\+\)/);
    assert.equal(result.appliedEdits.length, 2);
});

void test("loopLengthHoisting avoids existing len identifiers", () => {
    const sourceText = [
        "function demo(items) {",
        "    var len = 0;",
        "    for (var i = 0; i < array_length(items); i++) {",
        "        total += i;",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(sourceText);

    assert.equal(result.changed, true);
    assert.match(result.outputText, / {4}var len_1 = array_length\(items\);/);
    assert.match(result.outputText, /for \(var i = 0; i < len_1; i\+\+\)/);
});

void test("loopLengthHoisting returns unchanged text without parsing when no array_length call exists", () => {
    const sourceText = [
        "function demo(items) {",
        "    for (var i = 0; i < items.length; i++) {",
        "        total += items[i];",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(sourceText);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, sourceText);
    assert.equal(result.appliedEdits.length, 0);
});
