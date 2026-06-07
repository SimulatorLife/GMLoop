import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeBannerCommentsRule(code: string): string {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-banner-comments"],
        code,
        programNode: { type: "Program" }
    }).output;
}

void test("normalize-banner-comments canonicalizes decorative slash banner lines", () => {
    const input = [
        "////////////////////////////////////////",
        "//-------------------Move camera-----------------------//",
        "////////////////////////////////////",
        "camUpdateTimer += 1;"
    ].join("\n");

    const output = runNormalizeBannerCommentsRule(input);
    assertEquals(output, ["", "// Move camera", "", "camUpdateTimer += 1;"].join("\n"));
});

void test("normalize-banner-comments converts prefixed banner headings to plain comments", () => {
    const input = ["//////// Banner comment", "var value = 1;"].join("\n");
    const output = runNormalizeBannerCommentsRule(input);
    assertEquals(output, ["// Banner comment", "var value = 1;"].join("\n"));
});

void test("normalize-banner-comments strips trailing backslash decorations from slash banners", () => {
    const input = [
        "//-------------Make a collider for the cluster------------------\\\\",
        "instance_create_layer();"
    ].join("\n");
    const output = runNormalizeBannerCommentsRule(input);
    assertEquals(output, ["// Make a collider for the cluster", "instance_create_layer();"].join("\n"));
});

void test("normalize-banner-comments leaves doc-tag comments untouched", () => {
    const input = [
        "// @description Top comment",
        "/// @param value",
        "function demo(value) {",
        "    return value;",
        "}"
    ].join("\n");

    const output = runNormalizeBannerCommentsRule(input);
    assertEquals(output, input);
});

void test("normalize-banner-comments collapses decorative slash banners into attached block comments without extra indentation", () => {
    const input = [
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
    const output = runNormalizeBannerCommentsRule(input);

    assertEquals(
        output,
        [
            "function demo() {",
            "    /*",
            "        Block docs",
            "    */",
            "\t/* Return an array */",
            "\treturn [1, 2, 3];",
            "}",
            ""
        ].join("\n")
    );
});

void test("normalize-banner-comments collapses multiple consecutive decorative banners into a single attached one-line block comment", () => {
    const input = [
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
    const output = runNormalizeBannerCommentsRule(input);

    assertEquals(
        output,
        ["function demo() {", "\t/* Block docs */", "\t/* Return an array */", "\treturn [1, 2, 3];", "}", ""].join(
            "\n"
        )
    );
});

void test("normalize-banner-comments collapses decorative banners even when surrounded by adjacent block comment blocks", () => {
    const input = [
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
    const output = runNormalizeBannerCommentsRule(input);

    assertEquals(
        output,
        [
            "function demo() {",
            "    /*",
            "    Block docs",
            "    */",
            "\t/* Return an array */",
            "    /*",
            "    Trailing docs",
            "    */",
            "    return [1, 2, 3];",
            "}",
            ""
        ].join("\n")
    );
});

void test("normalize-banner-comments normalizes method-list triple-slash lines into plain line comments", () => {
    const input = [
        "// Feather disable all",
        "/// .__Destroy()",
        "///",
        "/// .__GetBuffer()",
        "function __Batch() constructor {}",
        ""
    ].join("\n");
    const output = runNormalizeBannerCommentsRule(input);

    assertEquals(
        output,
        [
            "// Feather disable all",
            "// .__Destroy()",
            "// .__GetBuffer()",
            "function __Batch() constructor {}",
            ""
        ].join("\n")
    );
});

void test("normalize-banner-comments ignores empty triple-slash separators between method-list entries", () => {
    const input = ["/// .__Destroy()", "///", "///", "/// .__GetBuffer()", "function __Batch() constructor {}"].join(
        "\n"
    );
    const output = runNormalizeBannerCommentsRule(input);

    assertEquals(output, ["// .__Destroy()", "// .__GetBuffer()", "function __Batch() constructor {}"].join("\n"));
});
