import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as LintWorkspace from "@gmloop/lint";

import { assertEquals } from "../assertions.js";
import { lintWithFeatherRule } from "./rule-test-harness.js";

type MigrationCase = {
    fixtureDirectory: string;
    ruleName: string;
    assertOutput: (output: string, input: string) => void;
};

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const migratedFeatherFixtureCandidates = [
    path.resolve(testDirectory, "fixtures/feather"),
    path.resolve(testDirectory, "../../test/fixtures/feather"),
    path.resolve(testDirectory, "../../../test/fixtures/feather")
];
const migratedFeatherFixtureDirectory = migratedFeatherFixtureCandidates.find((candidate) => existsSync(candidate));
if (!migratedFeatherFixtureDirectory) {
    throw new Error(
        `Unable to resolve migrated feather fixture directory from candidates: ${migratedFeatherFixtureCandidates.join(
            ", "
        )}`
    );
}

async function readMigratedFeatherFixture(fixtureDirectory: string): Promise<string> {
    const inputPath = path.join(migratedFeatherFixtureDirectory, fixtureDirectory, "input.gml");
    return readFile(inputPath, "utf8");
}

function countOccurrences(text: string, needle: string): number {
    return text.split(needle).length - 1;
}

const migrationCases: ReadonlyArray<MigrationCase> = Object.freeze([
    {
        fixtureDirectory: "gm1000",
        ruleName: "gm1000",
        assertOutput: (output) => {
            assertEquals(output.includes("break;"), false);
            assertEquals(output.includes("value = 42;"), true);
        }
    },
    {
        fixtureDirectory: "gm1002",
        ruleName: "gm1002",
        assertOutput: (output) => {
            assertEquals(output.includes("global.gameManager"), false);
            assertEquals(output.includes("gameManager = new GameManager("), true);
        }
    },
    {
        fixtureDirectory: "gm1007",
        ruleName: "gm1007",
        assertOutput: (output) => {
            assertEquals(output.includes("new Point(0, 0) ="), false);
            assertEquals(output.includes("1 = new Point"), false);
        }
    },
    {
        fixtureDirectory: "gm1008",
        ruleName: "gm1008",
        assertOutput: (output) => {
            assertEquals(/\bworking_directory\b/.test(output), false);
            assertEquals(output.includes("__feather_working_directory"), true);
        }
    },
    {
        fixtureDirectory: "gm1009",
        ruleName: "gm1009",
        assertOutput: (output) => {
            assertEquals(output.includes("fa_readonly | fa_archive"), true);
            assertEquals(output.includes("room_goto_next()"), true);
        }
    },
    {
        fixtureDirectory: "gm1010",
        ruleName: "gm1010",
        assertOutput: (output) => {
            assertEquals(output.includes("result = 5 + 5;"), true);
            assertEquals(output.includes("real(numFive)"), true);
        }
    },
    {
        fixtureDirectory: "gm1012",
        ruleName: "gm1012",
        assertOutput: (output) => {
            assertEquals(output.includes("/// @param value"), true);
            assertEquals(countOccurrences(output, "/// @param value"), 1);
            assertEquals(output.includes("string_length("), true);
        }
    },
    {
        fixtureDirectory: "gm1015",
        ruleName: "gm1015",
        assertOutput: (output) => {
            assertEquals(output.includes("/= 0"), false);
            assertEquals(output.includes("%= -1"), true);
        }
    },
    {
        fixtureDirectory: "gm1017",
        ruleName: "gm1017",
        assertOutput: (output) => {
            assertEquals(output.includes("start_new_game();"), true);
            assertEquals(output.includes("make_game();"), false);
        }
    },
    {
        fixtureDirectory: "gm1021",
        ruleName: "gm1021",
        assertOutput: (output) => {
            assertEquals(output.includes("argument[0]"), false);
            assertEquals(output.includes("var first = value;"), true);
        }
    },
    {
        fixtureDirectory: "gm1024",
        ruleName: "gm1024",
        assertOutput: (output) => {
            assertEquals(output.includes("__featherFix_score"), true);
            assertEquals(/\bscore\b\s*=/.test(output), false);
        }
    },
    {
        fixtureDirectory: "gm1026",
        ruleName: "gm1026",
        assertOutput: (output) => {
            assertEquals(output.includes("var __featherFix_pi = pi;"), true);
            assertEquals(output.includes("__featherFix_pi++;"), true);
        }
    },
    {
        fixtureDirectory: "gm1028",
        ruleName: "gm1028",
        assertOutput: (output) => {
            assertEquals(output.includes("[?"), false);
            assertEquals(output.includes("[|"), true);
        }
    },
    {
        fixtureDirectory: "gm1029",
        ruleName: "gm1029",
        assertOutput: (output) => {
            assertEquals(output.includes('"1234"'), false);
            assertEquals(output.includes("draw_sprite(sprite_index, image_index, 1234, 5678);"), true);
        }
    },
    {
        fixtureDirectory: "gm1030",
        ruleName: "gm1030",
        assertOutput: (output) => {
            assertEquals(output.includes("__featherFix_sprite_index"), true);
            assertEquals(/\bsprite_index\b/.test(output), false);
        }
    },
    {
        fixtureDirectory: "gm1033",
        ruleName: "gm1033",
        assertOutput: (output) => {
            assertEquals(output.includes(";;"), false);
            assertEquals(output.includes("var value = 1;"), true);
        }
    },
    {
        fixtureDirectory: "gm1038",
        ruleName: "gm1038",
        assertOutput: (output) => {
            assertEquals(countOccurrences(output, "#macro dbg"), 1);
        }
    },
    {
        fixtureDirectory: "gm1041",
        ruleName: "gm1041",
        assertOutput: (output) => {
            assertEquals(output.includes('"obj_player"'), false);
            assertEquals(output.includes("obj_player"), true);
        }
    },
    {
        fixtureDirectory: "gm1051",
        ruleName: "gm1051",
        assertOutput: (output) => {
            assertEquals(output.includes("#macro FOO_SIMPLE 1;"), false);
            assertEquals(output.includes("#macro BAR_SIMPLE (value + 1);"), false);
            assertEquals(output.includes("#macro BAR script_call();"), false);
            assertEquals(output.includes("#macro KEEP value;value"), true);
        }
    },
    {
        fixtureDirectory: "gm1052",
        ruleName: "gm1052",
        assertOutput: (output) => {
            assertEquals(output.includes("delete values;"), false);
            assertEquals(output.includes("values = undefined;"), true);
        }
    },
    {
        fixtureDirectory: "gm1054",
        ruleName: "gm1054",
        assertOutput: (output) => {
            assertEquals(output.includes("array_length_1d("), false);
            assertEquals(output.includes("array_length("), true);
        }
    },
    {
        fixtureDirectory: "gm1058",
        ruleName: "gm1058",
        assertOutput: (output) => {
            assertEquals(/function item\(\)\s+constructor/.test(output), true);
        }
    },
    {
        fixtureDirectory: "gm1063",
        ruleName: "gm1063",
        assertOutput: (output) => {
            assertEquals(output.includes("pointer_null"), true);
            assertEquals(output.includes(": -1"), false);
        }
    },
    {
        fixtureDirectory: "gm1064",
        ruleName: "gm1064",
        assertOutput: (output) => {
            assertEquals(countOccurrences(output, "function make_game"), 1);
        }
    },
    {
        fixtureDirectory: "gm1100",
        ruleName: "gm1100",
        assertOutput: (output) => {
            assertEquals(output.includes("_this * something;"), false);
            assertEquals(output.includes("= 48;"), false);
        }
    },
    {
        fixtureDirectory: "gm1013",
        ruleName: "gm1013",
        assertOutput: (output) => {
            assertEquals(output.includes("/// @param [attack_bonus=10]"), false);
            assertEquals(output.includes("other.attack_bonus"), true);
        }
    },
    {
        fixtureDirectory: "gm1032",
        ruleName: "gm1032",
        assertOutput: (output) => {
            assertEquals(output.includes("function sample3(zero, one, two, three)"), true);
            assertEquals(output.includes("/// @param argument0"), true);
        }
    },
    {
        fixtureDirectory: "gm1034",
        ruleName: "gm1034",
        assertOutput: (output) => {
            assertEquals(output.includes("/// @param first_parameter"), false);
            assertEquals(output.includes("function func_args(_first_parameter) {"), true);
        }
    },
    {
        fixtureDirectory: "gm1036",
        ruleName: "gm1036",
        assertOutput: (output) => {
            assertEquals(output.includes("[0][1][2][3]"), true);
            assertEquals(output.includes("/// @param mat"), false);
        }
    },
    {
        fixtureDirectory: "gm1056",
        ruleName: "gm1056",
        assertOutput: (output) => {
            assertEquals(output.includes("c = undefined"), true);
            assertEquals(output.includes("/// @param [c]"), false);
        }
    },
    {
        fixtureDirectory: "gm1059",
        ruleName: "gm1059",
        assertOutput: (output) => {
            assertEquals(output.includes("function example(value, value2)"), true);
            assertEquals(output.includes("value, value, value"), false);
        }
    },
    {
        fixtureDirectory: "gm1062",
        ruleName: "gm1062",
        assertOutput: (output) => {
            assertEquals(output.includes("/// @description"), true);
            assertEquals(output.includes("{Id.Instance}"), true);
        }
    },
    {
        fixtureDirectory: "gm2000",
        ruleName: "gm2000",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_blendmode(bm_normal);"), true);
        }
    },
    {
        fixtureDirectory: "gm2003",
        ruleName: "gm2003",
        assertOutput: (output) => {
            assertEquals(output.includes("shader_reset();"), true);
        }
    },
    {
        fixtureDirectory: "gm2004",
        ruleName: "gm2004",
        assertOutput: (output) => {
            assertEquals(output.includes("repeat (amount)"), true);
            assertEquals(output.includes("for (var i = 0;"), false);
        }
    },
    {
        fixtureDirectory: "gm2005",
        ruleName: "gm2005",
        assertOutput: (output) => {
            assertEquals(output.includes("surface_reset_target();"), true);
        }
    },
    {
        fixtureDirectory: "gm2007",
        ruleName: "gm2007",
        assertOutput: (output) => {
            assertEquals(output.includes("var missing;"), true);
            assertEquals(output.includes("var withComment; // comment"), true);
            assertEquals(output.includes("if (scr_custom_eval()) {"), true);
        }
    },
    {
        fixtureDirectory: "gm2008",
        ruleName: "gm2008",
        assertOutput: (output) => {
            assertEquals(output.includes("vertex_end(vb);"), true);
        }
    },
    {
        fixtureDirectory: "gm2009",
        ruleName: "gm2009",
        assertOutput: (output) => {
            assertEquals(output.includes("vertex_end("), false);
        }
    },
    {
        fixtureDirectory: "gm2011",
        ruleName: "gm2011",
        assertOutput: (output) => {
            assertEquals(output.includes("vertex_end(vb);"), true);
        }
    },
    {
        fixtureDirectory: "gm2012",
        ruleName: "gm2012",
        assertOutput: (output) => {
            assertEquals(output.includes("vertex_format_add_position_3d();"), false);
        }
    },
    {
        fixtureDirectory: "gm2015",
        ruleName: "gm2015",
        assertOutput: (output) => {
            assertEquals(output.includes("TODO: Incomplete vertex format definition"), true);
            assertEquals(output.includes("//vertex_format_begin();"), true);
        }
    },
    {
        fixtureDirectory: "gm2020",
        ruleName: "gm2020",
        assertOutput: (output) => {
            assertEquals(output.includes("with (all) {"), true);
            assertEquals(output.includes("all.hp ="), false);
        }
    },
    {
        fixtureDirectory: "gm2023",
        ruleName: "gm2023",
        assertOutput: (output) => {
            assertEquals(output.includes("draw_set_alpha(1);"), true);
        }
    },
    {
        fixtureDirectory: "gm2025",
        ruleName: "gm2025",
        assertOutput: (output) => {
            assertEquals(output.includes("draw_set_color(c_white);"), true);
        }
    },
    {
        fixtureDirectory: "gm2026",
        ruleName: "gm2026",
        assertOutput: (output) => {
            assertEquals(output.includes("draw_set_halign(fa_left);"), true);
        }
    },
    {
        fixtureDirectory: "gm2028",
        ruleName: "gm2028",
        assertOutput: (output) => {
            assertEquals(output.includes("draw_primitive_end();"), false);
        }
    },
    {
        fixtureDirectory: "gm2029",
        ruleName: "gm2029",
        assertOutput: (output) => {
            assertEquals(output.includes("draw_primitive_begin(pr_trianglelist);"), true);
            assertEquals(countOccurrences(output, "draw_primitive_end();") <= 1, true);
        }
    },
    {
        fixtureDirectory: "gm2029-attachment",
        ruleName: "gm2029",
        assertOutput: (output) => {
            assertEquals(output.includes("draw_primitive_begin(pr_trianglelist);"), true);
        }
    },
    {
        fixtureDirectory: "gm2030",
        ruleName: "gm2030",
        assertOutput: (output) => {
            assertEquals(countOccurrences(output, "draw_primitive_end();"), 1);
        }
    },
    {
        fixtureDirectory: "gm2031",
        ruleName: "gm2031",
        assertOutput: (output) => {
            assertEquals(output.includes("file_find_close();"), true);
        }
    },
    {
        fixtureDirectory: "gm2033",
        ruleName: "gm2033",
        assertOutput: (output) => {
            assertEquals(output.trimEnd().endsWith("file_find_next();"), false);
        }
    },
    {
        fixtureDirectory: "gm2032",
        ruleName: "gm2032",
        assertOutput: (output) => {
            assertEquals(output.includes("file_find_close();"), false);
        }
    },
    {
        fixtureDirectory: "gm2035",
        ruleName: "gm2035",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_pop_state();"), true);
        }
    },
    {
        fixtureDirectory: "gm2040",
        ruleName: "gm2040",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_zwriteenable(true);"), true);
        }
    },
    {
        fixtureDirectory: "gm2042",
        ruleName: "gm2042",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_push_state();\ngpu_push_state();"), false);
        }
    },
    {
        fixtureDirectory: "gm2043",
        ruleName: "gm2043",
        assertOutput: (output) => {
            assertEquals(output.includes("var i = 0;"), true);
            assertEquals(output.includes("var i = 34;"), false);
            assertEquals(output.includes("var _msg;"), true);
            assertEquals(output.includes('var _msg = "Something happened!";'), false);
            assertEquals(output.includes("if (something_occurred) {"), true);
        }
    },
    {
        fixtureDirectory: "gm2044",
        ruleName: "gm2044",
        assertOutput: (output) => {
            assertEquals(output.includes("/// @returns {undefined}"), true);
            assertEquals(output.includes("var total = total + 1;"), false);
        }
    },
    {
        fixtureDirectory: "gm2046",
        ruleName: "gm2046",
        assertOutput: (output) => {
            assertEquals(countOccurrences(output, "surface_reset_target();") >= 2, true);
        }
    },
    {
        fixtureDirectory: "gm2048",
        ruleName: "gm2048",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_blendenable(true);"), true);
        }
    },
    {
        fixtureDirectory: "gm2050",
        ruleName: "gm2050",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_fog(false, c_black, 0, 1);"), true);
        }
    },
    {
        fixtureDirectory: "gm2051",
        ruleName: "gm2051",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_cullmode(cull_noculling);"), true);
        }
    },
    {
        fixtureDirectory: "gm2052",
        ruleName: "gm2052",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_colourwriteenable(true, true, true, true);"), true);
        }
    },
    {
        fixtureDirectory: "gm2053",
        ruleName: "gm2053",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_alphatestenable(false);"), true);
        }
    },
    {
        fixtureDirectory: "gm2054",
        ruleName: "gm2054",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_alphatestref(128);"), true);
            assertEquals(output.includes("gpu_set_alphatestref(0);"), true);
            assertEquals(
                /gpu_set_alphatestref\s*\(\s*0\s*\)\s*;\s*\ngpu_set_alphatestenable\s*\(\s*false\s*\)\s*;/u.test(
                    output
                ),
                true
            );
        }
    },
    {
        fixtureDirectory: "gm2056",
        ruleName: "gm2056",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_texrepeat(false);"), true);
        }
    },
    {
        fixtureDirectory: "gm2061",
        ruleName: "gm2061",
        assertOutput: (output) => {
            assertEquals(output.includes("?? []"), true);
            assertEquals(output.includes("== undefined"), false);
        }
    },
    {
        fixtureDirectory: "gm2064",
        ruleName: "gm2064",
        assertOutput: (output) => {
            assertEquals(output.includes("gpu_set_ztestenable(true);"), true);
        }
    }
]);

