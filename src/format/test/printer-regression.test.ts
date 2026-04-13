import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("prints statements and element lists for GML programs", async () => {
    const source = [
        "var counter = 1 + value;",
        "function demo() {",
        "    var total = add(counter, 2, 3);",
        "    return total;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        [
            "var counter = 1 + value;",
            "",
            "function demo() {",
            "    var total = add(counter, 2, 3);",
            "    return total;",
            "}",
            ""
        ].join("\n")
    );
});

void test("prints all call arguments in order", async () => {
    const source = ["function demo() {", '    return calculate("alpha", 2, true, other());', "}", ""].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        ["function demo() {", '    return calculate("alpha", 2, true, other());', "}", ""].join("\n")
    );
});

void test("preserves unary plus before identifiers (semantic rewrite belongs in lint)", async () => {
    // Removing `+x` silently changes program semantics when `x` is not numeric
    // (e.g. string coercion via `+` differs from the raw identifier access).
    // This is an explicit content rewrite that belongs in the lint workspace
    // as `gml/no-unary-plus-on-identifier`. (target-state.md §2.1, §3.2)
    const formatted = await Format.format("var value = +count;\n");

    assert.strictEqual(formatted, "var value = +count;\n");
});

void test("retains plus-plus before identifiers", async () => {
    const formatted = await Format.format("var value = ++count;\n");

    assert.strictEqual(formatted, "var value = ++count;\n");
});

void test("preserves unary plus conversions", async () => {
    const formatted = await Format.format('var value = +"5";\n');

    assert.strictEqual(formatted, 'var value = +"5";\n');
});
