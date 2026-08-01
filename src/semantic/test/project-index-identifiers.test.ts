import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace, recordValues } from "./test-project-helpers.js";

type IdentifierIndexEntry = {
    identifierId?: string;
    name?: string;
    declarations?: Array<unknown>;
    references?: Array<unknown>;
};

type IdentifierCollections = {
    enums: Record<string, IdentifierIndexEntry>;
    globalVariables: Record<string, IdentifierIndexEntry>;
    instanceVariables: Record<string, IdentifierIndexEntry>;
    macros: Record<string, IdentifierIndexEntry>;
    scripts: Record<string, IdentifierIndexEntry>;
};

type ProjectIndexSnapshot = { identifiers: IdentifierCollections };

void test("buildProjectIndex assigns identifier ids for each scope", async () => {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-index-scope-");

    try {
        await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));

        await writeProjectFile(
            "scripts/scopeCollision/scopeCollision.yy",
            JSON.stringify({
                resourceType: "GMScript",
                name: "scopeCollision"
            })
        );

        await writeProjectFile(
            "scripts/scopeCollision/scopeCollision.gml",
            [
                "#macro MACRO_VALUE 10",
                "#macro macro_value 20",
                "globalvar global_rate, GLOBAL_RATE;",
                "global.GLOBALPOINT = 1;",
                "global.globalPoint = 2;",
                "enum RewardLevel {",
                "    Bronze,",
                "    bronze",
                "}",
                "function scopeCollision() {",
                "    var local_total = MACRO_VALUE + macro_value;",
                "    global_rate = local_total;",
                "    GLOBAL_RATE = globalPoint + GLOBALPOINT;",
                "    return RewardLevel.Bronze;",
                "}",
                ""
            ].join("\n")
        );

        await writeProjectFile(
            "objects/obj_tracker/obj_tracker.yy",
            JSON.stringify({
                resourceType: "GMObject",
                name: "obj_tracker",
                eventList: [
                    {
                        name: "Create_0",
                        eventType: 0,
                        eventNum: 0,
                        eventId: {
                            name: "Create_0",
                            path: "objects/obj_tracker/obj_tracker_Create_0.gml"
                        }
                    }
                ]
            })
        );

        await writeProjectFile(
            "objects/obj_tracker/obj_tracker_Create_0.gml",
            ["speed_bonus = 1;", "SpeedBonus = speed_bonus + 1;", "speedBonus = SpeedBonus + 1;", ""].join("\n")
        );

        const index = (await buildProjectIndex(projectRoot)) as ProjectIndexSnapshot;

        const scriptEntry = index.identifiers.scripts["scope:script:scopeCollision"];
        assert.ok(scriptEntry);
        assert.equal(scriptEntry.identifierId, "script:scope:script:scopeCollision");

        const macroUpper = index.identifiers.macros.MACRO_VALUE;
        assert.equal(macroUpper.identifierId, "macro:MACRO_VALUE");
        const macroLower = index.identifiers.macros.macro_value;
        assert.equal(macroLower.identifierId, "macro:macro_value");

        const globalLower = index.identifiers.globalVariables.global_rate;
        assert.equal(globalLower.identifierId, "global:global_rate");
        const globalUpper = index.identifiers.globalVariables.GLOBAL_RATE;
        assert.equal(globalUpper.identifierId, "global:GLOBAL_RATE");

        const enumEntries = recordValues<IdentifierIndexEntry>(index.identifiers.enums);
        assert.ok(enumEntries.length > 0);
        for (const entry of enumEntries) {
            assert.ok(entry.identifierId?.startsWith("enum:"));
        }

        const instanceEntries = recordValues<IdentifierIndexEntry>(index.identifiers.instanceVariables);
        const instanceIds = instanceEntries.map((entry) => entry.identifierId);
        assert.ok(instanceIds.every((id) => id?.startsWith("instance:")));
        const uniqueInstanceIds = new Set(instanceIds);
        assert.ok(uniqueInstanceIds.size >= 3);
    } finally {
        await cleanup();
    }
});
