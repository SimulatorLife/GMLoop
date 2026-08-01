import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { buildProjectIndex } from "../src/project-index/index.js";
import { resolveIdentifierCaseFixturesDirectory } from "./identifier-case-test-helpers.js";
import { createTempProjectWorkspace, recordValues } from "./test-project-helpers.js";

type IdentifierIndexEntry = { identifierId?: string; name?: string };

type IdentifierCollections = {
    enums: Record<string, IdentifierIndexEntry>;
    enumMembers: Record<string, IdentifierIndexEntry>;
    globalVariables: Record<string, IdentifierIndexEntry>;
    instanceVariables: Record<string, IdentifierIndexEntry>;
    macros: Record<string, IdentifierIndexEntry>;
    scripts: Record<string, IdentifierIndexEntry>;
};

type ProjectIndexSnapshot = { identifiers: IdentifierCollections };

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const fixturesDirectory = resolveIdentifierCaseFixturesDirectory(currentDirectory);
const scriptFixturePath = path.join(fixturesDirectory, "scope-identifier-collisions.gml");
const objectFixturePath = path.join(fixturesDirectory, "object-instance-collisions.gml");

async function createIdentifierFixtureProject() {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-scope-identifiers-");

    await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));

    await writeProjectFile(
        "scripts/scopeCollision/scopeCollision.yy",
        JSON.stringify({ resourceType: "GMScript", name: "scopeCollision" })
    );

    const scriptSource = await fs.readFile(scriptFixturePath, "utf8");
    await writeProjectFile("scripts/scopeCollision/scopeCollision.gml", scriptSource);

    await writeProjectFile(
        "objects/obj_tracker/obj_tracker.yy",
        JSON.stringify({
            resourceType: "GMObject",
            name: "obj_tracker",
            eventList: [
                {
                    name: "Step_0",
                    eventType: 3,
                    eventNum: 0,
                    eventId: {
                        name: "Step_0",
                        path: "objects/obj_tracker/obj_tracker_Step_0.gml"
                    }
                }
            ]
        })
    );

    const objectSource = await fs.readFile(objectFixturePath, "utf8");
    await writeProjectFile("objects/obj_tracker/obj_tracker_Step_0.gml", objectSource);

    return { projectRoot, cleanup };
}

void describe("project index identifier tracking", () => {
    void it("assigns identifier ids per scope and preserves collision entries", async () => {
        const { projectRoot, cleanup } = await createIdentifierFixtureProject();

        try {
            const index = (await buildProjectIndex(projectRoot)) as ProjectIndexSnapshot;

            const scriptEntry = index.identifiers.scripts["scope:script:scopeCollision"];
            assert.ok(scriptEntry, "expected scopeCollision script entry");
            assert.equal(scriptEntry.identifierId, "script:scope:script:scopeCollision");

            const macros = index.identifiers.macros;
            assert.ok(macros.MACRO_VALUE);
            assert.equal(macros.MACRO_VALUE.identifierId, "macro:MACRO_VALUE");
            assert.ok(macros.macro_value);
            assert.equal(macros.macro_value.identifierId, "macro:macro_value");
            assert.ok(macros.MacroValue);
            assert.equal(macros.MacroValue.identifierId, "macro:MacroValue");

            const globalVars = index.identifiers.globalVariables;
            assert.equal(globalVars.global_rate.identifierId, "global:global_rate");
            assert.equal(globalVars.GLOBAL_RATE.identifierId, "global:GLOBAL_RATE");

            const enumEntries = recordValues<IdentifierIndexEntry>(index.identifiers.enums);
            assert.ok(enumEntries.length >= 2, "expected enum entries");
            for (const entry of enumEntries) {
                assert.ok(entry.identifierId?.startsWith("enum:"), "expected enum identifier prefix");
            }

            const enumMembers = recordValues<IdentifierIndexEntry>(index.identifiers.enumMembers);
            const sharedMembers = enumMembers.filter((entry) => entry.name === "Bronze");
            assert.ok(sharedMembers.length >= 2);
            for (const member of sharedMembers) {
                assert.ok(member.identifierId?.startsWith("enum-member:"), "expected enum member identifier prefix");
            }

            const instanceEntries = recordValues<IdentifierIndexEntry>(index.identifiers.instanceVariables);
            const speedBonusNames = instanceEntries.filter((entry) =>
                ["speed_bonus", "SpeedBonus", "speedBonus"].includes(entry.name)
            );
            assert.equal(speedBonusNames.length, 3);
            for (const instance of speedBonusNames) {
                assert.ok(instance.identifierId?.startsWith("instance:"), "expected instance identifier prefix");
            }
        } finally {
            await cleanup();
        }
    });
});