void test("legacy plugin GM fixtures are now lint-owned feather rule tests", async () => {
    for (const migrationCase of migrationCases) {
        const input = await readMigratedFeatherFixture(migrationCase.fixtureDirectory);
        const result = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, migrationCase.ruleName, input);
        assertEquals(result.messages.length > 0, true, `${migrationCase.ruleName} should report diagnostics`);
        migrationCase.assertOutput(result.output, input);
    }
});

void test("gm1013 applies generic rewrites beyond fixture-specific symbols", () => {
    const input = `function DamageHandler (speed = 12) constructor {
    /// @function trigger
    static strike = function () {
        with (other) {
            var total = (base + speed);
        }
    }
}

runner = function () constructor {
    value = 1;
}
`;

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1013", input);

    assertEquals(output.includes("/// @param [speed=12]"), false);
    assertEquals(output.includes("function DamageHandler(speed = 12) constructor {"), true);
    assertEquals(output.includes("/// @returns {undefined}"), false);
    assertEquals(output.includes("/// @function trigger"), true);
    assertEquals(output.includes("var total = base + other.speed;"), true);
    assertEquals(output.includes("static strike = function () {"), true);
    assertEquals(output.includes("runner = function () constructor {"), true);
    assertEquals(output.includes("};"), true);
});

