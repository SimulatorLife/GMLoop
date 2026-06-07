import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace, recordValues } from "./test-project-helpers.js";

type IdentifierIndexEntry = {
    name?: string;
    declarations?: Array<{ name?: string }>;
    references?: Array<{ filePath?: string }>;
};

type IdentifierCollections = {
    enums: Record<string, IdentifierIndexEntry>;
    enumMembers: Record<string, IdentifierIndexEntry>;
    globalVariables: Record<string, IdentifierIndexEntry>;
    instanceVariables: Record<string, IdentifierIndexEntry>;
    macros: Record<string, IdentifierIndexEntry>;
    scripts: Record<string, IdentifierIndexEntry>;
};

type ScriptCall = { target: { name?: string } };

type ProjectIndexSnapshot = {
    identifiers: IdentifierCollections;
    files: Record<
        string,
        {
            scriptCalls: Array<{
                target: { name: string };
                isResolved?: boolean;
            }>;
            ignoredIdentifiers?: Array<{ name?: string; reason?: string }>;
        }
    >;
    relationships: {
        assetReferences: Array<{
            fromResourcePath?: string;
            targetPath?: string;
        }>;
        scriptCalls: ScriptCall[];
    };
    resources: Record<string, unknown>;
    scopes: Record<
        string,
        {
            declarations: Array<{ name?: string }>;
            scriptCalls: ScriptCall[];
        }
    >;
};

