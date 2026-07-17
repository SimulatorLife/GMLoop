import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyRepairSpriteTextureUvResolutionCodemod } = Refactor.RepairSpriteTextureUvResolution;

const sourceText = [
    "function scr_get_uvs(st, subimg = 0) {",
    "    var raw_uvs = undefined;",
    "    if (!is_real(st) or st >= 0) {",
    "        if (scr_texture_is_valid(st)) {",
    "            raw_uvs = texture_get_uvs(st);",
    "        } else if (scr_sprite_exists(st)) {",
    "            raw_uvs = sprite_get_uvs(st, subimg);",
    "        } else {",
    '            LOG.warn("Unexpected texture value");',
    "        }",
    "    }",
    "    return raw_uvs;",
    "}",
    ""
].join("\n");

void test("repairSpriteTextureUvResolution resolves sprites before numeric texture handles", () => {
    const result = applyRepairSpriteTextureUvResolutionCodemod(sourceText);

    assert.equal(result.changed, true);
    assert.match(
        result.outputText,
        /if \(is_real\(st\) and st >= 0 and scr_sprite_exists\(st\)\) \{\n {12}raw_uvs = sprite_get_uvs\(st, subimg\);\n {8}\} else if \(is_ptr\(st\) and not is_real\(st\) and scr_texture_is_valid\(st\)\)/u
    );
    assert.match(result.outputText, /else \{\n {12}LOG\.warn\("Unexpected texture value"\);/u);
    assert.equal(result.appliedEdits.length, 1);
});

void test("repairSpriteTextureUvResolution is idempotent", () => {
    const firstResult = applyRepairSpriteTextureUvResolutionCodemod(sourceText);
    const secondResult = applyRepairSpriteTextureUvResolutionCodemod(firstResult.outputText);

    assert.equal(secondResult.changed, false);
    assert.equal(secondResult.outputText, firstResult.outputText);
});

void test("repairSpriteTextureUvResolution guards an already sprite-first branch once", () => {
    const spriteFirstSource = sourceText.replace(
        "if (scr_texture_is_valid(st)) {\n            raw_uvs = texture_get_uvs(st);\n        } else if (scr_sprite_exists(st)) {\n            raw_uvs = sprite_get_uvs(st, subimg);",
        "if (scr_sprite_exists(st)) {\n            raw_uvs = sprite_get_uvs(st, subimg);\n        } else if (scr_texture_is_valid(st)) {\n            raw_uvs = texture_get_uvs(st);"
    );

    const result = applyRepairSpriteTextureUvResolutionCodemod(spriteFirstSource);

    assert.equal(result.changed, true);
    assert.equal((result.outputText.match(/scr_sprite_exists\(st\)/gu) ?? []).length, 1);
    assert.equal((result.outputText.match(/scr_texture_is_valid\(st\)/gu) ?? []).length, 1);
    assert.match(
        result.outputText,
        /if \(is_real\(st\) and st >= 0 and scr_sprite_exists\(st\)\) \{[\s\S]*?else if \(is_ptr\(st\) and not is_real\(st\) and scr_texture_is_valid\(st\)\)/u
    );
});

void test("repairSpriteTextureUvResolution leaves unrelated helpers unchanged", () => {
    const source = sourceText.replace("function scr_get_uvs", "function resolve_uvs");
    const result = applyRepairSpriteTextureUvResolutionCodemod(source);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, source);
});

void test("executeConfiguredCodemods runs repairSpriteTextureUvResolution", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/group_vertex_buffers/group_vertex_buffers.gml"],
        config: {
            codemods: {
                repairSpriteTextureUvResolution: {}
            }
        },
        readFile: async () => sourceText
    });

    assert.deepEqual(result.summaries, [
        {
            id: "repairSpriteTextureUvResolution",
            changed: true,
            changedFiles: ["scripts/group_vertex_buffers/group_vertex_buffers.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.match(
        result.appliedFiles.get("scripts/group_vertex_buffers/group_vertex_buffers.gml") ?? "",
        /scr_sprite_exists/u
    );
});