void test("gm1052 rewrites only array delete targets to undefined", () => {
    const input = `var values = [1, 2, 3];
var structValues = { value: 1 };
delete values;
delete structValues;
`;

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1052", input);

    assertEquals(output.includes("values = undefined;"), true);
    assertEquals(output.includes("delete structValues;"), true);
});

void test("gm2054 preserves active threshold and inserts reset before alpha-test disable", () => {
    const input = `gpu_set_alphatestenable(true);
gpu_set_alphatestref(128);
draw_self();
gpu_set_alphatestenable(false);
`;

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2054", input);

    assertEquals(output.includes("gpu_set_alphatestref(128);"), true);
    assertEquals(output.includes("gpu_set_alphatestref(0);\ngpu_set_alphatestenable(false);"), true);
});

void test("gm1051 removes trailing macro semicolons without mutating inline semicolon bodies", () => {
    const input = `#macro SIMPLE 42;
#macro COMMENTED call(); // comment
#macro BLOCKED call();/* block */
#macro KEEP value;value
#macro KEEP_WITH_TRAILING value;value;
`;

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1051", input);

    assertEquals(output.includes("#macro SIMPLE 42;"), false);
    assertEquals(output.includes("#macro COMMENTED call(); // comment"), false);
    assertEquals(output.includes("#macro BLOCKED call();/* block */"), false);
    assertEquals(output.includes("#macro COMMENTED call() // comment"), true);
    assertEquals(output.includes("#macro BLOCKED call()/* block */"), true);
    assertEquals(output.includes("#macro KEEP value;value"), true);
    assertEquals(output.includes("#macro KEEP_WITH_TRAILING value;value;"), true);
});

