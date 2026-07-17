import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyRepairInvalidTexturePointerGuardCodemod } = Refactor.RepairInvalidTexturePointerGuard;

const sourceWithFallback = [
    "function get_texture_info(sprite) {",
    "    var result_struct = { texture: -1, texel_w: 1, texel_h: 1 };",
    "    var texture_id = sprite_get_texture(sprite, 0);",
    "    if (!scr_texture_is_valid(texture_id)) {",
    '        throw "ERROR: Invalid or null texture pointer found";',
    "    }",
    "    return result_struct;",
    "}",
    ""
].join("\n");

void test("repairInvalidTexturePointerGuard returns the declared texture fallback", () => {
    const result = applyRepairInvalidTexturePointerGuardCodemod(sourceWithFallback);

    assert.equal(result.changed, true);
    assert.match(result.outputText, /if \(!scr_texture_is_valid\(texture_id\)\) \{\n {8}return result_struct;/u);
    assert.equal(result.appliedEdits.length, 1);
});

void test("repairInvalidTexturePointerGuard accepts parenthesized invalid-texture guards", () => {
    const source = sourceWithFallback.replace(
        "if (!scr_texture_is_valid(texture_id))",
        "if ((!scr_texture_is_valid(texture_id)))"
    );

    const result = applyRepairInvalidTexturePointerGuardCodemod(source);

    assert.equal(result.changed, true);
    assert.match(result.outputText, /return result_struct;/u);
});

void test("repairInvalidTexturePointerGuard skips guards without a texture fallback", () => {
    const source = [
        "function get_texture_info(sprite) {",
        "    var texture_id = sprite_get_texture(sprite, 0);",
        "    if (!scr_texture_is_valid(texture_id)) {",
        '        throw "ERROR: Invalid or null texture pointer found";',
        "    }",
        "    return texture_id;",
        "}",
        ""
    ].join("\n");

    const result = applyRepairInvalidTexturePointerGuardCodemod(source);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, source);
});

void test("repairInvalidTexturePointerGuard leaves unrelated invalid-pointer errors unchanged", () => {
    const source = sourceWithFallback.replace("Invalid or null texture pointer found", "Different texture error");

    const result = applyRepairInvalidTexturePointerGuardCodemod(source);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, source);
});

void test("executeConfiguredCodemods runs repairInvalidTexturePointerGuard", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/textures.gml"],
        config: {
            codemods: {
                repairInvalidTexturePointerGuard: {}
            }
        },
        readFile: async () => sourceWithFallback
    });

    assert.deepEqual(result.summaries, [
        {
            id: "repairInvalidTexturePointerGuard",
            changed: true,
            changedFiles: ["scripts/textures.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.match(result.appliedFiles.get("scripts/textures.gml") ?? "", /return result_struct;/u);
});
