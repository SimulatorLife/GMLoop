import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyRepairTexturePrefetchGuardCodemod } = Refactor.RepairTexturePrefetchGuard;

void test("repairTexturePrefetchGuard inverts the block-form readiness guard", () => {
    const sourceText = [
        "function prefetch_if_needed(texture) {",
        "    if (texture_is_ready(texture)) {",
        "        texture_prefetch(texture);",
        "        return true;",
        "    } else {",
        "        return false;",
        "    }",
        "}",
        ""
    ].join("\n");

    const result = applyRepairTexturePrefetchGuardCodemod(sourceText);

    assert.equal(result.changed, true);
    assert.match(result.outputText, /if \(!texture_is_ready\(texture\)\)/u);
    assert.equal(result.appliedEdits.length, 1);
});

void test("repairTexturePrefetchGuard handles a single-statement prefetch branch", () => {
    const sourceText = "if (texture_is_ready(texture)) texture_prefetch(texture);\n";
    const result = applyRepairTexturePrefetchGuardCodemod(sourceText);

    assert.equal(result.outputText, "if (!texture_is_ready(texture)) texture_prefetch(texture);\n");
});

void test("repairTexturePrefetchGuard requires the same texture argument", () => {
    const sourceText = "if (texture_is_ready(texture)) texture_prefetch(other_texture);\n";
    const result = applyRepairTexturePrefetchGuardCodemod(sourceText);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, sourceText);
});

void test("repairTexturePrefetchGuard skips built-in-name macros and declarations", () => {
    const macroSource =
        "#macro texture_is_ready custom_ready\nif (texture_is_ready(texture)) texture_prefetch(texture);\n";
    const declarationSource = [
        "function texture_is_ready(texture) { return true; }",
        "if (texture_is_ready(texture)) texture_prefetch(texture);",
        ""
    ].join("\n");

    assert.equal(applyRepairTexturePrefetchGuardCodemod(macroSource).changed, false);
    assert.equal(applyRepairTexturePrefetchGuardCodemod(declarationSource).changed, false);
});

void test("executeConfiguredCodemods runs repairTexturePrefetchGuard", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["scripts/textures.gml"],
        config: {
            codemods: {
                repairTexturePrefetchGuard: {}
            }
        },
        readFile: async () => "if (texture_is_ready(texture)) texture_prefetch(texture);\n"
    });

    assert.deepEqual(result.summaries, [
        {
            id: "repairTexturePrefetchGuard",
            changed: true,
            changedFiles: ["scripts/textures.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.equal(
        result.appliedFiles.get("scripts/textures.gml"),
        "if (!texture_is_ready(texture)) texture_prefetch(texture);\n"
    );
});