void test("gm1051 removes a trailing macro semicolon before a line-continuation backslash", () => {
    const input =
        "#macro __SCRIBBLE_PARSER_NEXT_GLYPH ++_glyph_count;\\\n" +
        "                                     _glyph_prev_prev = _glyph_prev;\\\n" +
        "                                     _glyph_prev = _glyph_write;";

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1051", input);

    assertEquals(
        output,
        "#macro __SCRIBBLE_PARSER_NEXT_GLYPH ++_glyph_count\\\n" +
            "                                     _glyph_prev_prev = _glyph_prev\\\n" +
            "                                     _glyph_prev = _glyph_write"
    );
});

void test("gm1051 fixes multiline macro continuation lines without mutating comment-bearing continuations", () => {
    const input =
        "#macro __SCRIBBLE_PARSER_WRITE_NEWLINE _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__UNICODE      ] = 0x0A\\ //ASCII line break (dec = 10)\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__BIDI         ] = e__ScribbleBidi.ISOLATED;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__X            ] = 0;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__Y            ] = 0;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__WIDTH        ] = 0;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__HEIGHT       ] = _font_line_height;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__FONT_HEIGHT  ] = _font_line_height;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__SEPARATION   ] = 0;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__LEFT_OFFSET  ] = 0;\\\n" +
        "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__CONTROL_COUNT] = _control_count;\\\n" +
        "                                        ;\\\n" +
        "                                        ++_glyph_count;\\\n" +
        "                                        _glyph_prev_arabic_join_next = false;\\\n" +
        "                                        _glyph_prev_prev = _glyph_prev;\\\n" +
        "                                        _glyph_prev = 0x0A;";

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1051", input);

    assertEquals(
        output,
        "#macro __SCRIBBLE_PARSER_WRITE_NEWLINE _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__UNICODE      ] = 0x0A\\ //ASCII line break (dec = 10)\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__BIDI         ] = e__ScribbleBidi.ISOLATED\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__X            ] = 0\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__Y            ] = 0\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__WIDTH        ] = 0\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__HEIGHT       ] = _font_line_height\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__FONT_HEIGHT  ] = _font_line_height\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__SEPARATION   ] = 0\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__LEFT_OFFSET  ] = 0\\\n" +
            "                                        _glyph_grid[# _glyph_count, e__ScribbleGenGlyph.__CONTROL_COUNT] = _control_count\\\n" +
            "                                        \\\n" +
            "                                        ++_glyph_count\\\n" +
            "                                        _glyph_prev_arabic_join_next = false\\\n" +
            "                                        _glyph_prev_prev = _glyph_prev\\\n" +
            "                                        _glyph_prev = 0x0A"
    );
});

