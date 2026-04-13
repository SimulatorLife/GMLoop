import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";
import { createLocResolver, type ReplaceTextRangeFixOperation } from "./rule-test-harness.js";

const { Lint } = LintWorkspace;

void test("prefer-struct-literal-assignments ignores non-identifier struct bases", () => {
    const input = [
        "function update_input_vec(input_vec_list) {",
        "    input_vec_list[0].x = 0;",
        "    input_vec_list[0].y = 0;",
        "    input_vec_list[0].z = 0;",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("prefer-struct-literal-assignments", input);
    assertEquals(result.messages.length, 0);
});

void test("prefer-struct-literal-assignments condenses assignments only at immediate struct creation", () => {
    const input = [
        "function create_input_vec() {",
        "    var input_vec = {};",
        "    input_vec.x = 0;",
        "    input_vec.y = 0;",
        "    input_vec.z = 0;",
        "}",
        ""
    ].join("\n");
    const expected = ["function create_input_vec() {", "    var input_vec = {x: 0, y: 0, z: 0};", "}", ""].join("\n");

    const result = lintWithRule("prefer-struct-literal-assignments", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-struct-literal-assignments does not collapse assignments on existing structs", () => {
    const input = [
        "function update_input_vec(input_vec) {",
        "    input_vec.x = 0;",
        "    input_vec.y = 0;",
        "    input_vec.z = 0;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-struct-literal-assignments", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-struct-literal-assignments ignores duplicate property update clusters", () => {
    const input = [
        "function collide(other) {",
        "    other.pos = other.pos.Add(step);",
        "    other.pos = other.pos.Add(step2);",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-struct-literal-assignments", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-struct-literal-assignments never collapses built-in global property writes", () => {
    const input = ["global.AsyncLoaderQueue = ds_queue_create();", "global.AsyncLoaderHandle = -1;", ""].join("\n");
    const result = lintWithRule("prefer-struct-literal-assignments", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-struct-literal-assignments reports the first matching assignment location", () => {
    const input = [
        "#macro STILE_PLATFORM_HEIGHT 120",
        "",
        "function demo() {",
        "    settings = {};",
        "    settings.speed = 10;",
        '    settings.mode = "arcade";',
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-struct-literal-assignments", input);
    assertEquals(result.messages.length, 1);
    assert.deepEqual(result.messages[0]?.loc, { line: 5, column: 4 });
});

void test("normalize-doc-comments removes placeholder description equal to function name", () => {
    const input = [
        "/// @description __ChatterboxClassSource",
        "/// @param filename",
        "/// @param buffer",
        "/// @param compile",
        "/// @returns {undefined}",
        "function __ChatterboxClassSource(_filename, _buffer, _compile) constructor { /* ... */ }",
        ""
    ].join("\n");
    const expected = [
        "/// @param filename",
        "/// @param buffer",
        "/// @param compile",
        "function __ChatterboxClassSource(_filename, _buffer, _compile) constructor { /* ... */ }",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments attaches params across blank lines before a function", () => {
    const input = ["/// @param value", "", "", "function echo(_value) {", "    return _value;", "}", ""].join("\n");
    const expected = [
        "/// @param value",
        "/// @returns {any}",
        "function echo(_value) {",
        "    return _value;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments removes earlier floating param blocks and keeps the nearest block attached", () => {
    const input = [
        "/// @param localScope",
        "/// @param filename",
        "/// @param expression",
        "/// @param behaviour",
        "/// @param optionUUID",
        "",
        "/// @param local_scope",
        "/// @param filename",
        "/// @param expression",
        "/// @param behaviour",
        "/// @param optionUUID",
        "",
        "function __ChatterboxEvaluate(_local_scope, _filename, _expression, _behaviour, _optionUUID) {",
        "    return _expression;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @param local_scope",
        "/// @param filename",
        "/// @param expression",
        "/// @param behaviour",
        "/// @param optionUUID",
        "/// @returns {any}",
        "function __ChatterboxEvaluate(_local_scope, _filename, _expression, _behaviour, _optionUUID) {",
        "    return _expression;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments aligns multiline description continuations", () => {
    const input = ["/// Alpha summary", "/// Beta continuation", "function demo() {", "    return 1;", "}", ""].join(
        "\n"
    );
    const expected = [
        "/// @description Alpha summary",
        "/// Beta continuation",
        "function demo() {",
        "    return 1;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments repairs malformed optional @param defaults with trailing brackets", () => {
    const input = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=[CM.MASK]]]]]]]]]]]",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=collider[CM.MASK]]",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments repairs malformed optional @param defaults while preserving descriptions", () => {
    const input = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=[CM.MASK]]]]]]]]]]] Optional collision mask override",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=collider[CM.MASK]] Optional collision mask override",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments normalizes malformed csv docs while preserving parameter descriptions", () => {
    const input = [
        "// / Decodes an CSV string and outputs a 2D array",
        "// /",
        "/// @returns 2D array that represents the contents of the CSV string",
        "// /",
        "// / @param string              The CSV string to be decoded",
        "/// @param [cellDelimiter]     Character to use to indicate where cells start and end. First 127 ASCII chars only. Defaults to a comma",
        "/// @param [stringDelimiter]   Character to use to indicate where strings start and end. First 127 ASCII chars only. Defaults to a double quote",
        "// /",
        "/// @jujuadams 2020-06-28",
        "",
        String.raw`function __input_csv_to_array(_csv_string, _cell_delimiter = ",", _string_delimiter = "\"") {`,
        "    // ...",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @description Decodes an CSV string and outputs a 2D array",
        "/// @jujuadams 2020-06-28",
        "/// @param csv_string The CSV string to be decoded",
        '/// @param [cell_delimiter=","] Character to use to indicate where cells start and end. First 127 ASCII chars only. Defaults to a comma',
        String.raw`/// @param [string_delimiter="\""] Character to use to indicate where strings start and end. First 127 ASCII chars only. Defaults to a double quote`,
        "/// @returns 2D array that represents the contents of the CSV string",
        String.raw`function __input_csv_to_array(_csv_string, _cell_delimiter = ",", _string_delimiter = "\"") {`,
        "    // ...",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments converts legacy returns description text to @returns metadata", () => {
    const input = [
        "/// Summary",
        "/// Returns: Boolean, indicating if check passed",
        "function demo() {",
        "    return true;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @description Summary",
        "/// @returns {Boolean} Indicating if check passed",
        "function demo() {",
        "    return true;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments repairs malformed optional @param defaults while preserving descriptions", () => {
    const input = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=[CM.MASK]]]]]]]]]]] Optional collision mask override",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @param cylinder",
        "/// @param collider",
        "/// @param [mask=collider[CM.MASK]] Optional collision mask override",
        "/// @returns {any}",
        "function cm_cylinder_check(cylinder, collider, mask = collider[CM.MASK]) {",
        "    return mask;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments normalizes malformed csv docs while preserving parameter descriptions", () => {
    const input = [
        "// / Decodes an CSV string and outputs a 2D array",
        "// /",
        "/// @returns 2D array that represents the contents of the CSV string",
        "// /",
        "// / @param string              The CSV string to be decoded",
        "/// @param [cellDelimiter]     Character to use to indicate where cells start and end. First 127 ASCII chars only. Defaults to a comma",
        "/// @param [stringDelimiter]   Character to use to indicate where strings start and end. First 127 ASCII chars only. Defaults to a double quote",
        "// /",
        "/// @jujuadams 2020-06-28",
        "",
        String.raw`function __input_csv_to_array(_csv_string, _cell_delimiter = ",", _string_delimiter = "\"") {`,
        "    // ...",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @description Decodes an CSV string and outputs a 2D array",
        "/// @jujuadams 2020-06-28",
        "/// @param csv_string The CSV string to be decoded",
        '/// @param [cell_delimiter=","] Character to use to indicate where cells start and end. First 127 ASCII chars only. Defaults to a comma',
        String.raw`/// @param [string_delimiter="\""] Character to use to indicate where strings start and end. First 127 ASCII chars only. Defaults to a double quote`,
        "/// @returns 2D array that represents the contents of the CSV string",
        String.raw`function __input_csv_to_array(_csv_string, _cell_delimiter = ",", _string_delimiter = "\"") {`,
        "    // ...",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments converts legacy returns description text to @returns metadata", () => {
    const input = [
        "/// Summary",
        "/// Returns: Boolean, indicating if check passed",
        "function demo() {",
        "    return true;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @description Summary",
        "/// @returns {Boolean} Indicating if check passed",
        "function demo() {",
        "    return true;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments synthesizes concrete and undefined @returns metadata", () => {
    const input = [
        "function no_return() {",
        "    var x = 1;",
        "}",
        "",
        "function returns_value() {",
        "    return 123;",
        "}",
        "",
        "function returns_undefined_only() {",
        "    if (keyboard_check(vk_space)) {",
        "        return undefined;",
        "    }",
        "    return;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "/// @returns {undefined}",
        "function no_return() {",
        "    var x = 1;",
        "}",
        "",
        "/// @returns {real}",
        "function returns_value() {",
        "    return 123;",
        "}",
        "",
        "/// @returns {undefined}",
        "function returns_undefined_only() {",
        "    if (keyboard_check(vk_space)) {",
        "        return undefined;",
        "    }",
        "    return;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments does not synthesize @returns for constructor declarations", () => {
    const input = ["function __ChatterboxBufferBatch(_buffer) constructor {", "    buffer = _buffer;", "}", ""].join(
        "\n"
    );
    const expected = [
        "/// @param buffer",
        "function __ChatterboxBufferBatch(_buffer) constructor {",
        "    buffer = _buffer;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments does not synthesize @returns for constructor assignments", () => {
    const input = ["item = function () constructor {", "    value = 1;", "};", ""].join("\n");
    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, input);
});

void test("normalize-doc-comments removes existing @returns for constructor assignments", () => {
    const input = ["/// @returns {undefined}", "item = function () constructor {", "    value = 1;", "};", ""].join(
        "\n"
    );
    const expected = ["item = function () constructor {", "    value = 1;", "};", ""].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments skips synthetic docs for inline struct property function values", () => {
    const input = [
        "/// @returns {undefined}",
        "function configure_editor_state() {",
        "    editor_state",
        '        .add("edit", {',
        "            leave: function() {",
        "                instance_destroy(oEditor);",
        "            }",
        "        })",
        '        .add("follow", {',
        "            enter: function() {},",
        "            step: function() {",
        "                if (follow_id < 0) {",
        "                    if (instance_exists(oPlayer)) {",
        "                        follow_id = oPlayer.id;",
        "                    }",
        "                }",
        "            }",
        "        });",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, input);
});

void test("normalize-doc-comments skips synthetic docs for anonymous inline callback arguments", () => {
    const input = [
        "call_later(",
        "    1800,",
        "    time_source_units_frames,",
        "    function() {",
        '        gml_pragma("forceinline");',
        "        if (!(global.camera.is_in_view(x, y, z))) {",
        "            instance_destroy();",
        "        }",
        "    },",
        "    true",
        ");",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, input);
    assert.doesNotMatch(result.output, /^\/\/\/ @description\b/m);
    assert.doesNotMatch(result.output, /^\/\/\/ @returns\b/m);
});

void test("normalize-directives preserves spacing and semicolons on canonical #macro lines", () => {
    const input = [
        "#macro __SCRIBBLE_PARSER_INSERT_NUKTA  ds_grid_set_grid_region(_temp_grid, _glyph_grid, _i+1, 0, _glyph_count+3, __SCRIBBLE_GEN_GLYPH.__SIZE, 0, 0);",
        "#macro KEEP_MACRO_SEMICOLON value;",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-directives", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("gml semantic fix rules do not reformat canonical macro declaration spacing", () => {
    const input =
        "#macro __SCRIBBLE_PARSER_INSERT_NUKTA  ds_grid_set_grid_region(_temp_grid, _glyph_grid, _i+1, 0, _glyph_count+3, __SCRIBBLE_GEN_GLYPH.__SIZE, 0, 0);\n";
    const semanticFixRuleNames = [
        "prefer-hoistable-loop-accessors",
        "prefer-loop-invariant-expressions",
        "prefer-repeat-loops",
        "prefer-struct-literal-assignments",
        "prefer-compound-assignments",
        "prefer-direct-return",
        "optimize-logical-flow",
        "normalize-doc-comments",
        "normalize-directives",
        "no-empty-regions",
        "no-unnecessary-string-interpolation",
        "remove-default-comments",
        "require-control-flow-braces",
        "no-assignment-in-condition",
        "prefer-is-undefined-check",
        "prefer-epsilon-comparisons",
        "normalize-operator-aliases",
        "prefer-string-interpolation",
        "optimize-math-expressions",
        "require-argument-separators",
        "normalize-data-structure-accessors",
        "require-trailing-optional-defaults"
    ] as const;

    for (const ruleName of semanticFixRuleNames) {
        const result = lintWithRule(ruleName, input, {});
        assertEquals(result.output, input, `${ruleName} should not apply formatter-owned macro spacing changes`);
    }
});

void test("normalize-data-structure-accessors only rewrites invalid multi-coordinate access to grid accessors", () => {
    const input = [
        "var my_map = ds_map_create();",
        'var value = my_map[| "key"];',
        "var item = lst_items[? 0];",
        "var cell = level_grid[| 1, 2];",
        "var cell_alt = myGrid[? 1, 2];",
        "var passthrough = some_var[? 0];",
        "var item_alt = map_items[| 0];",
        ""
    ].join("\n");
    const expected = [
        "var my_map = ds_map_create();",
        'var value = my_map[? "key"];',
        "var item = lst_items[? 0];",
        "var cell = level_grid[# 1, 2];",
        "var cell_alt = myGrid[# 1, 2];",
        "var passthrough = some_var[? 0];",
        "var item_alt = map_items[| 0];",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-data-structure-accessors", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-data-structure-accessors does not keep stale constructor inference after reassignment", () => {
    const input = ["var my_map = ds_map_create();", "my_map = some_var;", 'var value = my_map[| "key"];', ""].join(
        "\n"
    );

    const result = lintWithRule("normalize-data-structure-accessors", input, {});
    assertEquals(result.output, input);
});

void test("normalize-data-structure-accessors ignores malformed identifier metadata without throwing", () => {
    const sourceText = 'var value = my_map[| "key"];\n';
    const messages: Array<{ messageId: string }> = [];
    const rule = Lint.plugin.rules["normalize-data-structure-accessors"];

    const context = {
        options: [{}],
        sourceCode: { text: sourceText },
        report(descriptor: { messageId: string }) {
            messages.push({ messageId: descriptor.messageId });
        }
    };

    const visitor = rule.create(context as never);
    const programNode = {
        type: "Program",
        start: 0,
        end: sourceText.length,
        body: [
            {
                type: "VariableDeclarator",
                start: 0,
                end: 8,
                id: {
                    type: "Identifier",
                    name: 123,
                    start: 0,
                    end: 3
                },
                init: {
                    type: "CallExpression",
                    start: 0,
                    end: 8,
                    object: {
                        type: "Identifier",
                        name: "ds_map_create",
                        start: 0,
                        end: 13
                    },
                    arguments: []
                }
            },
            {
                type: "MemberIndexExpression",
                accessor: "[|",
                start: 12,
                end: sourceText.length - 1,
                object: {
                    type: "Identifier",
                    name: "my_map",
                    start: 12,
                    end: 18
                },
                property: [
                    {
                        type: "Literal",
                        value: '"key"',
                        start: 21,
                        end: 26
                    }
                ]
            }
        ]
    };

    assert.doesNotThrow(() => visitor.Program?.(programNode as never));
    assertEquals(messages.length, 0);
});

void test("require-argument-separators preserves separator payload comments", () => {
    const input = "show_debug_message_ext(name /* keep */ payload);\n";
    const result = lintWithRule("require-argument-separators", input, {});
    assertEquals(result.output, "show_debug_message_ext(name, /* keep */ payload);\n");
});

void test("require-trailing-optional-defaults lifts leading argument_count ternary fallbacks into params", () => {
    const input = [
        "function greet() {",
        '    var name = argument_count > 0 ? argument[0] : "friend";',
        '    var greeting = argument_count > 1 ? argument[1] : "Hello";',
        '    return $"{greeting}, {name}";',
        "}",
        ""
    ].join("\n");
    const expected = input;

    const result = lintWithRule("require-trailing-optional-defaults", input, {});
    assertEquals(result.output, expected);
});

void test("require-trailing-optional-defaults condenses var+if argument_count fallback and adds trailing params", () => {
    const input = [
        "function spring(a, b, dst, force) {",
        "    var push_out = true;",
        "    if (argument_count > 4) {",
        "        push_out = argument[4];",
        "    }",
        "    return push_out;",
        "}",
        "",
        "my_func4(undefined, undefined);",
        ""
    ].join("\n");
    const expected = [
        "function spring(a, b, dst, force) {",
        "    var push_out = true;",
        "    if (argument_count > 4) {",
        "        push_out = argument[4];",
        "    }",
        "    return push_out;",
        "}",
        "",
        "my_func4(undefined);",
        ""
    ].join("\n");

    const result = lintWithRule("require-trailing-optional-defaults", input, {});
    assertEquals(result.output, expected);
});

void test("require-trailing-optional-defaults appends undefined defaults after existing optional params", () => {
    const input = ["function demo(first, second = 1, third) {", "    return [first, second, third];", "}", ""].join(
        "\n"
    );
    const expected = [
        "function demo(first, second = 1, third = undefined) {",
        "    return [first, second, third];",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("require-trailing-optional-defaults", input, {});
    assertEquals(result.output, expected);
});

void test("reportUnsafe=false suppresses unsafe-only diagnostics", () => {
    const input = 'message = "HP: " + string(_i++);\n';
    const result = lintWithRule("prefer-string-interpolation", input, { reportUnsafe: false });
    assertEquals(result.messages.length, 0);
});

void test("no-unnecessary-string-interpolation rewrites template strings without interpolation atoms", () => {
    const input = [
        "function create_fx() {",
        '    return instance_create_layer(x, y, $"instances", obj_fx);',
        "}",
        ""
    ].join("\n");
    const expected = [
        "function create_fx() {",
        '    return instance_create_layer(x, y, "instances", obj_fx);',
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("no-unnecessary-string-interpolation", input, {});
    assertEquals(result.output, expected);
});

void test("no-unnecessary-string-interpolation keeps interpolated template strings unchanged", () => {
    const input = 'message = $"instances are: {myInstances}";\n';
    const result = lintWithRule("no-unnecessary-string-interpolation", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("prefer-string-interpolation rewrites string literal + string(variable) chains", () => {
    const input = [
        "for (var _i = vk_f1 + 12; _i < vk_f1 + 32; _i++) {",
        '    __input_key_name_set(_i, "f" + string(_i));',
        "}",
        ""
    ].join("\n");
    const expected = [
        "for (var _i = vk_f1 + 12; _i < vk_f1 + 32; _i++) {",
        '    __input_key_name_set(_i, $"f{_i}");',
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-string-interpolation rewrites string coercion calls with non-trivial expressions", () => {
    const input = 'message = "HP: " + string(random(99));\n';
    const expected = 'message = $"HP: {random(99)}";\n';
    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-string-interpolation keeps full owner expressions for array access string coercions", () => {
    const input =
        'dump += "\\n  flat_player_render_mode: " + string(flat_player_render_mode[@ flat_player_render_mode]) + ",";\n';
    const expected =
        'dump += $"\\n  flat_player_render_mode: {flat_player_render_mode[@ flat_player_render_mode]},";\n';
    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-string-interpolation keeps full owner expressions for member access string coercions", () => {
    const input = 'dump += "pos=[" + string(player_pos.x) + "," + string(player_pos.y) + "]";\n';
    const expected = 'dump += $"pos=[{player_pos.x},{player_pos.y}]";\n';
    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-string-interpolation keeps full owner expressions for direct member concatenations", () => {
    const input =
        'dump += "\\n  flat_player_render_mode: " + flat_player_render_mode_names[@ flat_player_render_mode] + ",";\n';
    const expected =
        'dump += $"\\n  flat_player_render_mode: {flat_player_render_mode_names[@ flat_player_render_mode]},";\n';
    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-string-interpolation rewrites nested concatenation chains with a single diagnostic", () => {
    const input = 'message = ("HP: " + value) + " / 99";\n';
    const expected = 'message = $"HP: {value} / 99";\n';
    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-string-interpolation flattens nested parenthesized string chains", () => {
    const input = '__ChatterboxCompile(_substring_array, root_instruction, ((filename + ":") + title) + ":#");\n';
    const expected = '__ChatterboxCompile(_substring_array, root_instruction, $"{filename}: {title}:#");\n';
    const result = lintWithRule("prefer-string-interpolation", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("prefer-is-undefined-check rewrites undefined comparisons in either operand position", () => {
    const input = [
        "if (score == undefined) return;",
        "if (undefined == lives) return;",
        "if (score != undefined) return;",
        "if (undefined != lives) return;",
        "if (!(score == undefined)) return;",
        "if (!(undefined == lives)) return;",
        ""
    ].join("\n");
    const expected = [
        "if (is_undefined(score)) return;",
        "if (is_undefined(lives)) return;",
        "if (!is_undefined(score)) return;",
        "if (!is_undefined(lives)) return;",
        "if (!is_undefined(score)) return;",
        "if (!is_undefined(lives)) return;",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-is-undefined-check", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-is-undefined-check preserves grouped multiline conditions", () => {
    const input = [
        "if ((_index == undefined)",
        "||  (_index < 0)",
        "||  (_index >= array_length(_global.__gamepads)))",
        "{",
        "    return;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "if ((is_undefined(_index))",
        "||  (_index < 0)",
        "||  (_index >= array_length(_global.__gamepads)))",
        "{",
        "    return;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-is-undefined-check", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-epsilon-comparisons rewrites direct zero checks for preceding math assignments", () => {
    const input = [
        "var actual_dist = sqr(xoff) + sqr(yoff);",
        "if (actual_dist == 0) {",
        "    return false;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var actual_dist = sqr(xoff) + sqr(yoff);",
        "var eps = math_get_epsilon();",
        "if (actual_dist <= eps) {",
        "    return false;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-epsilon-comparisons", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-epsilon-comparisons does not rewrite non-math zero checks", () => {
    const input = ["var queue_size = array_length(queue);", "if (queue_size == 0) {", "    return;", "}", ""].join(
        "\n"
    );

    const result = lintWithRule("prefer-epsilon-comparisons", input, {});
    assertEquals(result.output, input);
});

void test("prefer-epsilon-comparisons reuses existing epsilon declarations in a block", () => {
    const input = [
        "var actual_dist = sqr(xoff) + sqr(yoff);",
        "var eps = math_get_epsilon();",
        "if (actual_dist == 0) {",
        "    return false;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var actual_dist = sqr(xoff) + sqr(yoff);",
        "var eps = math_get_epsilon();",
        "if (actual_dist <= eps) {",
        "    return false;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-epsilon-comparisons", input, {});
    assertEquals(result.output, expected);
});

void test("prefer-epsilon-comparisons rewrites positive zero checks for math-sensitive variables", () => {
    const input = [
        "var m = dot_product_3d(mx, my, mz, mx, my, mz);",
        "if (m > 0) {",
        "    m = intersectionRadius / sqrt(m);",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var m = dot_product_3d(mx, my, mz, mx, my, mz);",
        "if (m > math_get_epsilon()) {",
        "    m = intersectionRadius / sqrt(m);",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-epsilon-comparisons", input, {});
    assertEquals(result.output, expected);
});

void test("no-assignment-in-condition does not rewrite grouped multiline conditions without assignments", () => {
    const input = [
        "if ((_index == undefined)",
        "||  (_index < 0)",
        "||  (_index >= array_length(_global.__gamepads)))",
        "{",
        "    return;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("no-assignment-in-condition", input, {});
    assertEquals(result.output, input);
});

void test("no-globalvar diagnoses declared globals", () => {
    const input = [
        "globalvar score;",
        "",
        "if (should_exit()) return;",
        "",
        "globalvar doExit;",
        "if (doExit == global.exitState) {",
        "    exit;",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("no-globalvar", input, {});
    assertEquals(result.messages.length > 0, true);
    assertEquals(result.output, input);
});

void test("no-globalvar diagnoses comma-separated declarations without rewriting source", () => {
    const input = ["globalvar score, lives;", "score = 1;", "if (lives > 0) {", "    score += lives;", "}", ""].join(
        "\n"
    );

    const result = lintWithRule("no-globalvar", input, {});
    assertEquals(result.messages.length > 0, true);
    assertEquals(result.output, input);
});

void test("no-globalvar diagnoses comma-separated declarations", () => {
    const input = ["globalvar score, lives;", "score = 1;", "if (lives > 0) {", "    score += lives;", "}", ""].join(
        "\n"
    );

    const result = lintWithRule("no-globalvar", input, {});
    assertEquals(result.messages.length > 0, true);
    assertEquals(result.output, input);
});

void test("prefer-hoistable-loop-accessors respects null suffix override by disabling loop-test diagnostics", () => {
    const inputAndFixed = [
        "for (var i = 0; i < array_length(items); i++) {",
        "    sum += array_length(items);",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("prefer-hoistable-loop-accessors", inputAndFixed, {
        functionSuffixes: {
            array_length: null
        }
    });
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, inputAndFixed);
});

void test("prefer-hoistable-loop-accessors is diagnostic-only and leaves source unchanged", () => {
    const input = ["for (var i = 0; i < array_length(items); i++) {", "    sum += array_length(items);", "}", ""].join(
        "\n"
    );
    const result = lintWithRule("prefer-hoistable-loop-accessors", input, {});
    assertEquals(result.messages.length > 0, true);
    assertEquals(result.output, input);
});

void test("prefer-repeat-loops skips conversion when loop iterator is used in body", () => {
    const input = ["for (var i = 0; i < array_length(items); i++) {", "    sum += i;", "}", ""].join("\n");
    const result = lintWithRule("prefer-repeat-loops", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("full-file rewrite rules report the first changed source location", () => {
    const locationCases = [
        {
            ruleName: "normalize-doc-comments",
            input: ["var keep = 1;", "// @description convert me", "function demo() {}", ""].join("\n"),
            expectedLoc: { line: 2, column: 2 }
        },
        {
            ruleName: "normalize-directives",
            input: ["var keep = 1;", "// #region Setup", ""].join("\n"),
            expectedLoc: { line: 2, column: 0 }
        },
        {
            ruleName: "no-empty-regions",
            input: ["var keep = 1;", "#region Setup", "#endregion", ""].join("\n"),
            expectedLoc: { line: 2, column: 0 }
        },
        {
            ruleName: "remove-default-comments",
            input: ["var keep = 1;", "// Script assets have changed for v2.3.0 see", "function demo() {}", ""].join(
                "\n"
            ),
            expectedLoc: { line: 2, column: 0 }
        },
        {
            ruleName: "no-assignment-in-condition",
            input: ["var keep = 1;", "if (left = right) value = 1;", ""].join("\n"),
            expectedLoc: { line: 2, column: 10 }
        },
        {
            ruleName: "normalize-operator-aliases",
            input: ["var keep = 1;", "if (not right) {", "    keep = 2;", "}", ""].join("\n"),
            expectedLoc: { line: 2, column: 4 }
        }
    ] as const;

    for (const locationCase of locationCases) {
        const result = lintWithRule(locationCase.ruleName, locationCase.input, {});
        assertEquals(result.messages.length, 1, `${locationCase.ruleName} should report exactly one diagnostic`);
        assert.deepEqual(
            result.messages[0]?.loc,
            locationCase.expectedLoc,
            `${locationCase.ruleName} should report its first changed location`
        );
    }
});

void test("prefer-hoistable-loop-accessors reports the first matching accessor location", () => {
    const input = [
        "#macro STILE_PLATFORM_HEIGHT 120",
        "",
        "function demo(items) {",
        "    while (ready) {",
        "        var total = array_length(items);",
        "        total += array_length(items);",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-hoistable-loop-accessors", input);
    assertEquals(result.messages.length, 1);
    assert.deepEqual(result.messages[0]?.loc, { line: 5, column: 20 });
});

void test("prefer-hoistable-loop-accessors reports loop-test accessor scenarios previously covered by prefer-loop-length-hoist", () => {
    const input = ["for (var i = 0; i < array_length(items); i++) {", "    sum += array_length(items);", "}", ""].join(
        "\n"
    );

    const result = lintWithRule("prefer-hoistable-loop-accessors", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0]?.messageId, "preferHoistableLoopAccessor");
});

void test("prefer-hoistable-loop-accessors reports unsafeFix when insertion requires brace synthesis", () => {
    const input = [
        "if (ready)",
        "    for (var i = 0; i < array_length(items); i++) {",
        "        sum += 1;",
        "    }",
        ""
    ].join("\n");

    const result = lintWithRule("prefer-hoistable-loop-accessors", input, {});
    assertEquals(
        result.messages.some((message) => message.messageId === "preferHoistableLoopAccessor"),
        true
    );
    assertEquals(
        result.messages.some((message) => message.messageId === "unsafeFix"),
        true
    );
    assertEquals(result.output, input);
});

void test("require-control-flow-braces does not rewrite multiline condition continuations", () => {
    const input = [
        "if (p.DistanceTo(vertices[0][0].p) < self.vertLength * 1.5)",
        "|| (p.DistanceTo(vertices[1][0].p) < self.vertLength * 1.5)",
        "{",
        "    __addVert(vertices[0]);",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("require-control-flow-braces keeps else-if chains intact when the branch statement is on the next line", () => {
    const input = ["if (x) {", "    a();", "}", "else if (_prev_char == 0x093C) ", "    b();", ""].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, input);
    assert.deepEqual(result.messages[0]?.loc, { line: 5, column: 4 });
});

void test("require-control-flow-braces reports inline statements with nested call parentheses safely", () => {
    const input = String.raw`if (_starting_font == undefined) __scribble_error("The default font has not been set\nCheck that you've added fonts to Scribble (scribble_font_add() / scribble_font_add_from_sprite() etc.)");
`;
    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(
        result.output,
        String.raw`if (_starting_font == undefined) { __scribble_error("The default font has not been set\nCheck that you've added fonts to Scribble (scribble_font_add() / scribble_font_add_from_sprite() etc.)"); }
`
    );
    assert.deepEqual(result.messages[0]?.loc, { line: 1, column: 33 });
});

void test("require-control-flow-braces reports inline while/for/with statements", () => {
    const input = ["while (alive) tick();", "for (var i = 0; i < 10; i++) sum += i;", "with (other) hp -= 1;", ""].join(
        "\n"
    );

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 3);
    assertEquals(
        result.output,
        [
            "while (alive) { tick(); }",
            "for (var i = 0; i < 10; i++) { sum += i; }",
            "with (other) { hp -= 1; }",
            ""
        ].join("\n")
    );
    assert.deepEqual(
        result.messages.map((message) => message.loc),
        [
            { line: 1, column: 14 },
            { line: 2, column: 29 },
            { line: 3, column: 13 }
        ]
    );
});

void test("require-control-flow-braces reports line-only else branches without rewriting else-if chains", () => {
    const input = ["if (a > b)", '    draw_text(x, y, "ok");', "else", "    do_other();", ""].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 2);
    assertEquals(
        result.output,
        ["if (a > b)", '    { draw_text(x, y, "ok"); }', "else", "    { do_other(); }", ""].join("\n")
    );
    assert.deepEqual(
        result.messages.map((message) => message.loc),
        [
            { line: 2, column: 4 },
            { line: 4, column: 4 }
        ]
    );
});

void test("require-control-flow-braces reports inline do-until clauses", () => {
    const input = ["do step(); until (done);", ""].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, ["do { step(); } until (done);", ""].join("\n"));
    assert.deepEqual(result.messages[0]?.loc, { line: 1, column: 3 });
});

void test("require-control-flow-braces preserves already braced inline conditions with nested call parentheses", () => {
    const input = [
        "while (keyboard_check(vk_space)) { hold_jump(); }",
        "if (keyboard_check(vk_escape)) { x += 10; } else { x -= 10; }",
        ""
    ].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("require-control-flow-braces reports repeat statements with nested index expressions safely", () => {
    const input = 'repeat(_tag_parameter_count-1) _command_string += "," + string(_tag_parameters[_j++]);\n';
    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(
        result.output,
        'repeat(_tag_parameter_count-1) { _command_string += "," + string(_tag_parameters[_j++]); }\n'
    );
    assert.deepEqual(result.messages[0]?.loc, { line: 1, column: 31 });
});

void test("optimize-math-expressions skips formatting-only rewrites for decimal literals that already start with zero", () => {
    const input = "__fit_scale = _lower_limit + 0.5*(_upper_limit - _lower_limit);\n";
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-math-expressions does not rewrite decimal literals with missing leading/trailing zeros", () => {
    // Adding leading/trailing zeros to these literals is strictly a formatting change, and owned exclusively by the formatter ('@gmloop/format')
    // However, when a math-optimization condenses an expression containing two or more of these literals into a single literal, the resulting literal
    // is expected to be a normalized form that the formatter would produce, to avoid unnecessary churn from subsequent formatter rewrites
    const input = ["var a = .5;", "var b = 1. - .5;", "var c = 5.;", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-math-expressions folds lengthdir_x half-subtraction pattern into a single initializer", () => {
    const input = ["var s = 1.3 * size * 0.12 / 1.5;", "s = s - s / 2 - lengthdir_x(s / 2, swim_rot);", ""].join("\n");
    const expected = ["var s = size * 0.104;", "s = s * 0.5 * (1 - lengthdir_x(1, swim_rot));", ""].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions does not force the lengthdir half-difference canonicalization on unrelated subtraction patterns", () => {
    const input = ["var s = size * 0.104;", "s = s * 0.5 - lengthdir_x(1, swim_rot);", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, input);
});

void test("optimize-math-expressions keeps non-math expressions unchanged", () => {
    const input = "var config = settings ?? global.default_settings;\n";
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-math-expressions rewrites reciprocal ratios and removes *= 1 statements", () => {
    const input = ["var s7 = ((hp / max_hp) * 100) / 10;", "var s37b = 1 * width;", "s37b *= 1;", ""].join("\n");
    const expected = ["var s7 = (hp / max_hp) * 10;", "var s37b = width;", ""].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions does not cancel reciprocal call pairs that may carry side effects", () => {
    const input = "result = update() * (1 / update());\n";
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, input);
});

void test("optimize-math-expressions keeps denominators inside nested log2 calls", () => {
    const input = "oct_size = minregionsize * power(2, ceil(log2(obj_size / minregionsize)));\n";
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, input);
});

void test("optimize-math-expressions rewrites nested call-argument expressions without relying on nested duplicate passes", () => {
    const input = "var draw_value = draw_text_ext((width * width), 0, 0);\n";
    const expected = "var draw_value = draw_text_ext(sqr(width), 0, 0);\n";

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions auto-fixes manual math forms to built-in helpers", () => {
    const input = [
        "var squared = value * value;",
        "var cubed = value * value * value;",
        "var quartic = value * value * value * value;",
        "var sqrtManual = power(length, 0.5);",
        "var sqrtFromPower = power(distance, 0.5);",
        "var logTwo = ln(amount) / ln(2);",
        "var expManual = power(2.718281828459045, factor);",
        "var meanDivision = (alpha + beta) / 2;",
        "var meanMultiply = (first + second) * 0.5;",
        "var dot2 = (ax * bx) + (ay * by);",
        "var dot2Flat = ax * bx + ay * by;",
        "var dot3 = (ax * bx) + (ay * by) + (az * bz);",
        "var distance = sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));",
        "var distancePower = power(",
        "    (x_end - x_start) * (x_end - x_start) + (y_end - y_start) * (y_end - y_start),",
        "    0.5",
        ");",
        "var distance3 = sqrt(",
        "    (x2 - x1) * (x2 - x1) +",
        "        (y2 - y1) * (y2 - y1) +",
        "        (z2 - z1) * (z2 - z1)",
        ");",
        "var direction = arctan2(y2 - y1, x2 - x1);",
        "var lenXDegrees = radius * dcos(direction);",
        "var lenYDegrees = -radius * dsin(direction);",
        "var lenXRadians = radius * cos(degtorad(direction));",
        "var lenYRadians = -radius * sin(degtorad(direction));",
        "var sinDegrees = sin(direction * pi / 180);",
        "var cosDegrees = cos((direction / 180) * pi);",
        "var tanDegrees = tan(direction * pi / 180);",
        "var radiansFromDegreeTrig = degtorad(darctan2(vy, vx));",
        "var degreesFromRadianTrig = radtodeg(arctan2(vy, vx));",
        "var unchangedCall = update() * update();",
        "var squaredVals = value * value;",
        "var commented = value /* keep */ * value;",
        ""
    ].join("\n");
    const expected = [
        "var squared = sqr(value);",
        "var cubed = power(value, 3);",
        "var quartic = power(value, 4);",
        "var sqrtManual = sqrt(length);",
        "var sqrtFromPower = sqrt(distance);",
        "var logTwo = log2(amount);",
        "var expManual = exp(factor);",
        "var meanDivision = mean(alpha, beta);",
        "var meanMultiply = mean(first, second);",
        "var dot2 = dot_product(ax, ay, bx, by);",
        "var dot2Flat = dot_product(ax, ay, bx, by);",
        "var dot3 = dot_product_3d(ax, ay, az, bx, by, bz);",
        "var distance = point_distance(x1, y1, x2, y2);",
        "var distancePower = point_distance(x_start, y_start, x_end, y_end);",
        "var distance3 = point_distance_3d(x1, y1, z1, x2, y2, z2);",
        "var direction = point_direction(x1, y1, x2, y2);",
        "var lenXDegrees = lengthdir_x(radius, direction);",
        "var lenYDegrees = lengthdir_y(radius, direction);",
        "var lenXRadians = lengthdir_x(radius, direction);",
        "var lenYRadians = lengthdir_y(radius, direction);",
        "var sinDegrees = dsin(direction);",
        "var cosDegrees = dcos(direction);",
        "var tanDegrees = dtan(direction);",
        "var radiansFromDegreeTrig = arctan2(vy, vx);",
        "var degreesFromRadianTrig = darctan2(vy, vx);",
        "var unchangedCall = update() * update();",
        "var squaredVals = sqr(value);",
        "var commented = value /* keep */ * value;",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions rewrites uncommented math expressions and preserves trailing line comments", () => {
    const input = [
        "var squared = value * value; // keep trailing context",
        "var direction = arctan2(y2 - y1, x2 - x1); // preserve this note",
        ""
    ].join("\n");
    const expected = [
        "var squared = sqr(value); // keep trailing context",
        "var direction = point_direction(x1, y1, x2, y2); // preserve this note",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions simplifies trigonometric degree/radian wrapper pairs", () => {
    const input = [
        "var a = sin(degtorad(angle));",
        "var b = cos(degtorad(angle));",
        "var c = tan(degtorad(angle));",
        "var d = degtorad(dsin(angle));",
        "var e = degtorad(darctan2(vy, vx));",
        "var f = radtodeg(arctan2(vy, vx));",
        ""
    ].join("\n");
    const expected = [
        "var a = dsin(angle);",
        "var b = dcos(angle);",
        "var c = dtan(angle);",
        "var d = sin(angle);",
        "var e = arctan2(vy, vx);",
        "var f = darctan2(vy, vx);",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions handles extreme reciprocals", () => {
    const input = [
        "var tinyDivisor = value / 0.00000000001;",
        "var tinyMutiplier = value * 0.00000000001;",
        "var hugeReciprocal = value / (1 / 100000000000);",
        "var convertSafe = value / 4;",
        ""
    ].join("\n");
    const expected = [
        "var tinyDivisor = value * 100000000000;",
        "var tinyMutiplier = value * 0.00000000001;",
        "var hugeReciprocal = value * 100000000000;",
        "var convertSafe = value * 0.25;",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, expected);
});

void test("optimize-math-expressions does not rewrite expressions with inline block comments even with trailing line comments", () => {
    const input = ["var squared = value /* keep */ * value; // trailing note", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, input);
});

void test("optimize-math-expressions does not rewrite expressions with inline trailing-line comments between operands", () => {
    const input = ["var squared = value // keep", "    * value;", ""].join("\n");
    const result = lintWithRule("optimize-math-expressions", input, {});
    assertEquals(result.output, input);
});

void test("normalize-operator-aliases does not replace punctuation exclamation marks", () => {
    const input = ["#region Emergency!", "var ready_state = !ready;", ""].join("\n");
    const expected = ["#region Emergency!", "var ready_state = !ready;", ""].join("\n");
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-operator-aliases replaces invalid logical keyword 'not' with '!'", () => {
    const input = ["if (not ready) {", "    value = not extra;", "}", ""].join("\n");
    const expected = ["if (! ready) {", "    value = ! extra;", "}", ""].join("\n");
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-operator-aliases leaves uppercase binary aliases unchanged while fixing uppercase NOT", () => {
    const input = ["if (ready AND NOT done OR extra XOR flag) {", "    finish();", "}", ""].join("\n");
    const expected = ["if (ready AND ! done OR extra XOR flag) {", "    finish();", "}", ""].join("\n");
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-operator-aliases does not rewrite identifier usage of 'not'", () => {
    const input = ["var not = 1;", "value = not + 2;", ""].join("\n");
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("normalize-operator-aliases does not rewrite comment text containing 'not'", () => {
    const input = [
        '//Use "with" to avoid having to check if the player exists or not',
        "if (player_exists) {",
        "    value = 1;",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("normalize-operator-aliases rewrites code aliases without mutating comment or string content", () => {
    const input = [
        'var message = "not ready";',
        "/* not pending */",
        "if (not ready) {",
        "    // not should stay untouched in comments",
        "    value = not(extra);",
        "}",
        ""
    ].join("\n");
    const expected = [
        'var message = "not ready";',
        "/* not pending */",
        "if (! ready) {",
        "    // not should stay untouched in comments",
        "    value = !(extra);",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-operator-aliases does not rewrite escaped quote string content", () => {
    const input = '__input_error("State \\"", __state, "\\" not recognised");\n';
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("normalize-operator-aliases rewrites logical aliases without mutating identifiers that contain operator substrings", () => {
    const input = "var show_mode0_origin = flat_dbg_draw_mode0_origin or flat_dbg_compare_mode0_overlay;\n";
    const expected = "var show_mode0_origin = flat_dbg_draw_mode0_origin || flat_dbg_compare_mode0_overlay;\n";
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-operator-aliases keeps member identifiers intact while rewriting logical aliases", () => {
    const input =
        "player_intent.move_active = abs(player_intent.world.Magnitude2D()) > eps or abs(spd_hor.Magnitude2D()) > 2;\n";
    const expected =
        "player_intent.move_active = abs(player_intent.world.Magnitude2D()) > eps || abs(spd_hor.Magnitude2D()) > 2;\n";
    const result = lintWithRule("normalize-operator-aliases", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-operator-aliases reports from explicit locations when node loc metadata is absent", () => {
    const source = "if (left and right) {\n    value = 1;\n}\n";
    const operatorStart = source.indexOf("and");
    const operatorEnd = operatorStart + "and".length;
    const expressionStart = source.indexOf("left");
    const expressionEnd = source.indexOf("right") + "right".length;
    const getLocFromIndex = createLocResolver(source);
    const reports: Array<{ loc?: { line: number; column: number } }> = [];
    const rule = Lint.plugin.rules["normalize-operator-aliases"];
    const context = {
        sourceCode: {
            text: source,
            getLocFromIndex
        },
        report(payload: {
            loc?: { line: number; column: number };
            fix?: (fixer: {
                replaceTextRange(range: [number, number], text: string): ReplaceTextRangeFixOperation;
            }) => ReplaceTextRangeFixOperation | null;
        }) {
            reports.push({ loc: payload.loc });
            if (payload.fix) {
                payload.fix({
                    replaceTextRange(range: [number, number], text: string): ReplaceTextRangeFixOperation {
                        return { kind: "replace", range, text };
                    }
                });
            }
        }
    } as never;
    const listeners = rule.create(context) as Record<string, (node: unknown) => void>;
    listeners.BinaryExpression?.({
        type: "BinaryExpression",
        operator: "and",
        start: { index: expressionStart },
        end: { index: expressionEnd },
        left: {
            type: "Identifier",
            name: "left",
            start: { index: expressionStart },
            end: { index: expressionStart + "left".length }
        },
        right: {
            type: "Identifier",
            name: "right",
            start: { index: source.indexOf("right") },
            end: { index: source.indexOf("right") + "right".length }
        }
    });

    assertEquals(reports.length, 1);
    assert.deepEqual(reports[0]?.loc, getLocFromIndex(operatorStart));
    assert.notDeepEqual(reports[0]?.loc, getLocFromIndex(expressionStart));
    assertEquals(operatorEnd > operatorStart, true);
});

void test("require-control-flow-braces skips macro continuation blocks", () => {
    const input = [
        '#macro __SCRIBBLE_MARKDOWN_TOGGLE_BOLD  if (_new_style == "body")\\',
        "                                        {\\",
        '                                            _new_style = "bold";\\',
        "                                        }\\",
        "                                        if (_old_style != _new_style) _write_style = true;",
        ""
    ].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("require-control-flow-braces does not reinterpret already braced headers with trailing comments", () => {
    const input = [
        "if (point_in_triangle(D.x, D.y, A.x, A.y, B.x, B.y, C.x, C.y)) { // stile_point_in_triangle(x3, y3, z3, x0, y0, z0, x1, y1, z1, x2, y2, z2, N)",
        '    // show_debug_message("Verts inside");',
        "    good = false;",
        "    break;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("require-control-flow-braces preserves already braced single-line repeat bodies", () => {
    const input = ["repeat (3) { already_repeat_braced(); }", ""].join("\n");

    const result = lintWithRule("require-control-flow-braces", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-logical-flow collapses boolean passthrough if/return patterns", () => {
    const input = [
        "function bool_passthrough(condition) {",
        "    if (!!condition) {",
        "        return true;",
        "    }",
        "",
        "    return false;",
        "}",
        ""
    ].join("\n");

    const expected = ["function bool_passthrough(condition) {", "    return condition;", "}", ""].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});
    assert.ok(result.messages.length > 0, "optimize-logical-flow should report diagnostics");
    assertEquals(
        result.output,
        expected,
        "optimize-logical-flow should reduce a boolean passthrough branch to a direct return"
    );
});

void test("optimize-logical-flow rewrites both undefined guard forms to ??=", () => {
    const input = [
        "function ensure_cache(cache_entry) {",
        "    if (is_undefined(cache_entry)) {",
        "        cache_entry = ds_map_create();",
        "    }",
        "",
        "    if (cache_entry == undefined) {",
        "        cache_entry = ds_map_create();",
        "    }",
        "}",
        ""
    ].join("\n");

    const expected = [
        "function ensure_cache(cache_entry) {",
        "    cache_entry ??= ds_map_create();",
        "",
        "    cache_entry ??= ds_map_create();",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});
    assert.ok(result.messages.length > 0, "optimize-logical-flow should report diagnostics");
    assertEquals(result.output, expected);
});

void test("optimize-logical-flow simplifies boolean literal comparisons in if conditions", () => {
    const input = [
        "if (xinput == true) { return move_horizontal(); }",
        "if (xinput != false) { return move_horizontal(); }",
        "if (yinput == false) { return move_vertical(); }",
        "if (yinput != true) { return move_vertical(); }",
        ""
    ].join("\n");

    const expected = [
        "if (xinput) { return move_horizontal(); }",
        "if (xinput) { return move_horizontal(); }",
        "if (!yinput) { return move_vertical(); }",
        "if (!yinput) { return move_vertical(); }",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});
    assert.ok(result.messages.length > 0, "optimize-logical-flow should report diagnostics");
    assertEquals(result.output, expected);
});

void test("optimize-logical-flow does not rewrite unchanged struct accessor conditions", () => {
    const input = ["if (!_player_verb_struct[$ _verb_array[_i]].held) {", "    return;", "}", ""].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-logical-flow handles parenthesized logical operands without crashing", () => {
    const input = ["function compare_ranges(a, b, c, d) {", "    return (a > b) || (c < d);", "}", ""].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-logical-flow preserves else-if assignment chains", () => {
    const input = [
        "function detect_pad_type(vendor, product, description) {",
        '    if (vendor == "aaa") {',
        '        raw_type = "A";',
        '    } else if (product == "bbb") {',
        '        raw_type = "B";',
        '    } else if (description == "ccc") {',
        '        raw_type = "C";',
        "    } else {",
        '        raw_type = "Unknown";',
        "    }",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});

    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("optimize-logical-flow parenthesizes nested ternary consequents in autofix output", () => {
    const input = [
        "function build_values(value1, value2, value3, value4) {",
        "    if (ready == true) {",
        "        ready = true;",
        "    }",
        "",
        "    if (!is_undefined(value2)) {",
        "        value = (!is_undefined(value3) ? (!is_undefined(value4) ? [value1, value2, value3, value4] : [value1, value2, value3]) : [value1, value2]);",
        "    } else {",
        "        value = [value1];",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("optimize-logical-flow", input, {});

    assert.ok(result.messages.length > 0, "optimize-logical-flow should report diagnostics");
    assert.ok(
        result.output.includes("? (!is_undefined(value4) ?"),
        "Expected nested ternary in the true branch to be wrapped in parentheses."
    );
    assertEquals(
        result.output.includes("? !is_undefined(value4) ?"),
        false,
        "Expected autofix output to avoid malformed nested ternary syntax."
    );
});

void test("no-unary-plus-on-identifier autofixes +identifier to bare identifier", () => {
    const input = "var value = +count;\n";
    const expected = "var value = count;\n";

    const result = lintWithRule("no-unary-plus-on-identifier", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0]?.messageId, "noUnaryPlusOnIdentifier");
    assertEquals(result.output, expected);
});

void test("no-unary-plus-on-identifier handles multiple unary plus usages in one file", () => {
    const input = ["var a = +score;", "var b = +lives;", ""].join("\n");
    const expected = ["var a = score;", "var b = lives;", ""].join("\n");

    const result = lintWithRule("no-unary-plus-on-identifier", input, {});
    assertEquals(result.messages.length, 2);
    assertEquals(result.output, expected);
});

void test("no-unary-plus-on-identifier preserves unary plus on non-identifier operands", () => {
    // `+"5"` coerces a string literal to a number — a useful conversion that is
    // not a simple "remove the operator" case; only identifier operands are flagged.
    const input = 'var value = +"5";\n';

    const result = lintWithRule("no-unary-plus-on-identifier", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-unary-plus-on-identifier preserves unary plus on call-expression operands", () => {
    const input = "var value = +get_count();\n";

    const result = lintWithRule("no-unary-plus-on-identifier", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-unary-plus-on-identifier autofixes +identifier when wrapped in parentheses", () => {
    // `+(count)` still has an Identifier as its innermost operand once the
    // synthetic parentheses are unwrapped.
    const input = "var value = +(count);\n";
    const expected = "var value = (count);\n";

    const result = lintWithRule("no-unary-plus-on-identifier", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.output, expected);
});

void test("no-unary-plus-on-identifier does not flag prefix increment (++)", () => {
    const input = "var value = ++count;\n";

    const result = lintWithRule("no-unary-plus-on-identifier", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-negative-zero autofixes -0 to 0", () => {
    const input = "var x = -0;\n";
    const expected = "var x = 0;\n";

    const result = lintWithRule("no-negative-zero", input, {});
    assertEquals(result.messages.length, 1);
    assertEquals(result.messages[0]?.messageId, "noNegativeZero");
    assertEquals(result.output, expected);
});

void test("no-negative-zero handles multiple negative zero usages in one file", () => {
    const input = ["var a = -0;", "var b = -0;", ""].join("\n");
    const expected = ["var a = 0;", "var b = 0;", ""].join("\n");

    const result = lintWithRule("no-negative-zero", input, {});
    assertEquals(result.messages.length, 2);
    assertEquals(result.output, expected);
});

void test("no-negative-zero does not flag non-zero negative literals", () => {
    const input = "var x = -5;\n";

    const result = lintWithRule("no-negative-zero", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-negative-zero does not flag bare zero without unary minus", () => {
    const input = "var x = 0;\n";

    const result = lintWithRule("no-negative-zero", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-negative-zero does not flag unary minus on identifiers", () => {
    const input = "var x = -count;\n";

    const result = lintWithRule("no-negative-zero", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});

void test("no-negative-zero does not flag unary minus on non-zero expressions", () => {
    const input = "var x = -(a + b);\n";

    const result = lintWithRule("no-negative-zero", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
});
