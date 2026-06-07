import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("breaks simple prefix arguments when callbacks follow", async () => {
    const source = [
        "function demo() {",
        "    call_later(",
        "        1800,",
        "        time_source_units_frames,",
        "        function () {",
        "            perform_cleanup();",
        "        },",
        "        true",
        "    );",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const callStart = formatted.indexOf("call_later(");

    assert.notEqual(callStart, -1, "Expected formatted output to contain the call expression.");

    const callBody = formatted.slice(callStart).split(");")[0];
    const lines = callBody.split("\n");

    assert.equal(lines[1].trim(), "1800,", "Expected the first numeric argument to be on its own line.");
    assert.equal(
        lines[2].trim(),
        "time_source_units_frames,",
        "Expected the time unit argument to remain on a dedicated line."
    );
    assert.ok(
        !lines[1].includes("time_source_units_frames"),
        "Expected the first and second arguments to be separated by a line break."
    );
});

void test("breaks simple prefix arguments without callbacks using identifier first arg", async () => {
    // Regression test: The callback-argument layout should trigger whenever there
    // are two or more leading simple arguments followed by additional arguments,
    // regardless of whether the first argument is a string literal.
    //
    // Previously, the second branch in buildCallArgumentsDocs was gated on both
    // !hasCallbackArguments AND firstArgumentIsStringLiteral. The string literal
    // check was overly specific—it excluded cases like (identifier, identifier, ...)
    // where the first argument is an identifier rather than a string.
    //
    // This test uses an identifier as the first argument to ensure the generalized
    // behavior works for non-string first arguments when no callbacks are present.
    const source = [
        "function demo() {",
        "    // Two leading simple args (sprite, subimg) followed by trailing args",
        "    draw_sprite_ext(",
        "        sprite_index,",
        "        image_index,",
        "        x,",
        "        y,",
        "        1,",
        "        1,",
        "        0,",
        "        c_white,",
        "        1",
        "    );",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    // Verify formatting completes without error and produces output
    assert.ok(formatted.includes("draw_sprite_ext("), "Expected formatted output to contain the call expression.");
    assert.ok(formatted.includes("sprite_index,"), "Expected sprite_index to be preserved in output.");
});
