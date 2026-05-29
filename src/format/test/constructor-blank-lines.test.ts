import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("removes blank line between constructor header and first statement", async () => {
    const source = ["function Demo() constructor {", "", "    self.value = 1;", "}", ""].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");

    assert.notEqual(
        lines[1],
        "",
        "Expected constructors to omit a blank line when the input separates the header from the first statement."
    );
});

void test("removes blank line before constructor closing brace", async () => {
    const source = [
        "function Demo() constructor {",
        "    static helper = function () {",
        "        return 1;",
        "    };",
        "",
        "    static helper_alt = function () {",
        "        return 2;",
        "    };",
        "",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");

    assert.notEqual(
        lines.at(-2),
        "",
        "Expected constructors to remove blank lines between the final statement and closing brace."
    );
});

void test("removes trailing blank line after documented static constructor members", async () => {
    const source = [
        "function Demo() constructor {",
        "    /// @returns {real}",
        "    static helper = function () {",
        "        return 1;",
        "    };",
        "",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");

    assert.notEqual(
        lines.at(-2),
        "",
        "Expected documented static members to remove trailing blank line before the constructor closes."
    );
});

void test("removes blank lines around nested function declarations inside constructors", async () => {
    const source = [
        "function Demo() constructor {",
        "",
        "    function nested() {",
        "        return 1;",
        "    }",
        "",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");

    assert.notEqual(
        lines.at(-2),
        "",
        "Expected nested function declarations to remove trailing blank line before the constructor closes."
    );
});

void test("omits trailing blank line after nested constructor functions", async () => {
    const source = [
        "function Demo() constructor {",
        "    nested = function () {",
        "        return 1;",
        "    };",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");

    assert.notEqual(
        lines.at(-2),
        "",
        "Expected constructor blocks to omit a separating blank line when nested functions close immediately before the brace."
    );
    assert.equal(
        source,
        formatted,
        "Expected the formatter to not modify the input when no blank lines are present or needed."
    );
});

void test("omits a blank line after nested functions before closing the constructor", async () => {
    const source = [
        "function Outer() constructor {",
        "    function inner() {",
        "        return 1;",
        "    }",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.split("\n");
    const closingBraceIndex = lines.lastIndexOf("}");

    assert.ok(closingBraceIndex > 0, "Formatted constructor should include a closing brace.");

    assert.notStrictEqual(
        lines[closingBraceIndex - 1],
        "",
        "Formatter should not include a blank line between the nested function and the constructor closing brace."
    );
});

void test("preserves blank lines between simple constructor assignments", async () => {
    const source = [
        "Demo = function () constructor {",
        "    self.value = 1;",
        "",
        "    self.copied = self.value;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);
    const lines = formatted.trim().split("\n");
    const assignmentIndex = lines.indexOf("    self.value = 1;");

    assert.notStrictEqual(
        assignmentIndex,
        -1,
        "Expected the constructor body to contain the first assignment statement."
    );
    assert.equal(
        lines[assignmentIndex + 1],
        "",
        "Expected constructors to preserve author-inserted blank lines between simple assignments."
    );
});
