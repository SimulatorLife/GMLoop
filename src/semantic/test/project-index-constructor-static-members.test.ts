import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace, recordValues } from "./test-project-helpers.js";

type ConstructorStaticMemberEntry = {
    constructorName?: string;
    name?: string;
    declarations?: Array<{ filePath?: string; name?: string }>;
    references?: Array<{ filePath?: string; name?: string }>;
};

type ProjectIndexSnapshot = {
    identifiers: {
        constructorStaticMembers: Record<string, ConstructorStaticMemberEntry>;
        structVariables: Record<string, { name?: string }>;
    };
};

void test("buildProjectIndex resolves constructor-owned receiver static member references", async () => {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-static-members-");

    try {
        await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));
        await writeProjectFile(
            "scripts/TimerMultiplier/TimerMultiplier.yy",
            JSON.stringify({ name: "TimerMultiplier", resourceType: "GMScript" })
        );
        await writeProjectFile(
            "scripts/TimerMultiplier/TimerMultiplier.gml",
            [
                "function TimerMultiplier() constructor {",
                "    static get_multiplier = function() { return 1; };",
                "    static set_multiplier = function(value) { return value; };",
                "}",
                ""
            ].join("\n")
        );
        await writeProjectFile(
            "scripts/CurveHandlerTimed/CurveHandlerTimed.yy",
            JSON.stringify({ name: "CurveHandlerTimed", resourceType: "GMScript" })
        );
        await writeProjectFile(
            "scripts/CurveHandlerTimed/CurveHandlerTimed.gml",
            [
                "function CurveHandlerTimed() constructor {",
                "    self.timer = new TimerMultiplier();",
                "    self.other_timer = new OtherTimer();",
                "",
                "    static set_curve_config = function(speed_multiplier) {",
                "        timer.get_multiplier();",
                "        self.timer.set_multiplier(speed_multiplier);",
                "    };",
                "",
                "    static shadowed_timer = function(timer) {",
                "        timer.get_multiplier();",
                "    };",
                "",
                "    static unknown_timer = function(source) {",
                "        source.get_multiplier();",
                "    };",
                "}",
                ""
            ].join("\n")
        );
        await writeProjectFile(
            "scripts/OtherTimer/OtherTimer.yy",
            JSON.stringify({ name: "OtherTimer", resourceType: "GMScript" })
        );
        await writeProjectFile(
            "scripts/OtherTimer/OtherTimer.gml",
            [
                "function OtherTimer() constructor {",
                "    static get_multiplier = function() { return 2; };",
                "}",
                ""
            ].join("\n")
        );

        const index = (await buildProjectIndex(projectRoot)) as ProjectIndexSnapshot;
        const entries = recordValues(index.identifiers.constructorStaticMembers);
        const structVariableNames = new Set(recordValues(index.identifiers.structVariables).map((entry) => entry.name));
        const timerGet = entries.find(
            (entry) => entry.constructorName === "TimerMultiplier" && entry.name === "get_multiplier"
        );
        const timerSet = entries.find(
            (entry) => entry.constructorName === "TimerMultiplier" && entry.name === "set_multiplier"
        );
        const otherGet = entries.find(
            (entry) => entry.constructorName === "OtherTimer" && entry.name === "get_multiplier"
        );

        assert.ok(timerGet, "expected TimerMultiplier.get_multiplier entry");
        assert.equal(timerGet.declarations?.length, 1);
        assert.deepEqual(
            timerGet.references?.map((reference) => reference.filePath),
            ["scripts/CurveHandlerTimed/CurveHandlerTimed.gml"],
            "expected only the unshadowed typed receiver call to resolve"
        );

        assert.ok(timerSet, "expected TimerMultiplier.set_multiplier entry");
        assert.equal(timerSet.declarations?.length, 1);
        assert.deepEqual(
            timerSet.references?.map((reference) => reference.filePath),
            ["scripts/CurveHandlerTimed/CurveHandlerTimed.gml"]
        );

        assert.ok(otherGet, "expected OtherTimer.get_multiplier entry");
        assert.equal(otherGet.declarations?.length, 1);
        assert.deepEqual(otherGet.references, []);
        assert.equal(structVariableNames.has("get_multiplier"), false);
        assert.equal(structVariableNames.has("set_multiplier"), false);
    } finally {
        await cleanup();
    }
});