void test("gm1033 removes redundant semicolon runs without mutating for-loop headers", () => {
    const input = `for (;;) {
    tick();
}

var total = 1;;
;;
`;

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1033", input);

    assertEquals(output.includes("for (;;) {"), true);
    assertEquals(output.includes("var total = 1;;"), false);
    assertEquals(output.includes("\n;;\n"), false);
});

void test("gm1003 removes numeric string enum initializers without leaving a trailing comma on the final member", () => {
    const input = [
        "enum eTransitionType {",
        "    in = eTransitionState.in, // zoom in",
        "    out = eTransitionState.out, // zoom out",
        "    partway_in = eTransitionState.partway_in, // zoom part way in",
        "    partway_out = eTransitionState.partway_out, // zoom part way in",
        "}",
        ""
    ].join("\n");

    const { output } = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1003", input);

    assertEquals(/partway_out\s*=\s*eTransitionState\.partway_out,\s*\/\/ zoom part way in/u.test(output), false);
    assertEquals(/partway_out\s*=\s*eTransitionState\.partway_out\s*\/\/ zoom part way in/u.test(output), true);
});

void test("gm1058 is idempotent when constructor has already been inserted", () => {
    const input = ["function item()", "{", "    self.value = 1;", "}", "", "var sword = new item();", ""].join("\n");

    const firstPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1058", input).output;
    const secondPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm1058", firstPass).output;

    assertEquals(firstPass, secondPass);
    assertEquals(countOccurrences(secondPass, "constructor"), 1);
});

