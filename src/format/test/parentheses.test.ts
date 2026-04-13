import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("omits synthetic multiplicative parentheses inside additive expressions", async () => {
    const source = "var actual_dist = xoff * xoff + yoff * yoff;\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var actual_dist = xoff * xoff + yoff * yoff;\n");
});

void test("omits redundant multiplicative parentheses inside additive expressions", async () => {
    const source = "var actual_dist = (xoff * xoff) + (yoff * yoff);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var actual_dist = xoff * xoff + yoff * yoff;\n");
});

void test("preserves parentheses that change grouping in additive expressions", async () => {
    const source = "var value = (a + b) * c;\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = (a + b) * c;\n");
});

void test("preserves parentheses that change grouping in multiplicative expressions", async () => {
    const source = "var value = a * (b + c);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = a * (b + c);\n");
});

void test("preserves right-side multiplicative grouping in division expressions", async () => {
    const source = "var value = a / (b * c);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = a / (b * c);\n");
});

void test("preserves right-side divisive grouping in division expressions", async () => {
    const source = "var value = a / (b / c);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = a / (b / c);\n");
});

void test("preserves denominator grouping for 3DSpider inverse-kinematics sqrt expression", async () => {
    const source =
        "var intersectionRadius = sqrt(p2_p3sqr - (sqr(p1_p2sqr - p2_p3sqr - p1_p3sqr) / (4 * p1_p3sqr)));\n";
    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        "var intersectionRadius = sqrt(p2_p3sqr - sqr(p1_p2sqr - p2_p3sqr - p1_p3sqr) / (4 * p1_p3sqr));\n"
    );
});

void test("omits redundant parentheses around a simple identifier", async () => {
    const source = "var value = (a);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = a;\n");
});

void test("omits redundant parentheses around a simple literal", async () => {
    const source = "var value = (123);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = 123;\n");
});

void test("preserves parentheses around unary expressions when they change meaning", async () => {
    const source = "var value = -(a + b);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = -(a + b);\n");
});

void test("omits redundant parentheses around unary operand when they do not change meaning", async () => {
    const source = "var value = (-a);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var value = -a;\n");
});

void test("omits redundant parentheses around comparison operands", async () => {
    const source = "if ((actual_dist < (dst * dst))) {\n    exit;\n}\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "if (actual_dist < dst * dst) {\n    exit;\n}\n");
});

void test("preserves parentheses that group mixed logical operators", async () => {
    const source = "if (a and (b or c)) {\n    exit;\n}\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "if (a and (b or c)) {\n    exit;\n}\n");
});

void test("omits redundant parentheses around grouped logical clauses when not needed", async () => {
    const source = "if ((a and b) or (c and d)) {\n    exit;\n}\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "if ((a and b) or (c and d)) {\n    exit;\n}\n");
});

void test("omits synthetic additive grouping on the left side of subtraction chains", async () => {
    const source = "var x_body = x + lengthdir_x(radius, angle) - lengthdir_x(radius, aa);\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "var x_body = x + lengthdir_x(radius, angle) - lengthdir_x(radius, aa);\n");
});

void test("preserves explicit additive grouping nested inside multiplicative terms", async () => {
    const source = "z_wobble = ((sin(current_time * 0.004) + 1) * 2) + 2;\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "z_wobble = ((sin(current_time * 0.004) + 1) * 2) + 2;\n");
});

void test("omits synthetic multiplicative parentheses in comparison operands", async () => {
    const source =
        "if ((actual_dist < dst * dst and push_out) or (actual_dist > dst * dst and pull_in)) {\n    exit;\n}\n";
    const formatted = await Format.format(source);

    assert.equal(
        formatted,
        "if ((actual_dist < dst * dst and push_out) or (actual_dist > dst * dst and pull_in)) {\n    exit;\n}\n"
    );
});

void test("omits redundant parentheses around a logical clause operand when precedence makes it unnecessary", async () => {
    const source = "if ((actual_dist > dst * dst) and pull_in) {\n    exit;\n}\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "if (actual_dist > dst * dst and pull_in) {\n    exit;\n}\n");
});

void test("preserves parentheses around a logical operand that would otherwise change grouping", async () => {
    const source = "if ((a or b) and c) {\n    exit;\n}\n";
    const formatted = await Format.format(source);

    assert.equal(formatted, "if ((a or b) and c) {\n    exit;\n}\n");
});

void test("reformats logical comparisons without introducing synthetic parentheses", async () => {
    const source = "if (i > 0 and i < 1) {\n    do_thing();\n}\n";
    const formatted = await Format.format(source);

    assert.strictEqual(formatted, "if (i > 0 and i < 1) {\n    do_thing();\n}\n");
});

void test("preserves explicit comparator grouping inside logical expressions", async () => {
    const source = "var myVal = (h < 0) or (h > 1);\n";
    const formatted = await Format.format(source);

    assert.strictEqual(formatted, source);
});
