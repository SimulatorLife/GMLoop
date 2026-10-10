import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("keeps a wrapped ternary operator attached to the preceding GML expression", async () => {
    const source = [
        "function make_colour() {",
        "    abgr = is_norm ? scr_make_colour_abgr(a * 255, b * 255, g * 255, r * 255) : scr_make_colour_abgr(a * 255, b, g, r);",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source, { printWidth: 70 });

    assert.match(formatted, /abgr = is_norm \?\n/u);
    assert.match(formatted, /\) :\n/u);
    assert.doesNotMatch(formatted, /^\s*[?:]/mu);
    assert.equal(await Format.format(formatted, { printWidth: 70 }), formatted);
});

void test("keeps a bare macro operand on the same line as its binary operator", async () => {
    const source = [
        "var spr_scale = round(min(h_vw / sprite_get_width(spr_title_cf), vh * 0.75 / sprite_get_height(spr_title_cf)) * 16) * ONE_OVER_SIXTEEN;",
        ""
    ].join("\n");

    const formatted = await Format.format(source, { printWidth: 70 });

    assert.match(formatted, /\* ONE_OVER_SIXTEEN;/u);
    assert.doesNotMatch(formatted, /\*\n[ \t]*ONE_OVER_SIXTEEN/u);
    assert.equal(await Format.format(formatted, { printWidth: 70 }), formatted);
});

void test("keeps lowercase identifier operands attached to multiplicative operators", async () => {
    const formatted = await Format.format("var result = left_operand * right_operand;", { printWidth: 20 });

    assert.match(formatted, /\* right_operand;/u);
    assert.doesNotMatch(formatted, /\*\n[ \t]*right_operand;/u);
});

void test("wraps long arithmetic and string-concatenation expressions after their operators", async () => {
    const source = [
        "var spr_scale = round(min(h_vw / sprite_get_width(spr_title_cf), vh * 0.75 / sprite_get_height(spr_title_cf)) * 16) * ONE_OVER_SIXTEEN;",
        "function show_bitmap_error(fname, bits_per_pixel) {",
        String.raw`    show_message("File must be true color (24 or 32 bpp)\nFailed to load file: " + string(fname) + "\nThis file has " + string(bits_per_pixel) + " bpp");`,
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source, { printWidth: 70 });
    const continuationLines = formatted.split("\n").filter((line) => /^\s*[+*]\s/u.test(line));

    assert.deepEqual(continuationLines, []);
    assert.match(formatted, /\+\n[ \t]+string\(fname\)/u);
    assert.equal(await Format.format(formatted, { printWidth: 70 }), formatted);
});
