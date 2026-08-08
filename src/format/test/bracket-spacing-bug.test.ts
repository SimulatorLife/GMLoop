/**
 * Bug test: bracketSpacing option is not respected
 * The formatter should respect the bracketSpacing option from Prettier.
 * When bracketSpacing: false, object literals should be formatted as {x:1}
 * When bracketSpacing: true, object literals should be formatted as { x: 1 }
 * The same rule applies to array literals (`[x, y]` vs `[ x, y ]`).
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "@gmloop/format";
import prettier from "prettier";

const testCode = "var obj = {x: 1, y: 2};";
const testArrayCode = "var arr = [x, y, z];";

void test("bracketSpacing: false should remove spaces inside braces", async () => {
    const formatted = await prettier.format(testCode, {
        parser: "gml-parse",
        plugins: [Format],
        bracketSpacing: false
    });

    assert.ok(formatted.includes("{x:"), `Expected no space after opening brace, but got: ${formatted}`);
});

void test("bracketSpacing: true should add spaces inside braces", async () => {
    const formatted = await prettier.format(testCode, {
        parser: "gml-parse",
        plugins: [Format],
        bracketSpacing: true
    });

    assert.ok(formatted.includes("{ x:"), `Expected space after opening brace, but got: ${formatted}`);
});

void test("bracketSpacing: false should remove spaces inside array brackets", async () => {
    const formatted = await prettier.format(testArrayCode, {
        parser: "gml-parse",
        plugins: [Format],
        bracketSpacing: false
    });

    assert.ok(formatted.includes("[x,"), `Expected no space after opening bracket, but got: ${formatted}`);
});

void test("bracketSpacing: true should add spaces inside array brackets", async () => {
    // Regression test for the array-side gap in `printArrayExpressionNode`: the
    // struct path accepted `options.bracketSpacing` but the array path ignored
    // it, so this case round-tripped to `[x, y, z]` regardless of the option.
    // The fix threads the same `padding` value through `printCommaSeparatedList`
    // that `printStructExpressionNode` already uses, so both literal kinds now
    // honour the option uniformly.
    const formatted = await prettier.format(testArrayCode, {
        parser: "gml-parse",
        plugins: [Format],
        bracketSpacing: true
    });

    assert.ok(formatted.includes("[ x,"), `Expected space after opening bracket, but got: ${formatted}`);
});
