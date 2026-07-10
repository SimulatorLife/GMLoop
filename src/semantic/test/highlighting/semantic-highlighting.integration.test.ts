import assert from "node:assert/strict";
import test from "node:test";

import { collectGmlSemanticHighlights } from "../../src/highlighting/index.js";
import { buildProjectNavigationIndex } from "../../src/navigation/index.js";
import { createTempProjectWorkspace } from "../test-project-helpers.js";

void test("semantic highlighting covers constructor fields and static function members", async () => {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-highlighting-members-");
    const sourceText = [
        "function ActorSoundManager() : Object() constructor {",
        "    sounds = {};",
        "    static add_sounds = function(sound_action) {",
        "        var sound_list = struct_get(sounds, sound_action);",
        "    };",
        "}",
        ""
    ].join("\n");

    try {
        await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));
        await writeProjectFile(
            "scripts/ActorSoundManager/ActorSoundManager.yy",
            JSON.stringify({ name: "ActorSoundManager", resourceType: "GMScript" })
        );
        const filePath = await writeProjectFile("scripts/ActorSoundManager/ActorSoundManager.gml", sourceText);
        const index = await buildProjectNavigationIndex(projectRoot);
        const occurrences = index.occurrencesByFilePath.get(filePath) ?? [];
        const tokens = collectGmlSemanticHighlights({
            sourceText,
            builtIns: [],
            projectIdentifiers: [],
            occurrences: occurrences.map((occurrence) => ({
                start: occurrence.location.range.start,
                end: occurrence.location.range.end,
                kind: occurrence.kind,
                role: occurrence.role
            }))
        });
        const tokensByText = new Map(tokens.map((token) => [sourceText.slice(token.start, token.end), token]));

        assert.equal(tokensByText.get("sounds")?.kind, "property");
        assert.equal(tokensByText.get("add_sounds")?.kind, "method");
        assert.ok(tokensByText.get("add_sounds")?.modifiers.includes("static"));
    } finally {
        await cleanup();
    }
});
