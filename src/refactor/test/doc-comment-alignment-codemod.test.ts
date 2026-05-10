import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "@gmloop/refactor";

const { applyDocCommentAlignmentCodemod } = Refactor;

void test("applyDocCommentAlignmentCodemod aligns doc @param names and order", () => {
    const source = [
        "/// @param fontName The target font, as a string",
        "/// @param character Character to test for, as a string",
        "function scribble_font_has_character(_font_name, _character) {",
        "    return ord(_character);",
        "}"
    ].join("\n");

    const result = applyDocCommentAlignmentCodemod(source);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param _font_name The target font, as a string",
            "/// @param _character Character to test for, as a string",
            "function scribble_font_has_character(_font_name, _character) {",
            "    return ord(_character);",
            "}"
        ].join("\n")
    );
});

void test("applyDocCommentAlignmentCodemod marks defaulted params as optional", () => {
    const source = [
        "/// @param x X coordinate",
        "/// @param y Y coordinate",
        "function foo(x = 0, y = 1) {",
        "    return x + y;",
        "}"
    ].join("\n");

    const result = applyDocCommentAlignmentCodemod(source);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param [x=0] X coordinate",
            "/// @param [y=1] Y coordinate",
            "function foo(x = 0, y = 1) {",
            "    return x + y;",
            "}"
        ].join("\n")
    );
});
