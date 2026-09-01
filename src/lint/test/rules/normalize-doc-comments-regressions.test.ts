import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("normalize-doc-comments removes canonical placeholder descriptions equal to a function name", () => {
    const input = ["/// @desc child_struct", "/// @param value", "function child_struct(value) {}", ""].join("\n");
    const expected = ["/// @param value", "/// @returns {undefined}", "function child_struct(value) {}", ""].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments preserves non-return tag ordering while reordering @param lines", () => {
    const input = [
        "/// @description Updates movement for the active player.",
        "/// @param speed The per-step speed scalar.",
        "/// @customTag keep this custom metadata",
        "/// @param [angle=90] Current heading in degrees.",
        "function update_movement(angle = 90, speed) {",
        "    return;",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @desc Updates movement for the active player.",
        "/// @param [angle=90] Current heading in degrees.",
        "/// @customTag keep this custom metadata",
        "/// @param speed The per-step speed scalar.",
        "/// @returns {undefined}",
        "function update_movement(angle = 90, speed) {",
        "    return;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments preserves unknown doc tags without synthesizing return tags", () => {
    const input = ["/// @foo", "var foo = function() {}", ""].join("\n");

    const expected = ["/// @foo", "var foo = function() {}", ""].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});
void test("normalize-doc-comments synthesizes docs for struct-literal property functions with named params", () => {
    const input = [
        "function build_enemy_struct(name, hp = 100) {",
        "    return {",
        "        name: name,",
        "        hp: hp,",
        "        heal: function (amount) {",
        "            hp += amount;",
        "        },",
        "        label: function () {",
        "            return string(name);",
        "        }",
        "    };",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @param name",
        "/// @param [hp=100]",
        "function build_enemy_struct(name, hp = 100) {",
        "    return {",
        "        name: name,",
        "        hp: hp,",
        "/// @param amount",
        "/// @returns {undefined}",
        "        heal: function (amount) {",
        "            hp += amount;",
        "        },",
        "        label: function () {",
        "            return string(name);",
        "        }",
        "    };",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments does not synthesize @returns for inherited constructors", () => {
    const input = [
        "function EnemyConfig(_type, _speed = 4) : EntityConfig(_speed) constructor {",
        "    type = _type;",
        "    speed = _speed;",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @param type",
        "/// @param [speed=4]",
        "function EnemyConfig(_type, _speed = 4) : EntityConfig(_speed) constructor {",
        "    type = _type;",
        "    speed = _speed;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments removes constructor placeholders and stale optional param defaults", () => {
    const input = [
        "/// @description GrandchildConfig",
        "/// @param [_bar=0]",
        "/// @returns {undefined}",
        "function GrandchildConfig(_bar) : BaseConfig(_bar) constructor {",
        "    bar = _bar;",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @param bar",
        "function GrandchildConfig(_bar) : BaseConfig(_bar) constructor {",
        "    bar = _bar;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments canonicalizes void returns and drops duplicate return tags", () => {
    const input = [
        "/// @description Draw points in array for debugging",
        "/// @returns {void}",
        "/// @returns {undefined}",
        "static draw_points = function () {",
        "    draw_circle(x, y, 2, false);",
        "};",
        ""
    ].join("\n");

    const expected = [
        "/// @desc Draw points in array for debugging",
        "/// @returns {undefined}",
        "static draw_points = function () {",
        "    draw_circle(x, y, 2, false);",
        "};",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments infers Struct returns from struct-valued identifiers", () => {
    const input = [
        "function keep_separate() {",
        "    var foo = {};",
        "    foo.bar = 1;",
        "    return foo;",
        "}",
        "",
        "/// @description Keeps the instance data available after construction.",
        "function assign_then_extend() {",
        "    data = {};",
        '    data.label = "ok";',
        "    return data;",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @returns {Struct}",
        "function keep_separate() {",
        "    var foo = {};",
        "    foo.bar = 1;",
        "    return foo;",
        "}",
        "",
        "/// @desc Keeps the instance data available after construction.",
        "/// @returns {Struct}",
        "function assign_then_extend() {",
        "    data = {};",
        '    data.label = "ok";',
        "    return data;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments keeps function-typed optional defaults without embedding the full default body", () => {
    const input = [
        "/// @param x",
        "var func_default_callback = function (x = function () {",
        "    return 1;",
        "}) {",
        "    return x();",
        "};",
        ""
    ].join("\n");

    const expected = [
        "/// @param {function} [x]",
        "/// @returns {any}",
        "var func_default_callback = function (x = function () {",
        "    return 1;",
        "}) {",
        "    return x();",
        "};",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});

void test("normalize-doc-comments documents a top-level undocumented var-assigned function in place, without duplicating it", () => {
    const input = [
        "var assigned_local_with_params = function (left, right = 10) {",
        "    var total = left + right;",
        "};",
        ""
    ].join("\n");

    const expected = [
        "/// @param left",
        "/// @param [right=10]",
        "/// @returns {undefined}",
        "var assigned_local_with_params = function (left, right = 10) {",
        "    var total = left + right;",
        "};",
        ""
    ].join("\n");

    const firstPass = lintWithRule("normalize-doc-comments", input, {}).output;
    const secondPass = lintWithRule("normalize-doc-comments", firstPass, {}).output;

    // Regression coverage for a bug where GMLoop's autofix would duplicate the
    // entire function declaration: the synthesized doc block plus a second,
    // verbatim copy of the assignment were appended immediately after the
    // original (undocumented) declaration instead of being inserted above it.
    // The fix must produce exactly one copy of the function, documented in
    // place, and running the rule again must be a no-op (idempotent).
    assertEquals(firstPass, expected);
    assertEquals(secondPass, expected);
    assertEquals(firstPass.match(/var assigned_local_with_params/g)?.length ?? 0, 1);
});

void test("normalize-doc-comments does not duplicate a particle-burst helper assigned in an event script (burst_confetti regression)", () => {
    // Reproduces the exact shape reported against GMLoop: a Create-event style
    // script with an undocumented, unindented `var name = function (...) {...};`
    // declaration that has multiple named params, no return statement, and is
    // both preceded and followed by unrelated statements/call-sites. The
    // autofix used to emit the synthesized doc block *plus a full second copy*
    // of the function body immediately after the original declaration.
    const input = [
        "/// @description Create particle effect",
        "event_inherited();",
        "",
        'var ps_confetti = global.spart_controller.get_system("confetti");',
        "var confetti_emitter_mat = matrix_build(x, y, z + radius * 2, 0, 0, 0, 1, 1, 1);",
        "var burst_confetti = function (ps, mat, pt_name) {",
        '    gml_pragma("forceinline");',
        "    var pe_confetti = new SpartEmitter(ps);",
        "    pe_confetti.set_region(mat, radius, radius, 1, eSpartShape.Circle, ps_distr_linear);",
        "    pe_confetti.set_dynamic(true);",
        "    pe_confetti.burst_sparticles(global.spart_controller.get_parttype(pt_name), irandom_range(20, 25));",
        "    pe_confetti.retire();",
        "};",
        "",
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_red");',
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_gold");',
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_orange");',
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_blue");',
        "",
        "scr_play_sound_at(snd_pop, x, y, z + radius);",
        ""
    ].join("\n");

    const expected = [
        "/// @description Create particle effect",
        "event_inherited();",
        "",
        'var ps_confetti = global.spart_controller.get_system("confetti");',
        "var confetti_emitter_mat = matrix_build(x, y, z + radius * 2, 0, 0, 0, 1, 1, 1);",
        "/// @param ps",
        "/// @param mat",
        "/// @param pt_name",
        "/// @returns {undefined}",
        "var burst_confetti = function (ps, mat, pt_name) {",
        '    gml_pragma("forceinline");',
        "    var pe_confetti = new SpartEmitter(ps);",
        "    pe_confetti.set_region(mat, radius, radius, 1, eSpartShape.Circle, ps_distr_linear);",
        "    pe_confetti.set_dynamic(true);",
        "    pe_confetti.burst_sparticles(global.spart_controller.get_parttype(pt_name), irandom_range(20, 25));",
        "    pe_confetti.retire();",
        "};",
        "",
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_red");',
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_gold");',
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_orange");',
        'burst_confetti(ps_confetti, confetti_emitter_mat, "confetti_blue");',
        "",
        "scr_play_sound_at(snd_pop, x, y, z + radius);",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
    assertEquals(result.output.match(/var burst_confetti = function/g)?.length ?? 0, 1);
    assertEquals(result.output.match(/pe_confetti\.retire\(\);/g)?.length ?? 0, 1);
});

void test("normalize-doc-comments does not duplicate a single-parameter top-level assigned function with no return", () => {
    const input = ["var log_event = function (message) {", "    show_debug_message(message);", "};", ""].join("\n");

    const expected = [
        "/// @param message",
        "/// @returns {undefined}",
        "var log_event = function (message) {",
        "    show_debug_message(message);",
        "};",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
    assertEquals(result.output.match(/var log_event = function/g)?.length ?? 0, 1);
});

void test("normalize-doc-comments does not duplicate consecutive undocumented top-level assigned functions", () => {
    const input = [
        "var add_two = function (a, b) {",
        "    total = a + b;",
        "};",
        "",
        "var subtract_two = function (a, b) {",
        "    total = a - b;",
        "};",
        ""
    ].join("\n");

    const expected = [
        "/// @param a",
        "/// @param b",
        "/// @returns {undefined}",
        "var add_two = function (a, b) {",
        "    total = a + b;",
        "};",
        "",
        "/// @param a",
        "/// @param b",
        "/// @returns {undefined}",
        "var subtract_two = function (a, b) {",
        "    total = a - b;",
        "};",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
    assertEquals(result.output.match(/var add_two = function/g)?.length ?? 0, 1);
    assertEquals(result.output.match(/var subtract_two = function/g)?.length ?? 0, 1);
});

void test("normalize-doc-comments does not duplicate a top-level assigned function with params that already has a return statement", () => {
    const input = ["var pick_larger = function (a, b) {", "    return max(a, b);", "};", ""].join("\n");

    const expected = [
        "/// @param a",
        "/// @param b",
        "/// @returns {any}",
        "var pick_larger = function (a, b) {",
        "    return max(a, b);",
        "};",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
    assertEquals(result.output.match(/var pick_larger = function/g)?.length ?? 0, 1);
});

void test("normalize-doc-comments leaves an already-documented top-level assigned function untouched and undoubled", () => {
    const input = [
        "/// @param left",
        "/// @param [right=10]",
        "/// @returns {undefined}",
        "var assigned_and_documented = function (left, right = 10) {",
        "    var total = left + right;",
        "};",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, input);
    assertEquals(result.output.match(/var assigned_and_documented = function/g)?.length ?? 0, 1);
});
