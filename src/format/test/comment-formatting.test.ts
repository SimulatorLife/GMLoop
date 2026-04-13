import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

function toGmlSource(lines: ReadonlyArray<string>): string {
    return lines.join("\n");
}

async function assertFormattedOutput(
    sourceLines: ReadonlyArray<string>,
    expectedLines: ReadonlyArray<string>
): Promise<void> {
    const formatted = await Format.format(toGmlSource(sourceLines));
    assert.equal(formatted, toGmlSource(expectedLines));
}

void test("preserves triple-slash continuation lines adjacent to doc tags", async () => {
    const source = [
        "/// @description Base doc line.",
        "///              Continuation text is intentionally aligned.",
        "function demo() {}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "/// @description Base doc line.",
            "///              Continuation text is intentionally aligned.",
            "function demo() {}",
            ""
        ].join("\n")
    );
});

void test("does not normalize method-list triple-slash lines into plain line comments", async () => {
    const source = [
        "// Feather disable all",
        "/// .__Destroy()",
        "///",
        "/// .__GetBuffer()",
        "function __Batch() constructor {}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.match(formatted, /^\/\/\/ \.__Destroy\(\)$/m);
    assert.match(formatted, /^\/\/\/ \.__GetBuffer\(\)$/m);
    assert.match(formatted, /^\/\/\/$/m);
    assert.doesNotMatch(formatted, /^\/\/ \.__Destroy\(\)$/m);
    assert.doesNotMatch(formatted, /^\/\/ \.__GetBuffer\(\)$/m);
    assert.doesNotMatch(formatted, /^\/\/ \/ \.__Destroy\(\)$/m);
});

void test("does not insert empty doc separator between description and continuation", async () => {
    const source = [
        "/// @description Write a unit triangular prism.",
        "/// Local space: X in [-0.5,+0.5], Y in [-0.5,+0.5].",
        "function prism() {}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "/// @description Write a unit triangular prism.",
            "/// Local space: X in [-0.5,+0.5], Y in [-0.5,+0.5].",
            "function prism() {}",
            ""
        ].join("\n")
    );
});

void test("keeps indented non-decorative block comments attached to function bodies", async () => {
    const source = [
        "function demo() {",
        "    /*",
        "\t\tExample block comment",
        "    */",
        "    return 1;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        ["function demo() {", "    /*", "\t\tExample block comment", "    */", "    return 1;", "}", ""].join("\n")
    );
});

void test("does not collapse decorative slash banners into attached block comments", async () => {
    const source = [
        "function demo() {",
        "    /*",
        "        Block docs",
        "    */",
        "\t/*////////////////////////////////////////////////////",
        "\t        Return an array",
        "\t*/////////////////////////////////////////////////////",
        "\treturn [1, 2, 3];",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.match(formatted, /\/\*\/{20,}/u);
    assert.match(formatted, /\*\/{20,}/u);
    assert.doesNotMatch(formatted, /\/\* Return an array \*\//u);
});

void test("preserves adjacent non-decorative block comment blocks as separate blocks", async () => {
    await assertFormattedOutput(
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    */",
            "    /*",
            "    Return an array",
            "    */",
            "    return [1, 2, 3];",
            "}",
            ""
        ],
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    */",
            "    /*",
            "    Return an array",
            "    */",
            "    return [1, 2, 3];",
            "}",
            ""
        ]
    );
});

void test("preserves adjacent non-decorative block comment blocks at top level as separate blocks", async () => {
    await assertFormattedOutput(
        ["/*", "Block docs", "*/", "/*", "Return an array", "*/", "function demo() {}", ""],
        ["/*", "Block docs", "*/", "/*", "Return an array", "*/", "function demo() {}", ""]
    );
});

void test("does not merge adjacent non-decorative block comment blocks separated by whitespace", async () => {
    await assertFormattedOutput(
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    */",
            "",
            "    /*",
            "    Return an array",
            "    */",
            "    return [1, 2, 3];",
            "}",
            ""
        ],
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    */",
            "",
            "    /*",
            "    Return an array",
            "    */",
            "    return [1, 2, 3];",
            "}",
            ""
        ]
    );
});

