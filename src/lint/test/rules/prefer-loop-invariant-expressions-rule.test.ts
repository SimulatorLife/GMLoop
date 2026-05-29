import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

function expectAutoFix(input: string, expectedOutput: string): void {
    const result = lintWithRule("prefer-loop-invariant-expressions", input, {});
    assertEquals(result.messages.length > 0, true);
    assertEquals(result.output, expectedOutput);
}

function expectNoAutoFix(input: string): void {
    const result = lintWithRule("prefer-loop-invariant-expressions", input, {});
    assertEquals(result.messages.length, 0);
    assertEquals(result.output, input);
}

function applyRuleUntilStable(input: string): { passCount: number; output: string } {
    let currentOutput = input;

    for (let passCount = 1; passCount <= 10; passCount += 1) {
        const result = lintWithRule("prefer-loop-invariant-expressions", currentOutput, {});
        if (result.messages.length === 0 || result.output === currentOutput) {
            return {
                passCount,
                output: currentOutput
            };
        }

        currentOutput = result.output;
    }

    throw new Error("prefer-loop-invariant-expressions did not stabilize within 10 passes.");
}

void test("prefer-loop-invariant-expressions hoists repeated constant arithmetic from repeat loops", () => {
    const input = ["repeat (count) {", "    total += 60 * 60;", "}", ""].join("\n");
    const expected = ["var cached_value = 60 * 60;", "repeat (count) {", "    total += cached_value;", "}", ""].join(
        "\n"
    );

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists nested arithmetic from immutable identifiers", () => {
    const input = ["repeat (vertex_count) {", "    sum += (a + b) * c;", "}", ""].join("\n");
    const expected = [
        "var cached_value = (a + b) * c;",
        "repeat (vertex_count) {",
        "    sum += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists fixed-index array reads when loop does not mutate the array", () => {
    const input = ["repeat (count) {", "    total += weights[0] + weights[1];", "}", ""].join("\n");
    const expected = [
        "var cached_value = weights[0] + weights[1];",
        "repeat (count) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists struct field arithmetic when struct is not modified in the loop", () => {
    const input = ["repeat (samples) {", "    total += settings.speed * settings.scale;", "}", ""].join("\n");
    const expected = [
        "var cached_value = settings.speed * settings.scale;",
        "repeat (samples) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists pure abs calls on invariant inputs", () => {
    const input = ["repeat (count) {", "    total += abs(base_x - target_x);", "}", ""].join("\n");
    const expected = [
        "var cached_value = abs(base_x - target_x);",
        "repeat (count) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists dcos arithmetic on invariant inputs", () => {
    const input = ["repeat (particle_count) {", "    xs[i] = dcos(angle) * radius;", "    i += 1;", "}", ""].join("\n");
    const expected = [
        "var cached_value = dcos(angle) * radius;",
        "repeat (particle_count) {",
        "    xs[i] = cached_value;",
        "    i += 1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists if-test comparisons as cached conditions", () => {
    const input = ["repeat (count) {", "    if (player_hp <= 0) {", "        alarm[0] = 1;", "    }", "}", ""].join(
        "\n"
    );
    const expected = [
        "var cached_value = player_hp <= 0;",
        "repeat (count) {",
        "    if (cached_value) {",
        "        alarm[0] = 1;",
        "    }",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists invariant ternary expressions", () => {
    const input = ["repeat (count) {", "    value += is_boss ? 10 : 2;", "}", ""].join("\n");
    const expected = [
        "var cached_value = is_boss ? 10 : 2;",
        "repeat (count) {",
        "    value += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists point_distance calls when all inputs are invariant", () => {
    const input = ["repeat (count) {", "    total += point_distance(0, 0, width, height);", "}", ""].join("\n");
    const expected = [
        "var cached_value = point_distance(0, 0, width, height);",
        "repeat (count) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists floor calls on invariant inputs", () => {
    const input = ["repeat (count) {", "    total += floor(score / divisor);", "}", ""].join("\n");
    const expected = [
        "var cached_value = floor(score / divisor);",
        "repeat (count) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists dsin calls on invariant inputs", () => {
    const input = ["repeat (count) {", "    xs[i] = dsin(angle) * amplitude;", "    i += 1;", "}", ""].join("\n");
    const expected = [
        "var cached_value = dsin(angle) * amplitude;",
        "repeat (count) {",
        "    xs[i] = cached_value;",
        "    i += 1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists lerp calls when all inputs are invariant", () => {
    const input = ["repeat (count) {", "    arr[i] = lerp(a, b, f) * scale;", "    i += 1;", "}", ""].join("\n");
    const expected = [
        "var cached_value = lerp(a, b, f) * scale;",
        "repeat (count) {",
        "    arr[i] = cached_value;",
        "    i += 1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists string_length calls on invariant inputs", () => {
    const input = ["repeat (count) {", "    total += string_length(name) + suffix;", "}", ""].join("\n");
    const expected = [
        "var cached_value = string_length(name) + suffix;",
        "repeat (count) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists ceil calls on invariant inputs", () => {
    const input = ["repeat (count) {", "    total += ceil(score / divisor);", "}", ""].join("\n");
    const expected = [
        "var cached_value = ceil(score / divisor);",
        "repeat (count) {",
        "    total += cached_value;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists template strings even when call sites remain in-loop", () => {
    const input = ["repeat (count) {", '    draw_text(x, y, $"hp: {max_hp}");', "}", ""].join("\n");
    const expected = [
        'var cached_text = $"hp: {max_hp}";',
        "repeat (count) {",
        "    draw_text(x, y, cached_text);",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists to the immediate enclosing scope for nested loops", () => {
    const input = [
        "repeat (rows) {",
        "    var col = 0;",
        "",
        "    repeat (cols) {",
        "        total += grid_width * grid_height;",
        "        col += 1;",
        "    }",
        "",
        "    grid_width += 1;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "repeat (rows) {",
        "    var col = 0;",
        "",
        "    var cached_value = grid_width * grid_height;",
        "    repeat (cols) {",
        "        total += cached_value;",
        "        col += 1;",
        "    }",
        "",
        "    grid_width += 1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists safe invariant subexpressions from mixed expressions", () => {
    const input = [
        "var i = 0;",
        "",
        "repeat (count) {",
        "    total += (base_damage * multiplier) + values[i];",
        "    i += 1;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var i = 0;",
        "",
        "var cached_value = base_damage * multiplier;",
        "repeat (count) {",
        "    total += (cached_value) + values[i];",
        "    i += 1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists safe subexpressions while preserving impure calls in-loop", () => {
    const input = ["repeat (count) {", "    total += (base_damage * multiplier) + scr_bonus();", "}", ""].join("\n");
    const expected = [
        "var cached_value = base_damage * multiplier;",
        "repeat (count) {",
        "    total += (cached_value) + scr_bonus();",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions keeps earliest candidate selection when multiple subexpressions tie", () => {
    const input = ["repeat (count) {", "    total += (a + b) + random(3) + (c + d);", "}", ""].join("\n");
    const expected = [
        "var cached_value = a + b;",
        "repeat (count) {",
        "    total += (cached_value) + random(3) + (c + d);",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions hoists complex boolean conditions safely", () => {
    const input = [
        "repeat (count) {",
        '    if (player_hp <= 0 or player_state == "dead") {',
        "        dead_hits += 1;",
        "    }",
        "}",
        ""
    ].join("\n");
    const expected = [
        'var cached_value = player_hp <= 0 or player_state == "dead";',
        "repeat (count) {",
        "    if (cached_value) {",
        "        dead_hits += 1;",
        "    }",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions does not rewrite loops that already use precomputed values", () => {
    const input = [
        "var scale = width * height;",
        "",
        "repeat (steps) {",
        "    buffer[i] = scale;",
        "    i += 1;",
        "}",
        ""
    ].join("\n");

    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist random calls", () => {
    const input = ["repeat (count) {", "    total += random(10);", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist unknown script calls", () => {
    const input = ["repeat (count) {", "    total += scr_get_score();", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist non-deterministic time-like identifiers", () => {
    const input = ["repeat (count) {", "    value = current_time;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist ds accessors with mutable engine state", () => {
    const input = ["repeat (count) {", "    total += ds_list_size(my_list);", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist expressions that depend on loop-updated indices", () => {
    const input = ["var i = 0;", "", "repeat (count) {", "    total += values[i] * 2;", "    i += 1;", "}", ""].join(
        "\n"
    );
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist struct field reads when the struct is mutated in-loop", () => {
    const input = ["repeat (count) {", "    total += settings.speed * 2;", "    settings.speed += 1;", "}", ""].join(
        "\n"
    );
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist array reads when the array is mutated in-loop", () => {
    const input = ["repeat (count) {", "    total += weights[0] * 2;", "    weights[0] += 1;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist member reads when impure calls also run in-loop", () => {
    const input = [
        "repeat (count) {",
        "    total += global.score_multiplier * 2;",
        "    scr_step_effects();",
        "}",
        ""
    ].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist post-increment expressions", () => {
    const input = ["repeat (count) {", "    total += value++;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions preserves fixes when local hoist names collide", () => {
    const input = [
        "var cached_value = 1;",
        "var cached_value_1 = 2;",
        "",
        "repeat (count) {",
        "    total += 60 * 60;",
        "}",
        ""
    ].join("\n");
    const result = lintWithRule("prefer-loop-invariant-expressions", input, {});

    const expected = [
        "var cached_value = 1;",
        "var cached_value_1 = 2;",
        "",
        "var cached_value_2 = 60 * 60;",
        "repeat (count) {",
        "    total += cached_value_2;",
        "}",
        ""
    ].join("\n");

    assertEquals(result.output, expected);
});

void test("prefer-loop-invariant-expressions does not hoist constructor expressions", () => {
    const input = ["repeat (count) {", "    total += new DamageInfo(power).amount;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist audio state queries", () => {
    const input = [
        "repeat (count) {",
        "    if (audio_is_playing(sound_id)) {",
        "        active += 1;",
        "    }",
        "}",
        ""
    ].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist instance existence checks", () => {
    const input = [
        "repeat (count) {",
        "    if (instance_exists(obj_enemy)) {",
        "        found += 1;",
        "    }",
        "}",
        ""
    ].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist pure-call expressions when their inputs mutate each iteration", () => {
    const input = ["repeat (count) {", "    total += abs(speed);", "    speed -= friction;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist expressions when later loop mutations change dependencies", () => {
    const input = ["repeat (count) {", "    total += width * height;", "    width += 1;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist unknown scripts even with invariant arguments", () => {
    const input = ["repeat (count) {", "    total += scr_damage_calc(atk, def);", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist dynamic map accessor reads", () => {
    const input = ["repeat (count) {", '    total += map[? "score"];', "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions avoids noisy hoists for trivial invariant identifier fragments", () => {
    const input = ["repeat (count) {", "    total = total + base_value;", "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions does not hoist variable_instance_get", () => {
    const input = ["repeat (count) {", '    total += variable_instance_get(id, "hp");', "}", ""].join("\n");
    expectNoAutoFix(input);
});

void test("prefer-loop-invariant-expressions resolves hoist names case-insensitively against in-scope identifiers", () => {
    const input = ["var CACHED_VALUE = 99;", "repeat (count) {", "    total += (a + b) * c;", "}", ""].join("\n");
    const expected = [
        "var CACHED_VALUE = 99;",
        "var cached_value_1 = (a + b) * c;",
        "repeat (count) {",
        "    total += cached_value_1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions keeps generated hoist names unique across multiple loops", () => {
    const input = [
        "repeat (count_a) {",
        "    total_a += x_a * y_a;",
        "}",
        "",
        "repeat (count_b) {",
        "    total_b += x_b * y_b;",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var cached_value = x_a * y_a;",
        "repeat (count_a) {",
        "    total_a += cached_value;",
        "}",
        "",
        "var cached_value_1 = x_b * y_b;",
        "repeat (count_b) {",
        "    total_b += cached_value_1;",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});

void test("prefer-loop-invariant-expressions reuses a single hoist for equivalent expressions across repeated passes", () => {
    const input = [
        "repeat (tri_num) {",
        "    buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "    buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "    buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var cached_value = 8 * 4;",
        "repeat (tri_num) {",
        "    buffer_seek(mbuff, buffer_seek_relative, cached_value);",
        "    buffer_seek(mbuff, buffer_seek_relative, cached_value);",
        "    buffer_seek(mbuff, buffer_seek_relative, cached_value);",
        "}",
        ""
    ].join("\n");

    const stabilized = applyRuleUntilStable(input);
    assertEquals(stabilized.output, expected);
});

void test("prefer-loop-invariant-expressions does not re-hoist generated cache declarations into ancestor loops", () => {
    const input = [
        "for (var i = 0; i < 3; i++) {",
        "    repeat (tri_num) {",
        "        buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "        buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "        buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "    }",
        "}",
        ""
    ].join("\n");
    const expected = [
        "for (var i = 0; i < 3; i++) {",
        "    var cached_value = 8 * 4;",
        "    repeat (tri_num) {",
        "        buffer_seek(mbuff, buffer_seek_relative, cached_value);",
        "        buffer_seek(mbuff, buffer_seek_relative, cached_value);",
        "        buffer_seek(mbuff, buffer_seek_relative, cached_value);",
        "    }",
        "}",
        ""
    ].join("\n");

    const stabilized = applyRuleUntilStable(input);
    assertEquals(stabilized.output, expected);
});

void test("prefer-loop-invariant-expressions skips comment-spanning candidates while hoisting safe alternatives", () => {
    const input = ["repeat (count) {", "    total += (a /* keep */ + b) + (c + d);", "}", ""].join("\n");
    const expected = [
        "var cached_value = c + d;",
        "repeat (count) {",
        "    total += (a /* keep */ + b) + (cached_value);",
        "}",
        ""
    ].join("\n");

    expectAutoFix(input, expected);
});
