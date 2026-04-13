import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("does not wrap ternary initializers in parentheses", async () => {
    const source = ['var myVal13 = (3 - 2) ? "cool" : "not cool";', ""].join("\n");

    const formatted = await Format.format(source, { parser: "gml-parse" });

    const expected = ['var myVal13 = (3 - 2) ? "cool" : "not cool";', ""].join("\n");

    assert.strictEqual(formatted, expected, "Expected ternary variable initializers not to be wrapped in parentheses.");
});

void test("preserves parentheses around nested ternary expressions in true branches", async () => {
    const source = [
        "function build_values(value1, value2, value3) {",
        "    value = !is_undefined(value1) ? (!is_undefined(value2) ? [value1, value2] : [value1]) : [value3];",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source, { parser: "gml-parse" });

    assert.match(
        formatted,
        /\?\s*\(\s*!is_undefined\(value2\)\s*\?/u,
        "Expected formatter output to keep required parentheses around nested true-branch ternary expressions."
    );
});
