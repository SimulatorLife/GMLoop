import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace, recordValues } from "./test-project-helpers.js";

type InstanceVariableOccurrence = {
    filePath?: string;
    start?: { index?: number };
};

type InstanceVariableEntry = {
    declarations?: Array<InstanceVariableOccurrence>;
    name?: string;
    references?: Array<InstanceVariableOccurrence>;
    scopeId?: string;
};

type ProjectIndexSnapshot = {
    identifiers: {
        instanceVariables: Record<string, InstanceVariableEntry>;
    };
};

void test("buildProjectIndex resolves constructor instance variables inside static methods", async () => {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace(
        "gml-constructor-instance-variables-"
    );
    const sourceText = [
        "function ActorSoundManager() constructor {",
        "    sounds = {};",
        "    self.volume = 1;",
        "    visible = true;",
        "    show_debug_message(sounds);",
        "    static set_sounds = function (sound_action) {",
        "        struct_set(sounds, sound_action, []);",
        "        self.volume = 0.5;",
        "    };",
        "    static shadowed_parameter = function (sounds) { return sounds; };",
        "    static shadowed_local = function () { var sounds = []; return sounds; };",
        "}",
        "function OtherManager() constructor {",
        "    sounds = [];",
        "    static get_sounds = function () { return sounds; };",
        "}",
        ""
    ].join("\n");

    try {
        await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));
        await writeProjectFile(
            "scripts/ActorSoundManager/ActorSoundManager.yy",
            JSON.stringify({ name: "ActorSoundManager", resourceType: "GMScript" })
        );
        await writeProjectFile("scripts/ActorSoundManager/ActorSoundManager.gml", sourceText);

        const index = (await buildProjectIndex(projectRoot)) as ProjectIndexSnapshot;
        const entries = recordValues(index.identifiers.instanceVariables);
        const soundsEntries = entries.filter((entry) => entry.name === "sounds");
        const sounds = soundsEntries.find((entry) => entry.scopeId?.includes("ActorSoundManager"));
        const volume = entries.find((entry) => entry.name === "volume");

        assert.equal(soundsEntries.length, 2, "expected same-named fields in sibling constructors to stay distinct");
        assert.ok(sounds, "expected constructor-owned sounds entry");
        assert.equal(sounds.declarations?.length, 1);
        assert.deepEqual(
            sounds.references?.map((reference) => reference.start?.index),
            [
                sourceText.indexOf("sounds", sourceText.indexOf("show_debug_message")),
                sourceText.indexOf("sounds", sourceText.indexOf("struct_set"))
            ]
        );

        assert.ok(volume, "expected explicit self.volume entry");
        assert.equal(volume.declarations?.length, 1);
        assert.deepEqual(
            volume.references?.map((reference) => reference.start?.index),
            [sourceText.lastIndexOf("volume")]
        );
        assert.equal(
            entries.some((entry) => entry.name === "visible"),
            false,
            "built-ins must keep runtime ownership"
        );
    } finally {
        await cleanup();
    }
});
