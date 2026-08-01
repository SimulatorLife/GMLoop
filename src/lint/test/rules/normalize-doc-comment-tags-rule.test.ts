import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("normalize-doc-comment-tags canonicalizes legacy // @tag comments", () => {
    const input = ["// @description legacy style", "function demo() {}", ""].join("\n");
    const expected = ["/// @description legacy style", "function demo() {}", ""].join("\n");

    const result = lintWithRule("normalize-doc-comment-tags", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comment-tags canonicalizes doc tag aliases", () => {
    const input = [
        "/// @desc Computes a score",
        "/// @arg alpha - first input",
        "/// @params beta",
        "/// @private",
        "/// @return {real}",
        "function compute(alpha, beta) {",
        "    return alpha + beta;",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @desc Computes a score",
        "/// @param alpha - first input",
        "/// @param beta",
        "/// @ignore",
        "/// @returns {real}",
        "function compute(alpha, beta) {",
        "    return alpha + beta;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comment-tags", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comment-tags leaves legacy function marker aliases to remove-doc-function-tags", () => {
    const input = ["/// @funct example", "/// @method draw", "function example() {}", ""].join("\n");

    const result = lintWithRule("normalize-doc-comment-tags", input, {});
    assertEquals(result.output, input);
});

void test("normalize-doc-comment-tags supports legacy // / doc markers without rewriting operator comments", () => {
    const input = [
        "// / Parse one row",
        "// /",
        "if (",
        "    _last_byte == 47 || // /=",
        ") {",
        '    show_debug_message("Yay");',
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// Parse one row",
        "///",
        "if (",
        "    _last_byte == 47 || // /=",
        ") {",
        '    show_debug_message("Yay");',
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comment-tags", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comment-tags converts escaped four-slash docs to explicit escaped doc form", () => {
    const input = ["//// @func freeze()", "/// / already escaped", ""].join("\n");
    const expected = ["/// / @func freeze()", "/// / already escaped", ""].join("\n");

    const result = lintWithRule("normalize-doc-comment-tags", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comment-tags does not convert // // section comments into docs", () => {
    const input = [
        "// //Nintendo 64",
        "// input_icons(INPUT_GAMEPAD_TYPE_N64)",
        '// .add("gamepad face south", "A")',
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comment-tags", input, {});
    assertEquals(result.output, input);
});