void test("does not collapse multiple consecutive decorative banners into one-line block comments", async () => {
    const source = [
        "function demo() {",
        "\t/*////////////////////////////////////////////////////",
        "\t        Block docs",
        "\t*/////////////////////////////////////////////////////",
        "\t/*////////////////////////////////////////////////////",
        "\t        Return an array",
        "\t*/////////////////////////////////////////////////////",
        "\treturn [1, 2, 3];",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    const decorativeBannerOpenMatches = formatted.match(/\/\*\/{20,}/gu) ?? [];
    assert.equal(decorativeBannerOpenMatches.length, 2);
    assert.doesNotMatch(formatted, /\/\* Block docs \*\//u);
    assert.doesNotMatch(formatted, /\/\* Return an array \*\//u);
});

void test("does not drop slash-only line after decorative block comment", async () => {
    const source = [
        "function demo() {",
        "    /*////////////////////////////////////////////////////",
        "            Block docs",
        "    */////////////////////////////////////////////////////",
        "    //////////////////////////////////////////////////////",
        "    return 1;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    const slashOnlyBannerLines = formatted.match(/^\s*\/{21,}\s*$/gmu) ?? [];
    assert.equal(slashOnlyBannerLines.length, 0);
});

void test("does not duplicate same-line slash suffix after decorative block comments", async () => {
    const source = [
        "/*////////////////////////////////////////////////////////////////",
        "    Orthogonalize the P2 direction to the vector from P1 to P3",
        "*/////////////////////////////////////////////////////////////////",
        "",
        "/*////////////////////////////////////////////////////////////////////////////////////////////////////////",
        "    The idea behind the algorithm is to imagine a sphere placed at P1 with radius of the first bone, and",
        "    another sphere at P3 with the radius of the second bone. The intersection between these spheres is a",
        "    circle representing all the possible placements of P2.",
        "    The first step is to find the middle point of this circle, and the radius of this intersection circle",
        "*/////////////////////////////////////////////////////////////////////////////////////////////////////////",
        "var p1_p3sqr = p1_p3 * p1_p3",
        ""
    ].join("\n");

    const formatted = await Format.format(source, { printWidth: 120 });

    assert.equal(
        formatted,
        [
            "/*////////////////////////////////////////////////////////////////",
            "    Orthogonalize the P2 direction to the vector from P1 to P3",
            "*/ ////////////////////////////////////////////////////////////////",
            "",
            "/*////////////////////////////////////////////////////////////////////////////////////////////////////////",
            "    The idea behind the algorithm is to imagine a sphere placed at P1 with radius of the first bone, and",
            "    another sphere at P3 with the radius of the second bone. The intersection between these spheres is a",
            "    circle representing all the possible placements of P2.",
            "    The first step is to find the middle point of this circle, and the radius of this intersection circle",
            "*/ ////////////////////////////////////////////////////////////////////////////////////////////////////////",
            "var p1_p3sqr = p1_p3 * p1_p3;",
            ""
        ].join("\n")
    );
    const slashOnlyBannerLines = formatted.match(/^\s*\/{21,}\s*$/gmu) ?? [];
    assert.equal(slashOnlyBannerLines.length, 0);
});

void test("does not convert adjacent multi-line block comment blocks into line comments", async () => {
    const source = [
        "function demo() {",
        "    /*",
        "    Block docs",
        "    */",
        "    /*",
        "    Return an array",
        "    */",
        "    return [1, 2, 3];",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    */",
            "    /*",
            "    Return an array",
            "    */",
            "    return [1, 2, 3];",
            "}",
            ""
        ].join("\n")
    );
});

void test("does not collapse a non-decorative multi-line block comment into a one-line block comment", async () => {
    const source = [
        "function demo() {",
        "    /*",
        "    Block docs",
        "    Still block docs",
        "    */",
        "    return 1;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    Still block docs",
            "    */",
            "    return 1;",
            "}",
            ""
        ].join("\n")
    );
});

void test("does not collapse decorative banners when surrounded by adjacent block comment blocks", async () => {
    const source = [
        "function demo() {",
        "    /*",
        "    Block docs",
        "    */",
        "\t/*////////////////////////////////////////////////////",
        "\t        Return an array",
        "\t*/////////////////////////////////////////////////////",
        "    /*",
        "    Trailing docs",
        "    */",
        "    return [1, 2, 3];",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.match(formatted, /\/\*\/{20,}/u);
    assert.doesNotMatch(formatted, /\/\* Return an array \*\//u);
});

void test("formats top-level doc block comments without duplicating leading stars", async () => {
    const source = [
        "/**",
        "*\tSnowState | v3.1.4",
        "*\tDocumentation: https://github.com/sohomsahaun/SnowState/wiki",
        "*",
        "*\tAuthor: Sohom Sahaun | @sohomsahaun",
        "*/",
        "function demo() {}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "/**",
            "*\tSnowState | v3.1.4",
            "*\tDocumentation: https://github.com/sohomsahaun/SnowState/wiki",
            "*",
            "*\tAuthor: Sohom Sahaun | @sohomsahaun",
            "*/",
            "function demo() {}",
            ""
        ].join("\n")
    );
});

void test("preserves blank lines between adjacent function doc-comment tags", async () => {
    const source = [
        "/// @description Create collectible particles and inherit",
        "",
        "/// @function scr_bezier_4()",
        "function scr_bezier_4() {}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "/// @description Create collectible particles and inherit",
            "",
            "/// @function scr_bezier_4()",
            "function scr_bezier_4() {}",
            ""
        ].join("\n")
    );
});

void test("keeps mixed doc-comment prefixes attached without normalizing content", async () => {
    const source = [
        "/// @function scr_create_fx",
        "// @param sprite_index",
        "/* @description Create an effect */",
        "/// @returns {Id.Instance} instance",
        "function scr_create_fx() {}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "/// @function scr_create_fx",
            "// @param sprite_index",
            "/* @description Create an effect */",
            "/// @returns {Id.Instance} instance",
            "function scr_create_fx() {}",
            ""
        ].join("\n")
    );
});

void test("preserves top-level decorative banner raw token text", async () => {
    const source = [
        "\t/*////////////////////////////////////////////////////",
        "\t    Banner docs",
        "\t    */////////////////////////////////////////////////////",
        "var value = 1;",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        [
            "/*////////////////////////////////////////////////////",
            "\t    Banner docs",
            "\t    */ ////////////////////////////////////////////////////",
            "var value = 1;",
            ""
        ].join("\n")
    );
});
