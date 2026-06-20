import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { runGmlRule } from "./rule-test-harness.js";

function runNormalizeDocCommentsRule(code: string): string {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["normalize-doc-comments"],
        code,
        programNode: { type: "Program" }
    }).output;
}

void test("normalize-doc-comments promotes leading summary lines into @description", () => {
    const input = [
        "// / Leading summary",
        "// / Additional note",
        "/// @param value - the input",
        "function demo(value) {",
        "    return value;",
        "}"
    ].join("\n");

    const output = runNormalizeDocCommentsRule(input);
    assert.match(output, /\/\/\/ @desc Leading summary/);
    assert.match(output, /\/\/\/\s+Additional note/);
    assert.match(output, /\/\/\/ @param value the input/);
    assert.doesNotMatch(output, /\/\/\/ @param value - the input/);
});

void test("normalize-doc-comments removes empty @description lines", () => {
    const input = ["/// @description", "function test() {}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);
    assert.doesNotMatch(output, /@desc\s*$/m);
});

void test("normalize-doc-comments removes top-of-file empty @description lines before plain comments", () => {
    const input = [
        "/// @description",
        "",
        "// Cast a ray from high above to the ground so that the coin is placed onto the ground",
        "var ray = cm_cast_ray(levelColmesh, cm_ray(x, y, 1000, x, y, -100));"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\s*\/\/\/ @desc\s*$/m);
    assert.match(output, /^\/\/ Cast a ray from high above to the ground so that the coin is placed onto the ground$/m);
});

void test("normalize-doc-comments removes empty @description while preserving adjacent function doc tags", () => {
    const input = ["/// @description", "/// @param value", "function test(value) {", "    return value;", "}"].join(
        "\n"
    );
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\s*\/\/\/ @desc\s*$/m);
    assert.match(output, /^\/\/\/ @param value$/m);
    assert.match(output, /^\/\/\/ @returns \{any\}$/m);
});

void test("normalize-doc-comments preserves non-empty @description content", () => {
    const input = ["/// @description Initialize the sky background", "var a = 1;"].join("\n");
    const output = runNormalizeDocCommentsRule(input);
    assert.match(output, /@desc Initialize the sky background/);
});