void test("gm2031 inserts file_find_close only once before the nested file_find_first call", () => {
    const input = [
        'var _file = file_find_first("/game_data/*.bin", fa_none);',
        "",
        "if (_look_for_description)",
        "{",
        '    _file2 = file_find_first("/game_data/*.json", fa_none);',
        "}",
        ""
    ].join("\n");

    const firstPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2031", input).output;
    const secondPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2031", firstPass).output;

    assertEquals(countOccurrences(firstPass, "file_find_close();"), 1);
    assertEquals(firstPass, secondPass);
});

void test("gm2043 swaps declaration order exactly once across repeated fixer passes", () => {
    const input = ["i = 0;", "", "var i = 34;", ""].join("\n");

    const firstPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2043", input).output;
    const secondPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2043", firstPass).output;

    assertEquals(firstPass, secondPass);
    assertEquals(countOccurrences(secondPass, "var i = 0;"), 1);
    assertEquals(countOccurrences(secondPass, "var var"), 0);
});

void test("gm2044 inserts a single returns doc even across repeated fixer passes", () => {
    const input = ["function demo() {", "    return;", "}", ""].join("\n");

    const firstPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2044", input).output;
    const secondPass = lintWithFeatherRule(LintWorkspace.Lint.featherPlugin, "gm2044", firstPass).output;

    assertEquals(countOccurrences(firstPass, "/// @returns {undefined}"), 1);
    assertEquals(firstPass, secondPass);
});
