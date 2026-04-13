import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("does not insert a blank line between variable blocks and following loops inside function bodies", async () => {
    const source = [
        "function demo() {",
        "    var alpha = 1;",
        "    var beta = 2;",
        "    var gamma = 3;",
        "    var delta = 4;",
        "    for (var index = 0; index < 10; index += 1) {",
        "        alpha += index;",
        "    }",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");
    const forIndex = lines.findIndex((line) => line.includes("for (var index = 0"));

    assert.notEqual(
        lines[forIndex - 1],
        "",
        "Variable-block-before-loop padding only applies at the top level, not inside function bodies"
    );
});

void test("inserts a blank line between large variable blocks and following loops at the top level", async () => {
    const source = [
        "var alpha = 1;",
        "var beta = 2;",
        "var gamma = 3;",
        "var delta = 4;",
        "for (var index = 0; index < 10; index += 1) {",
        "    alpha += index;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");
    const forIndex = lines.findIndex((line) => line.includes("for (var index = 0"));

    assert.equal(
        lines[forIndex - 1],
        "",
        "Expected a blank line to separate top-level variable declarations from the loop body"
    );
});

void test("formats struct static functions without infinite recursion", async () => {
    const source = [
        "function child_struct(_foo, _value) constructor {",
        "    static remove_ellipse = function () {",
        "        for (var i = 0; i < array_length(nodes); i += 1) {",
        "            if (!collision_ellipse(0, 0, width, height, nodes[i], false, true)) {",
        "                instance_destroy(nodes[i]);",
        "            }",
        "        }",
        "    };",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(typeof formatted, "string");
});
