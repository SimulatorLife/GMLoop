import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyRepairAudioEmitterCreationGuardCodemod } = Refactor.RepairAudioEmitterCreationGuard;

const sourceText = [
    "function initialize_sound() {",
    "    var emitter = audio_emitter_create();",
    "    return emitter;",
    "}",
    ""
].join("\n");

void test("repairAudioEmitterCreationGuard wraps direct emitter creation", () => {
    const result = applyRepairAudioEmitterCreationGuardCodemod(sourceText);

    assert.equal(result.changed, true);
    assert.match(result.outputText, /var emitter = audio_system_is_initialised\(\) \? audio_emitter_create\(\) : -1;/u);
    assert.equal(result.appliedEdits.length, 1);
});

void test("repairAudioEmitterCreationGuard leaves an existing readiness guard unchanged", () => {
    const guardedSource = "var emitter = audio_system_is_initialised() ? audio_emitter_create() : -1;\n";
    const result = applyRepairAudioEmitterCreationGuardCodemod(guardedSource);

    assert.equal(result.changed, false);
    assert.equal(result.outputText, guardedSource);
});

void test("repairAudioEmitterCreationGuard skips user-defined names and macros", () => {
    const macroSource = "#macro audio_emitter_create custom_create\nvar emitter = audio_emitter_create();\n";
    const declarationSource = [
        "function audio_emitter_create() { return 1; }",
        "var emitter = audio_emitter_create();",
        ""
    ].join("\n");

    assert.equal(applyRepairAudioEmitterCreationGuardCodemod(macroSource).changed, false);
    assert.equal(applyRepairAudioEmitterCreationGuardCodemod(declarationSource).changed, false);
});

void test("executeConfiguredCodemods runs repairAudioEmitterCreationGuard", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeConfiguredCodemods({
        projectRoot: "/project",
        targetPaths: ["/project"],
        gmlFilePaths: ["objects/obj_sound_controller/Create_0.gml"],
        config: {
            codemods: {
                repairAudioEmitterCreationGuard: {}
            }
        },
        readFile: async () => sourceText
    });

    assert.deepEqual(result.summaries, [
        {
            id: "repairAudioEmitterCreationGuard",
            changed: true,
            changedFiles: ["objects/obj_sound_controller/Create_0.gml"],
            warnings: [],
            errors: []
        }
    ]);
    assert.match(
        result.appliedFiles.get("objects/obj_sound_controller/Create_0.gml") ?? "",
        /audio_system_is_initialised/u
    );
});
