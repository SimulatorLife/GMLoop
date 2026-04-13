import assert from "node:assert/strict";
import test from "node:test";

import { analyseResourceFiles } from "../src/project-index/resource-analysis.js";

void test("analyseResourceFiles normalizes invalid resource metadata", async () => {
    const projectRoot = "/project";
    const relativePath = "scripts/calc_damage/calc_damage.yy";
    const absolutePath = `${projectRoot}/${relativePath}`;

    const yyFiles = [
        {
            relativePath,
            absolutePath
        }
    ];

    const fsFacade = {
        async readFile(path) {
            assert.equal(path, absolutePath, "expected resource document to be read");

            return JSON.stringify({
                name: { text: "calc_damage" },
                resourceType: "GMScript"
            });
        }
    };

    const context = await analyseResourceFiles({
        projectRoot,
        yyFiles,
        fsFacade
    });

    const resourceRecord = context.resourcesMap.get(relativePath);
    assert.ok(resourceRecord, "expected resource record to be captured");
    assert.equal(resourceRecord.name, "calc_damage", "expected invalid resource name to fall back to the file stem");
    assert.equal(resourceRecord.resourceType, "GMScript", "expected resource type to remain intact");

    const scopeId = context.scriptNameToScopeId.get("calc_damage");
    assert.ok(
        scopeId?.startsWith("scope:script:"),
        "expected script scope identifier to be recorded with fallback name"
    );

    const resourcePath = context.scriptNameToResourcePath.get("calc_damage");
    assert.equal(resourcePath, resourceRecord.path, "expected script path lookup to reuse normalized resource name");
});

void test("analyseResourceFiles captures project manifest resource references", async () => {
    const projectRoot = "/project";
    const relativePath = "MyGame.yyp";
    const absolutePath = `${projectRoot}/${relativePath}`;
    const scriptPath = "scripts/demo_script/demo_script.yy";

    const context = await analyseResourceFiles({
        projectRoot,
        yyFiles: [{ relativePath, absolutePath }],
        fsFacade: {
            async readFile(readPath) {
                assert.equal(readPath, absolutePath);

                return JSON.stringify({
                    name: "MyGame",
                    resourceType: "GMProject",
                    resources: [{ id: { name: "demo_script", path: scriptPath } }],
                    RoomOrderNodes: [{ roomId: { name: "rm_start", path: "rooms/rm_start/rm_start.yy" } }],
                    Options: [{ name: "Main", path: "options/main/options_main.yy" }],
                    Folders: [{ name: "Scripts", folderPath: "folders/Scripts.yy" }]
                });
            }
        }
    });

    const manifestReferences = context.assetReferences.filter((entry) => entry.fromResourcePath === relativePath);
    assert.equal(manifestReferences.length, 4);
    assert.ok(
        manifestReferences.some((entry) => entry.propertyPath === "resources.0.id" && entry.targetPath === scriptPath)
    );
    assert.ok(
        manifestReferences.some(
            (entry) =>
                entry.propertyPath === "RoomOrderNodes.0.roomId" && entry.targetPath === "rooms/rm_start/rm_start.yy"
        )
    );
    assert.ok(
        manifestReferences.some(
            (entry) => entry.propertyPath === "Options.0.path" && entry.targetPath === "options/main/options_main.yy"
        )
    );
    assert.ok(
        manifestReferences.some(
            (entry) => entry.propertyPath === "Folders.0.folderPath" && entry.targetPath === "folders/Scripts.yy"
        )
    );
});

void test("analyseResourceFiles limits object references to supported resource-id fields", async () => {
    const projectRoot = "/project";
    const relativePath = "objects/obj_controller/obj_controller.yy";
    const absolutePath = `${projectRoot}/${relativePath}`;
    const spritePath = "sprites/spr_player/spr_player.yy";
    const scriptPath = "scripts/demo_script/demo_script.yy";

    const context = await analyseResourceFiles({
        projectRoot,
        yyFiles: [{ relativePath, absolutePath }],
        fsFacade: {
            async readFile(readPath) {
                assert.equal(readPath, absolutePath);

                return JSON.stringify({
                    name: "obj_controller",
                    resourceType: "GMObject",
                    parent: {
                        name: "Objects",
                        path: "folders/Objects.yy"
                    },
                    spriteId: {
                        name: "spr_player",
                        path: spritePath
                    },
                    scriptExecute: {
                        name: "demo_script",
                        path: scriptPath
                    },
                    eventList: [
                        {
                            eventId: {
                                name: "Step_0",
                                path: "objects/obj_controller/obj_controller_Step_0.gml"
                            }
                        }
                    ]
                });
            }
        }
    });

    const objectReferences = context.assetReferences.filter((entry) => entry.fromResourcePath === relativePath);
    assert.equal(objectReferences.length, 2);
    assert.ok(objectReferences.some((entry) => entry.propertyPath === "spriteId" && entry.targetPath === spritePath));
    assert.ok(
        objectReferences.some((entry) => entry.propertyPath === "scriptExecute" && entry.targetPath === scriptPath)
    );
    assert.ok(objectReferences.every((entry) => !entry.targetPath.endsWith(".gml")));
    assert.ok(objectReferences.every((entry) => !entry.targetPath.startsWith("folders/")));
});

void test("analyseResourceFiles captures sprite keyframe Id references", async () => {
    const projectRoot = "/project";
    const relativePath = "sprites/sArm/sArm.yy";
    const absolutePath = `${projectRoot}/${relativePath}`;

    const context = await analyseResourceFiles({
        projectRoot,
        yyFiles: [{ relativePath, absolutePath }],
        fsFacade: {
            async readFile(readPath) {
                assert.equal(readPath, absolutePath);

                return JSON.stringify({
                    name: "sArm",
                    resourceType: "GMSprite",
                    sequence: {
                        tracks: [
                            {
                                keyframes: {
                                    Keyframes: [
                                        {
                                            Channels: {
                                                "0": {
                                                    Id: {
                                                        name: "39cfd82d-bb0b-4447-a5ee-669873fd3d89",
                                                        path: "sprites/sArm/sArm.yy"
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                });
            }
        }
    });

    const spriteReferences = context.assetReferences.filter((entry) => entry.fromResourcePath === relativePath);
    assert.ok(
        spriteReferences.some(
            (entry) =>
                entry.propertyPath === "sequence.tracks.0.keyframes.Keyframes.0.Channels.0.Id" &&
                entry.targetPath === relativePath &&
                entry.targetName === "39cfd82d-bb0b-4447-a5ee-669873fd3d89"
        )
    );
});
