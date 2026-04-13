import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

const SOURCE_LINES = [
    "function coefficients() {",
    "    var a = .5;",
    "    var b = 5.;",
    "    var c = 0.;",
    "    return a + b;",
    "}",
    ""
];

// This tests the default, opinionated behavior of the formatter
// To pad leading zeroes around decimal points and trim unnecessary trailing decimal points
void test("pads bare decimal literals by default", async () => {
    const formatted = await Format.format(SOURCE_LINES.join("\n"));

    assert.strictEqual(
        formatted,
        [
            "function coefficients() {",
            "    var a = 0.5;",
            "    var b = 5;",
            "    var c = 0;",
            "    return a + b;",
            "}",
            ""
        ].join("\n")
    );
});

void test("pads negative bare decimal literals by default", async () => {
    const source = [
        "function coefficients() {",
        "    var a = -.5;",
        "    var b = -5.;",
        "    var c = -0.;",
        "    return a + b + c;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    // After decimal normalization `-.5` becomes `-0.5`, `-5.` becomes `-5`,
    // and `-0.` becomes `-0`.  The formatter no longer collapses `-0` to `0`
    // because that is a semantic rewrite (removing a unary operator); the
    // `gml/no-negative-zero` lint rule owns that transformation instead.
    // (target-state.md §2.1, §3.2)
    assert.strictEqual(
        formatted,
        [
            "function coefficients() {",
            "    var a = -0.5;",
            "    var b = -5;",
            "    var c = -0;",
            "    return a + b + c;",
            "}",
            ""
        ].join("\n")
    );
});

void test("does not modify already normalized decimals", async () => {
    const source = [
        "function coefficients() {",
        "    var a = 0.5;",
        "    var b = 5;",
        "    var c = 0;",
        "    return a + b + c;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(formatted, source);
});

void test("pads bare decimals in expressions and preserves operator spacing", async () => {
    const source = [
        "function coefficients() {",
        "    var a = .5 + .25;",
        "    var b = 5. + 0.;",
        "    var c = (.5 * 2.) + (1. * .5);",
        "    return a + b + c;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    // Redundant parentheses around multiplicative expressions inside additive
    // expressions are removed (multiplication binds tighter than addition, so
    // the grouping is unchanged). This is consistent with the behaviour tested
    // in `parentheses.test.ts` ("omits redundant multiplicative parentheses
    // inside additive expressions").
    assert.strictEqual(
        formatted,
        [
            "function coefficients() {",
            "    var a = 0.5 + 0.25;",
            "    var b = 5 + 0;",
            "    var c = 0.5 * 2 + 1 * 0.5;",
            "    return a + b + c;",
            "}",
            ""
        ].join("\n")
    );
});

void test("pads bare decimals in comparisons and logical expressions", async () => {
    const source = [
        "function coefficients() {",
        "    var h = .5;",
        "    if ((h < 0.) or (h > 1.)) {",
        "        exit;",
        "    }",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        [
            "function coefficients() {",
            "    var h = 0.5;",
            "    if ((h < 0) or (h > 1)) {",
            "        exit;",
            "    }",
            "}",
            ""
        ].join("\n")
    );
});

void test("pads bare decimals in array literals and function calls", async () => {
    const source = [
        "function coefficients() {",
        "    var arr = [.5, 1., 2.5, 0.];",
        "    var v = clamp(.5, 0., 1.);",
        "    return arr[0] + v;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        [
            "function coefficients() {",
            "    var arr = [0.5, 1, 2.5, 0];",
            "    var v = clamp(0.5, 0, 1);",
            "    return arr[0] + v;",
            "}",
            ""
        ].join("\n")
    );
});

void test("does not rewrite numeric literals embedded in strings", async () => {
    const source = ["function coefficients() {", '    var s = ".5 5. 0.";', "    return s;", "}", ""].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(formatted, source);
});

void test("does not rewrite numeric-like sequences inside comments", async () => {
    const source = [
        "function coefficients() {",
        "    // .5 5. 0.",
        "    /* .5 5. 0. */",
        "    var a = .5;",
        "    return a;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        [
            "function coefficients() {",
            "    // .5 5. 0.",
            "    /* .5 5. 0. */",
            "    var a = 0.5;",
            "    return a;",
            "}",
            ""
        ].join("\n")
    );
});

void test("pads bare decimals after unary operators", async () => {
    const source = [
        "function coefficients() {",
        "    var a = -.5;",
        "    var b = +.5;",
        "    return a + b;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        ["function coefficients() {", "    var a = -0.5;", "    var b = +0.5;", "    return a + b;", "}", ""].join("\n")
    );
});