void test("buildProjectIndex collects symbols and relationships across project files", async () => {
    const { projectRoot, writeProjectFile, cleanup } = await createTempProjectWorkspace("gml-project-");

    try {
        await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));

        await writeProjectFile(
            "sprites/spr_enemy/spr_enemy.yy",
            JSON.stringify({
                resourceType: "GMSprite",
                name: "spr_enemy"
            })
        );

        await writeProjectFile(
            "scripts/calc_damage/calc_damage.yy",
            JSON.stringify({
                resourceType: "GMScript",
                name: "calc_damage"
            })
        );
        await writeProjectFile(
            "scripts/calc_damage/calc_damage.gml",
            "function calc_damage(target) {\n    return max(0, target.hp - target.armor);\n}\n"
        );

        await writeProjectFile(
            "scripts/meta/meta.yy",
            JSON.stringify({
                resourceType: "GMScript",
                name: "meta"
            })
        );
        await writeProjectFile(
            "scripts/meta/meta.gml",
            [
                "#macro MAX_ENEMIES 3",
                "globalvar enemy_limit;",
                "enum Difficulty {",
                "    Easy,",
                "    Hard",
                "}",
                "function meta() {",
                "    enemy_limit = MAX_ENEMIES;",
                "    return Difficulty.Hard;",
                "}",
                ""
            ].join("\n")
        );

        await writeProjectFile(
            "scripts/attack/attack.yy",
            JSON.stringify({
                resourceType: "GMScript",
                name: "attack"
            })
        );
        await writeProjectFile(
            "scripts/attack/attack.gml",
            ["function attack(target) {", "    var damage = calc_damage(target);", "    return damage;", "}", ""].join(
                "\n"
            )
        );

        await writeProjectFile(
            "objects/obj_enemy/obj_enemy.yy",
            JSON.stringify({
                resourceType: "GMObject",
                name: "obj_enemy",
                spriteId: {
                    name: "spr_enemy",
                    path: "sprites/spr_enemy/spr_enemy.yy"
                },
                eventList: [
                    {
                        name: "Create_0",
                        eventType: 0,
                        eventNum: 0,
                        eventId: {
                            name: "Create_0",
                            path: "objects/obj_enemy/obj_enemy_Create_0.gml"
                        }
                    },
                    {
                        name: "Step_0",
                        eventType: 3,
                        eventNum: 0,
                        eventId: {
                            name: "Step_0",
                            path: "objects/obj_enemy/obj_enemy_Step_0.gml"
                        }
                    }
                ]
            })
        );

        await writeProjectFile(
            "objects/obj_enemy/obj_enemy_Create_0.gml",
            ["hp = 100;", "attack(other);", "sprite_index = spr_enemy;", "enemy_limit = enemy_limit + 1;"].join("\n")
        );

        await writeProjectFile(
            "objects/obj_enemy/obj_enemy_Step_0.gml",
            ["if (hp <= 0) {", "    instance_destroy();", "}"].join("\n")
        );

        const index = (await buildProjectIndex(projectRoot)) as ProjectIndexSnapshot;

        assert.ok(index.resources["scripts/attack/attack.yy"], "expected attack resource to be indexed");
        assert.ok(index.resources["objects/obj_enemy/obj_enemy.yy"], "expected object resource to be indexed");

        const attackScope = index.scopes["scope:script:attack"];
        assert.ok(attackScope, "expected attack scope to be present");
        assert.ok(
            attackScope.declarations.some((decl) => decl.name === "attack"),
            "expected attack declaration to be captured"
        );

        const attackCalls = attackScope.scriptCalls.map((call) => call.target.name);
        assert.ok(attackCalls.includes("calc_damage"), "expected attack scope to record calc_damage call");

        const attackScript = index.identifiers.scripts["scope:script:attack"];
        assert.ok(attackScript, "expected script identifiers to be collected");
        assert.ok(attackScript.declarations.length > 0);

        const calcScript = index.identifiers.scripts["scope:script:calc_damage"];
        assert.ok(calcScript, "expected calc_damage script entry to exist");
        assert.ok(
            calcScript.references.some((reference) => reference.filePath === "scripts/attack/attack.gml"),
            "expected calc_damage to record references from attack"
        );

        const macroIdentifiers = index.identifiers.macros.MAX_ENEMIES;
        assert.ok(macroIdentifiers, "expected macro identifiers to be collected");
        assert.equal(macroIdentifiers.declarations.length, 1);
        assert.ok(macroIdentifiers.references.length > 0);

        const globalIdentifiers = index.identifiers.globalVariables.enemy_limit;
        assert.ok(globalIdentifiers, "expected global variable identifiers to be collected");
        assert.equal(globalIdentifiers.declarations.length, 1);
        assert.ok(globalIdentifiers.references.length > 0);

        const enumEntries = recordValues<IdentifierIndexEntry>(index.identifiers.enums);
        const difficultyEnum = enumEntries.find((entry) => entry.name === "Difficulty");
        assert.ok(difficultyEnum, "expected Difficulty enum to be indexed");
        assert.equal(difficultyEnum.declarations.length, 1);
        assert.ok(difficultyEnum.references.length > 0);

        const enumMemberEntries = recordValues<IdentifierIndexEntry>(index.identifiers.enumMembers);
        const hardMember = enumMemberEntries.find((entry) => entry.name === "Hard");
        assert.ok(hardMember, "expected enum member Hard to be indexed");
        assert.equal(hardMember.declarations.length, 1);
        assert.ok(hardMember.references.length > 0);

        const createFile = index.files["objects/obj_enemy/obj_enemy_Create_0.gml"];
        assert.ok(createFile, "expected create event file to be indexed");
        assert.equal(createFile.scriptCalls.length, 1);
        assert.equal(createFile.scriptCalls[0].target.name, "attack");
        assert.equal(createFile.scriptCalls[0].isResolved, true);

        const instanceEntries = recordValues<IdentifierIndexEntry>(index.identifiers.instanceVariables);
        const hpInstance = instanceEntries.find((entry) => entry.name === "hp");
        assert.ok(hpInstance, "expected hp instance assignment to be tracked");
        assert.ok(hpInstance.declarations.length > 0);

        const stepFile = index.files["objects/obj_enemy/obj_enemy_Step_0.gml"];
        assert.ok(stepFile, "expected step event file to be indexed");
        assert.equal(
            stepFile.scriptCalls.length,
            0,
            "expected built-in instance_destroy to be excluded from script calls"
        );

        const calcFile = index.files["scripts/calc_damage/calc_damage.gml"];
        assert.ok(calcFile, "expected calc_damage file to be indexed");
        assert.ok(
            calcFile.ignoredIdentifiers.some((entry) => entry.name === "max" && entry.reason === "built-in"),
            "expected built-in max to be ignored"
        );

        const scriptCallTargets = index.relationships.scriptCalls.map((call) => call.target.name);
        const sortedScriptCallTargets = [...scriptCallTargets].sort();
        assert.deepEqual(sortedScriptCallTargets, ["attack", "calc_damage"]);

        const spriteReference = index.relationships.assetReferences.find(
            (reference) => reference.targetPath === "sprites/spr_enemy/spr_enemy.yy"
        );
        assert.ok(spriteReference, "expected sprite asset reference to be recorded");
        assert.equal(spriteReference.fromResourcePath, "objects/obj_enemy/obj_enemy.yy");
    } finally {
        await cleanup();
    }
});