void test("normalize-doc-comments canonicalizes legacy // @tag comments", () => {
    const input = ["// @description legacy style", "function demo() {}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);
    assert.match(output, /^\/\/\/ @desc legacy style/m);
});

void test("normalize-doc-comments synthesizes missing doc tags for undocumented functions", () => {
    const input = ["function synth_me(_a, b = 1) {", "    return _a + b;", "}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\/\/\/ @description synth_me/m);
    assert.match(output, /^\/\/\/ @param a/m);
    assert.match(output, /^\/\/\/ @param \[b=1\]/m);
    assert.match(output, /^\/\/\/ @returns \{undefined\}/m);
    assert.doesNotMatch(output, /^\/\/\/ @description\s*$/m);
});

void test("normalize-doc-comments appends missing @param and @returns tags to existing doc blocks", () => {
    const input = [
        "/// @description Existing docs",
        "/// @param alpha",
        "function enrich_me(alpha, beta) {",
        "    return alpha + beta;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @desc Existing docs/m);
    assert.match(output, /^\/\/\/ @param alpha/m);
    assert.match(output, /^\/\/\/ @param beta/m);
    assert.match(output, /^\/\/\/ @returns \{undefined\}/m);
});

void test("normalize-doc-comments treats @arg and @argument as documented parameters", () => {
    const input = [
        "/// @arg alpha",
        "/// @argument beta",
        "function enrich_me(alpha, beta) {",
        "    return alpha + beta;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @param alpha$/m);
    assert.match(output, /^\/\/\/ @param beta$/m);
    assert.doesNotMatch(output, /^\/\/\/ @arg alpha$/m);
    assert.doesNotMatch(output, /^\/\/\/ @argument beta$/m);
    assert.match(output, /^\/\/\/ @returns \{undefined\}/m);
});

void test("normalize-doc-comments canonicalizes doc tag aliases via Core replacements", () => {
    const input = [
        "/// @desc Computes a score",
        "/// @arg alpha - first input",
        "/// @params beta",
        "/// @return {real}",
        "function compute(alpha, beta) {",
        "    return alpha + beta;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @desc Computes a score$/m);
    assert.match(output, /^\/\/\/ @param alpha first input$/m);
    assert.doesNotMatch(output, /^\/\/\/ @param alpha - first input$/m);
    assert.match(output, /^\/\/\/ @param beta$/m);
    assert.match(output, /^\/\/\/ @returns \{real\}$/m);
    assert.doesNotMatch(output, /^\/\/\/ @description\b/m);
    assert.doesNotMatch(output, /^\/\/\/ @arg\b/m);
    assert.doesNotMatch(output, /^\/\/\/ @params\b/m);
    assert.doesNotMatch(output, /^\/\/\/ @return\b/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments treats @return as an existing returns tag", () => {
    const input = ["/// @return {real}", "function enrich_me(alpha) {", "    return alpha;", "}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @returns \{real\}$/m);
    assert.doesNotMatch(output, /^\/\/\/ @return \{real\}$/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments synthesizes tags for function assignments", () => {
    const input = [
        "var build_struct = function (_value, amount = 1) {",
        "    return { value: _value, amount: amount };",
        "};"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\/\/\/ @description build_struct/m);
    assert.match(output, /^\/\/\/ @param value/m);
    assert.match(output, /^\/\/\/ @param \[amount=1\]/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}/m);
});

void test("normalize-doc-comments synthesizes tags when braces are on the next line", () => {
    const input = ["function split_header(arg_one, _arg_two)", "{", "    return arg_one + _arg_two;", "}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\/\/\/ @description split_header/m);
    assert.match(output, /^\/\/\/ @param arg_one/m);
    assert.match(output, /^\/\/\/ @param arg_two/m);
    assert.match(output, /^\/\/\/ @returns \{undefined\}/m);
});

void test("normalize-doc-comments synthesizes tags for static function variable declarations", () => {
    const input = ["static spawn_enemy = function (_x, y = 0) {", "    return _x + y;", "};"].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\/\/\/ @description spawn_enemy/m);
    assert.match(output, /^\/\/\/ @param x/m);
    assert.match(output, /^\/\/\/ @param \[y=0\]/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}/m);
});

void test("normalize-doc-comments removes legacy @function and normalizes default-param docs", () => {
    const input = [
        "/// @function update_ground_dist",
        "/// @description Updates ground_dist each step",
        "/// @param ray_len",
        "/// @returns {undefined}",
        "update_ground_dist = function(ray_len = 128) {",
        "    return;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.doesNotMatch(output, /^\/\/\/ @function /m);
    assert.match(output, /^\/\/\/ @desc Updates ground_dist each step$/m);
    assert.match(output, /^\/\/\/ @param ray_len$/m);
    assert.match(output, /^\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments omits explicit undefined defaults in typed optional @param docs", () => {
    const input = [
        "function local_assignment_container(seed) {",
        "    /// @param {Struct.MyCustomStruct} [first=undefined] first typed description should remain.",
        "    /// @custom local annotations should stay.",
        "    /// @param second second description should remain.",
        "    /// @returns {undefined}",
        "    var local_documented_reorder = function (first = undefined, second) {",
        "        return;",
        "    };",
        "",
        "    return seed;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(
        output,
        /^ {4}\/\/\/ @param \{Struct\.MyCustomStruct\} \[first\] first typed description should remain\.$/m
    );
    assert.doesNotMatch(output, /\[first=undefined\]/m);
    assert.match(output, /^ {4}\/\/\/ @custom local annotations should stay\.$/m);
    assert.match(output, /^ {4}\/\/\/ @param second second description should remain\.$/m);
    assert.match(output, /^ {4}\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments synthesizes typed @returns when return value is an unambiguous typed param passthrough", () => {
    const input = [
        "/// @param {real} [angle=90]",
        "function update_movement(angle = 90) {",
        "    return angle;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @param \{real\} \[angle=90\]$/m);
    assert.match(output, /^\/\/\/ @returns \{real\}$/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments synthesizes @returns {any} when passthrough param lacks type metadata", () => {
    const input = ["/// @param [angle=90]", "function update_movement(angle = 90) {", "    return angle;", "}"].join(
        "\n"
    );
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @param \[angle=90\]$/m);
    assert.match(output, /^\/\/\/ @returns \{any\}$/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments preserves multiline @description continuations while synthesizing missing tags", () => {
    const input = [
        "/// @description Build a spawn packet",
        "/// with a deterministic seed",
        "function build_packet(seed) {",
        "    return seed;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @desc Build a spawn packet/m);
    assert.match(output, /^\/\/\/\s+with a deterministic seed/m);
    assert.match(output, /^\/\/\/ @param seed/m);
    assert.match(output, /^\/\/\/ @returns \{any\}/m);
});

void test("normalize-doc-comments does not convert // // section comments into synthetic docs", () => {
    const input = [
        "// //A couple additional examples for optional gamepad types (see __input_define_gamepad_types)",
        "//",
        "// //Nintendo 64",
        "// input_icons(INPUT_GAMEPAD_TYPE_N64)",
        '// .add("gamepad face south",         "A")',
        '// .add("gamepad face east",          "B")',
        "",
        '// .add("gamepad thumbstick r down",  "C down")',
        "//",
        "// //Sega Saturn",
        "// input_icons(INPUT_GAMEPAD_TYPE_SATURN)",
        '// .add("gamepad face south", "A")',
        '// .add("gamepad face east",  "B")'
    ].join("\n");

    const output = runNormalizeDocCommentsRule(input);
    assertEquals(output, input);
});

void test("normalize-doc-comments keeps operator comments that start with // / unchanged", () => {
    const input = ["if (", "    _last_byte == 47 || // /=", ") {", '    show_debug_message("Yay");', "}"].join("\n");

    const output = runNormalizeDocCommentsRule(input);
    assert.match(output, /\/\/ \/=/u);
    assert.doesNotMatch(output, /\/\/\/ =/u);
});

void test("normalize-doc-comments preserves non-typed @returns payload while cleaning malformed // / docs", () => {
    const input = [
        "// / Parse one row",
        "// /",
        "/// @returns Parsed row object",
        "function parse_row(_row) {",
        "    return _row;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @desc Parse one row$/m);
    assert.match(output, /^\/\/\/ @param row$/m);
    assert.match(output, /^\/\/\/ @returns Parsed row object$/m);
    assert.doesNotMatch(output, /^\/\/\/\s*$/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{any\}$/m);
});

void test("normalize-doc-comments preserves function indentation for synthesized docs", () => {
    const input = ["if (enabled) {", "    function inner(_value) {", "        return _value;", "    }", "}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^ {4}\/\/\/ @param value$/m);
    assert.match(output, /^ {4}\/\/\/ @returns \{any\}$/m);
});

void test("normalize-doc-comments removes @param separator hyphens for typed optional params", () => {
    const input = [
        "/// @param {real} [xup=0] - The camera's up vector (default +Z axis)",
        "/// @param {real} [yup=0] - The camera's up vector (default +Z axis)",
        "function build_camera(xup = 0, yup = 0) {",
        "    return;",
        "}"
    ].join("\n");

    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @param \{real\} \[xup=0\] The camera's up vector \(default \+Z axis\)$/m);
    assert.match(output, /^\/\/\/ @param \{real\} \[yup=0\] The camera's up vector \(default \+Z axis\)$/m);
    assert.doesNotMatch(output, /\[xup=0\] - The camera's up vector/m);
    assert.doesNotMatch(output, /\[yup=0\] - The camera's up vector/m);
});

void test("normalize-doc-comments repairs malformed optional @param defaults with extra brackets", () => {
    const input = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=[CM.MASK]]]]]]]]]]]",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @param cylinder$/m);
    assert.match(output, /^\/\/\/ @param collider$/m);
    assert.match(output, /^\/\/\/ @param \[mask=collider\[CM\.MASK\]\]$/m);
    assert.doesNotMatch(output, /^\/\/\/ @param \[mask=\[CM\.MASK\]/m);
    assert.doesNotMatch(output, /\]\]\]\]\]/m);
    assert.match(output, /^\/\/\/ @returns \{any\}$/m);
});

void test("normalize-doc-comments does not synthesize @returns for constructor function declarations", () => {
    const input = ["function __ChatterboxBufferBatch() constructor {", "    // ...", "}"].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assertEquals(output, input);
    assert.doesNotMatch(output, /^\/\/\/ @returns \{undefined\}$/m);
});

void test("normalize-doc-comments still synthesizes @param tags for constructors without adding @returns", () => {
    const input = ["function __ChatterboxBufferBatch(_value, _amount = 1) constructor {", "    return;", "}"].join(
        "\n"
    );
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /^\/\/\/ @param value$/m);
    assert.match(output, /^\/\/\/ @param \[amount=1\]$/m);
    assert.doesNotMatch(output, /^\/\/\/ @returns/m);
});

void test("normalize-doc-comments removes existing @returns tags for constructors", () => {
    const input = [
        "/// @param value",
        "/// @returns {undefined}",
        "function __ChatterboxBufferBatch(_value) constructor {",
        "    return;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);
    const expected = [
        "/// @param value",
        "function __ChatterboxBufferBatch(_value) constructor {",
        "    return;",
        "}"
    ].join("\n");

    assertEquals(output, expected);
    assert.doesNotMatch(output, /^\/\/\/ @returns/m);
});

void test("normalize-doc-comments remaps wrong param names to correct function parameter names", () => {
    // When doc comment has parameter lines whose names don't match the function
    // signature, they are paired with the missing function params in order.
    const input = [
        "/// @param wrong_a First param description.",
        "/// @param wrong_b Second param description.",
        "function paired_remap(correct_a, correct_b) {",
        "    return;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);
    const expected = [
        "/// @param correct_a First param description.",
        "/// @param correct_b Second param description.",
        "/// @returns {undefined}",
        "function paired_remap(correct_a, correct_b) {",
        "    return;",
        "}"
    ].join("\n");

    assertEquals(output, expected);
});

void test("normalize-doc-comments remaps excess unmatched param lines only up to missing params count", () => {
    // When there are more unmatched doc param lines than missing function params,
    // only the first N are remapped (N = number of missing params), and excess
    // lines that cannot be paired are removed by the subsequent prune pass.
    const input = [
        "/// @param wrong_a",
        "/// @param wrong_b",
        "/// @param wrong_c",
        "function partial_remap(correct_a, correct_b) {",
        "    return;",
        "}"
    ].join("\n");
    const output = runNormalizeDocCommentsRule(input);

    assert.match(output, /\/\/\/ @param correct_a/);
    assert.match(output, /\/\/\/ @param correct_b/);
    // wrong_c had no corresponding function param and must not appear in output
    assert.doesNotMatch(output, /wrong_c/);
});
