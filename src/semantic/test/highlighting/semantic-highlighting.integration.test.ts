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
        "    /// @function add_sounds",
        "    /// @param {enum} sound_action",
        "    /// @description Add possible options for sound effects.",
        "    /// @returns {undefined}",
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
        const addSoundsSymbol = index.symbols.find((symbol) => symbol.name === "add_sounds");
        assert.equal(addSoundsSymbol?.documentation.description, "Add possible options for sound effects.");
        assert.deepEqual(addSoundsSymbol?.documentation.parameters, [
            { description: null, name: "sound_action", type: "enum" }
        ]);
        assert.deepEqual(addSoundsSymbol?.documentation.returns, { description: null, type: "undefined" });
    } finally {
        await cleanup();
    }
});

void test("semantic highlighting covers macros, enums, parameters, locals, and their references", async () => {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-highlighting-complete-");
    const sourceText = [
        "#macro DAMAGE_SCALE 2",
        "enum eAIState { idle = 0, attack_target = 1 }",
        "function choose_state(next_state) {",
        "    var local_state = eAIState.idle;",
        "    return next_state == eAIState.attack_target ? local_state : DAMAGE_SCALE;",
        "}",
        ""
    ].join("\n");
    try {
        await writeProjectFile("Game.yyp", JSON.stringify({ name: "Game", resourceType: "GMProject" }));
        const filePath = await writeProjectFile("scripts/state/state.gml", sourceText);
        const index = await buildProjectNavigationIndex(projectRoot);
        const occurrences = index.occurrencesByFilePath.get(filePath) ?? [];
        const tokens = collectGmlSemanticHighlights({
            sourceText,
            builtIns: [{ deprecated: false, name: "IDLE", type: "function" }],
            projectIdentifiers: [],
            occurrences: occurrences.map((occurrence) => ({
                start: occurrence.location.range.start,
                end: occurrence.location.range.end,
                kind: occurrence.kind,
                role: occurrence.role
            }))
        });
        const tokenAt = (text: string, occurrence = 0) => {
            let offset = -1;
            for (let occurrenceIndex = 0; occurrenceIndex <= occurrence; occurrenceIndex += 1) {
                offset = sourceText.indexOf(text, offset + 1);
            }
            return tokens.find((token) => token.start === offset);
        };
        assert.equal(tokenAt("DAMAGE_SCALE")?.kind, "macro");
        assert.equal(tokenAt("DAMAGE_SCALE", 1)?.kind, "macro");
        assert.equal(tokenAt("idle")?.kind, "enumMember");
        assert.equal(tokenAt("idle", 1)?.kind, "enumMember");
        assert.equal(tokenAt("attack_target")?.kind, "enumMember");
        assert.equal(tokenAt("attack_target", 1)?.kind, "enumMember");
        assert.equal(tokenAt("next_state")?.kind, "parameter");
        assert.equal(tokenAt("next_state", 1)?.kind, "parameter");
        assert.equal(tokenAt("local_state")?.kind, "variable");
        assert.equal(tokenAt("local_state", 1)?.kind, "variable");
    } finally {
        await cleanup();
    }
});
