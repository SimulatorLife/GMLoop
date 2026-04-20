import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyLoopLengthHoistingCodemod } = Refactor.LoopLengthHoisting;

void test("applyLoopLengthHoistingCodemod hoists array_length calls in for-loop tests", () => {
    const input = ["for (var i = 0; i < array_length(items); i++) {", "    total += i;", "}", ""].join("\n");
    const expected = [
        "var len = array_length(items);",
        "for (var i = 0; i < len; i++) {",
        "    total += i;",
        "}",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(input);
    assert.equal(result.changed, true);
    assert.equal(result.outputText, expected);
    assert.equal(result.appliedEdits.length > 0, true);
    assert.equal(result.diagnosticOffsets.length, 1);
});

void test("applyLoopLengthHoistingCodemod leaves loops unchanged when insertion point is unsafe", () => {
    const input = [
        "if (ready)",
        "    for (var i = 0; i < array_length(items); i++) {",
        "        sum += i;",
        "    }",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(input);
    assert.equal(result.changed, false);
    assert.equal(result.outputText, input);
    assert.equal(result.appliedEdits.length, 0);
});

void test("applyLoopLengthHoistingCodemod respects null suffix overrides", () => {
    const input = ["for (var i = 0; i < array_length(items); i++) {", "    total += i;", "}", ""].join("\n");

    const result = applyLoopLengthHoistingCodemod(input, {
        functionSuffixes: {
            array_length: null
        }
    });

    assert.equal(result.changed, false);
    assert.equal(result.outputText, input);
    assert.equal(result.appliedEdits.length, 0);
});

void test("applyLoopLengthHoistingCodemod only rewrites repeated calls matching the selected hoist accessor", () => {
    const input = [
        "for (var i = 0; i < array_length(items) && i < ds_list_size(queue); i++) {",
        "    total += i;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var len = array_length(items);",
        "for (var i = 0; i < len && i < ds_list_size(queue); i++) {",
        "    total += i;",
        "}",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(input, {
        functionSuffixes: {
            ds_list_size: "size"
        }
    });

    assert.equal(result.changed, true);
    assert.equal(result.outputText, expected);
    assert.equal(result.diagnosticOffsets.length, 1);
});

void test("applyLoopLengthHoistingCodemod detects accessor calls with whitespace before parentheses", () => {
    const input = ["for (var i = 0; i < array_length (items); i++) {", "    total += i;", "}", ""].join("\n");
    const expected = [
        "var len = array_length (items);",
        "for (var i = 0; i < len; i++) {",
        "    total += i;",
        "}",
        ""
    ].join("\n");

    const result = applyLoopLengthHoistingCodemod(input);

    assert.equal(result.changed, true);
    assert.equal(result.outputText, expected);
    assert.equal(result.diagnosticOffsets.length, 1);
});
