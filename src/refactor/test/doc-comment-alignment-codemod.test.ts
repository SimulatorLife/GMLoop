import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyDocCommentAlignmentCodemod } = Refactor.DocCommentAlignment;

void test("applyDocCommentAlignmentCodemod aligns doc @param names and order", () => {
    const sourceText = [
        "/// @param oldName old value",
        "/// @param y y value",
        "function sample(x, y) {",
        "    return x + y;",
        "}",
        ""
    ].join("\n");
    const result = applyDocCommentAlignmentCodemod(sourceText);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param x old value",
            "/// @param y y value",
            "function sample(x, y) {",
            "    return x + y;",
            "}",
            ""
        ].join("\n")
    );
});

void test("applyDocCommentAlignmentCodemod marks defaulted params as optional", () => {
    const sourceText = [
        "/// @param count item count",
        "/// @param mode operation mode",
        'function sample(count, mode = "fast") {',
        "    return mode;",
        "}",
        ""
    ].join("\n");
    const result = applyDocCommentAlignmentCodemod(sourceText);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param count item count",
            "/// @param [mode] operation mode",
            'function sample(count, mode = "fast") {',
            "    return mode;",
            "}",
            ""
        ].join("\n")
    );
});

void test("executeConfiguredCodemods runs docCommentAlignment codemod", async () => {
    const sourceText = [
        "/// @param b value b",
        "/// @param a value a",
        "function sample(a, b) {",
        "    return a + b;",
        "}",
        ""
    ].join("\n");
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/example.gml"],
        config: {
            codemods: {
                docCommentAlignment: {}
            }
        },
        readFile: async () => sourceText
    });

    assert.deepEqual(result.summaries, [
        {
            id: "docCommentAlignment",
            changed: true,
            changedFiles: ["scripts/example.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.match(result.appliedFiles.get("scripts/example.gml") ?? "", /@param a value a/);
    assert.match(result.appliedFiles.get("scripts/example.gml") ?? "", /@param b value b/);
});

void test("applyDocCommentAlignmentCodemod preserves optional parameter defaults and descriptions", () => {
    const sourceText = [
        "/// @param {real} x - The x coordinate",
        "/// @param {real} y - The y coordinate",
        "/// @param {real} z - The z coordinate",
        "/// @param {Asset.GMObject} prop_index - The prop index",
        "/// @param {real} *shoot_angle - The direction to shoot towards. Will be random if not provided.",
        "/// @param {real} [bonus_damage=0] - Additional damage for the projectile to deal.",
        "/// @param {real} [speed_multiplier=1]",
        "/// @param {real} [bonus_knockback=0] - A bonus to add to the projectile's default knockback",
        "function scr_create_projectile(x, y, z, prop_index, shoot_angle = irandom(359), bonus_damage = 0, speed_multiplier = 1, bonus_knockback = 0) {",
        "    return 0;",
        "}",
        ""
    ].join("\n");
    const result = applyDocCommentAlignmentCodemod(sourceText);
    assert.equal(result.changed, false);
});

void test("applyDocCommentAlignmentCodemod aligns renamed parameters while preserving defaults and asterisks", () => {
    const sourceText = [
        "/// @param {real} *old_angle",
        "/// @param {real} [old_damage=0] - old description",
        "function sample(new_angle = 90, new_damage = 0) {",
        "    return 0;",
        "}",
        ""
    ].join("\n");
    const result = applyDocCommentAlignmentCodemod(sourceText);
    assert.equal(result.changed, true);
    assert.equal(
        result.outputText,
        [
            "/// @param {real} *new_angle",
            "/// @param {real} [new_damage=0] - old description",
            "function sample(new_angle = 90, new_damage = 0) {",
            "    return 0;",
            "}",
            ""
        ].join("\n")
    );
});
