import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";

const { fromPosixPath } = Core;

void describe("asset rename utilities", () => {
    void it("renames script assets and updates dependent resource metadata atomically", async () => {
        const projectRoot = await createSyntheticProject();

        try {
            const projectIndex = await Semantic.buildProjectIndex(projectRoot);

            const { renames, conflicts } = Semantic.planAssetRenames({
                projectIndex,
                assetStyle: "pascal"
            });

            assert.deepStrictEqual(conflicts, []);
            const scriptRename = renames.find((rename) => rename.resourcePath === "scripts/demo_script/demo_script.yy");
            assert.ok(scriptRename, "Expected the script resource to be included in the rename plan");
            const resolvedScriptRename = scriptRename;

            const result = Semantic.applyAssetRenames({
                projectIndex,
                renames: [resolvedScriptRename]
            });

            assert.ok(result.renames.length > 0, "Expected rename actions to be recorded");

            const renamedYyRelative = "scripts/demo_script/DemoScript.yy";
            const renamedGmlRelative = "scripts/demo_script/DemoScript.gml";
            const renamedYyPath = path.join(projectRoot, fromPosixPath(renamedYyRelative));
            const renamedGmlPath = path.join(projectRoot, fromPosixPath(renamedGmlRelative));

            await assertRejectsNotFound(path.join(projectRoot, "scripts/demo_script/demo_script.yy"));
            await assertRejectsNotFound(path.join(projectRoot, "scripts/demo_script/demo_script.gml"));

            const scriptData = Semantic.parseProjectMetadataDocument(
                await fs.readFile(renamedYyPath, "utf8"),
                renamedYyPath
            );
            assert.strictEqual(scriptData.name, "DemoScript");
            assert.strictEqual(scriptData.resourcePath, renamedYyRelative);
            assert.deepStrictEqual(scriptData.linkedScript, {
                path: renamedYyRelative,
                name: "DemoScript"
            });

            const projectManifestPath = path.join(projectRoot, "MyGame.yyp");
            const projectData = Semantic.parseProjectMetadataDocument(
                await fs.readFile(projectManifestPath, "utf8"),
                projectManifestPath
            );
            assert.strictEqual(projectData.resources[0].id.path, renamedYyRelative);
            assert.strictEqual(projectData.resources[0].id.name, "DemoScript");

            const objectPath = path.join(projectRoot, fromPosixPath("objects/obj_controller/obj_controller.yy"));
            const objectData = Semantic.parseProjectMetadataDocument(await fs.readFile(objectPath, "utf8"), objectPath);
            assert.deepStrictEqual(objectData.scriptExecute, {
                path: renamedYyRelative,
                name: "DemoScript"
            });
            assert.deepStrictEqual(objectData.eventList[0].actionList[0].script, {
                path: renamedYyRelative,
                name: "DemoScript"
            });

            const roomPath = path.join(projectRoot, fromPosixPath("rooms/room_start/room_start.yy"));
            const roomData = Semantic.parseProjectMetadataDocument(await fs.readFile(roomPath, "utf8"), roomPath);
            assert.deepStrictEqual(roomData.creationCodeScript, {
                path: renamedYyRelative,
                name: "DemoScript"
            });
            assert.deepStrictEqual(roomData.layers[0].instances[0].creationCodeScript, {
                path: renamedYyRelative,
                name: "DemoScript"
            });

            const gmlContent = await fs.readFile(renamedGmlPath, "utf8");
            assert.ok(gmlContent.includes("function demo_script()"), "Renamed GML file should preserve original code");
        } finally {
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });

    void it("skips rename execution when renames input is empty", () => {
        const resultWithEmptyArray = Semantic.applyAssetRenames({
            projectIndex: { resources: {} },
            renames: []
        });

        assert.deepStrictEqual(resultWithEmptyArray, {
            writes: [],
            renames: []
        });

        const resultWithoutRenames = Semantic.applyAssetRenames({
            projectIndex: { resources: {} }
        });

        assert.deepStrictEqual(resultWithoutRenames, {
            writes: [],
            renames: []
        });
    });

    void it("renames sprite directories so frame and layer artifacts stay loadable", async () => {
        const projectRoot = await createSpriteRenameProject();

        try {
            const projectIndex = await Semantic.buildProjectIndex(projectRoot);
            const { renames, conflicts } = Semantic.planAssetRenames({
                projectIndex,
                assetStyle: "snake-lower"
            });

            assert.deepStrictEqual(conflicts, []);
            assert.strictEqual(renames.length, 1);
            assert.strictEqual(renames[0].newResourcePath, "sprites/spr_player/spr_player.yy");

            const result = Semantic.applyAssetRenames({
                projectIndex,
                renames
            });

            assert.deepStrictEqual(
                result.renames.map((entry) => Core.toPosixPath(path.relative(projectRoot, entry.to))),
                ["sprites/sprPlayer/spr_player.yy", "sprites/spr_player"]
            );

            await assertRejectsNotFound(path.join(projectRoot, "sprites/sprPlayer"));
            const spriteMetadata = await readUtf8(projectRoot, "sprites/spr_player/spr_player.yy");
            assert.match(spriteMetadata, /"resourcePath"\s*:\s*"sprites\/spr_player\/spr_player\.yy"/u);
            await assertResolves(path.join(projectRoot, "sprites/spr_player/91051c73-8376-47bf-961d-48259f5a302f.png"));
            await assertResolves(
                path.join(
                    projectRoot,
                    "sprites/spr_player/layers/91051c73-8376-47bf-961d-48259f5a302f/38d01480-65c9-4a86-bb98-f0d58bfcea7a.png"
                )
            );
        } finally {
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });

    void it("renames sound sidecar files alongside sound metadata", async () => {
        const projectRoot = await createSoundRenameProject();

        try {
            const projectIndex = await Semantic.buildProjectIndex(projectRoot);
            const { renames, conflicts } = Semantic.planAssetRenames({
                projectIndex,
                assetStyle: "snake-lower"
            });

            assert.deepStrictEqual(conflicts, []);
            assert.strictEqual(renames.length, 1);
            assert.strictEqual(renames[0].newResourcePath, "sounds/snd_colmesh_demo2coin/snd_colmesh_demo2coin.yy");

            Semantic.applyAssetRenames({
                projectIndex,
                renames
            });

            await assertRejectsNotFound(path.join(projectRoot, "sounds/sndColmeshDemo2Coin"));
            const soundMetadata = await readUtf8(projectRoot, "sounds/snd_colmesh_demo2coin/snd_colmesh_demo2coin.yy");
            assert.match(soundMetadata, /"soundFile"\s*:\s*"snd_colmesh_demo2coin\.mp3"/u);
            await assertResolves(path.join(projectRoot, "sounds/snd_colmesh_demo2coin/snd_colmesh_demo2coin.mp3"));
        } finally {
            await fs.rm(projectRoot, { recursive: true, force: true });
        }
    });
});

async function createSyntheticProject() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gml-asset-utils-"));

    const writeText = async (relativePath, contents) => {
        const absolutePath = path.join(root, fromPosixPath(relativePath));
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, contents, "utf8");
    };

    const scriptPath = "scripts/demo_script/demo_script.yy";
    const objectPath = "objects/obj_controller/obj_controller.yy";
    const roomPath = "rooms/room_start/room_start.yy";

    await writeJsonProjectFile(root, "MyGame.yyp", {
        name: "MyGame",
        resourceType: "GMProject",
        resources: [
            {
                id: { name: "demo_script", path: scriptPath }
            },
            {
                id: { name: "obj_controller", path: objectPath }
            },
            {
                id: { name: "room_start", path: roomPath }
            }
        ]
    });

    await writeJsonProjectFile(root, scriptPath, {
        resourceType: "GMScript",
        name: "demo_script",
        resourcePath: scriptPath,
        linkedScript: { path: scriptPath, name: "demo_script" }
    });

    await writeText("scripts/demo_script/demo_script.gml", "function demo_script() {\n    return 42;\n}\n");

    await writeJsonProjectFile(root, objectPath, {
        resourceType: "GMObject",
        name: "obj_controller",
        scriptExecute: { path: scriptPath, name: "demo_script" },
        eventList: [
            {
                resourceType: "GMEvent",
                eventType: 0,
                eventNum: 0,
                actionList: [
                    {
                        resourceType: "GMObjectEventAction",
                        actionName: "ExecuteScript",
                        script: { path: scriptPath, name: "demo_script" }
                    }
                ]
            }
        ]
    });

    await writeJsonProjectFile(root, roomPath, {
        resourceType: "GMRoom",
        name: "room_start",
        creationCodeScript: { path: scriptPath, name: "demo_script" },
        layers: [
            {
                resourceType: "GMRInstanceLayer",
                name: "Instances",
                instances: [
                    {
                        resourceType: "GMRInstance",
                        name: "obj_controller_1",
                        objectId: { name: "obj_controller", path: objectPath },
                        creationCodeScript: {
                            path: scriptPath,
                            name: "demo_script"
                        }
                    }
                ]
            }
        ],
        instanceCreationOrder: [{ name: "obj_controller", path: objectPath }]
    });

    return root;
}

async function createSpriteRenameProject() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gml-sprite-rename-"));
    const spritePath = "sprites/sprPlayer/sprPlayer.yy";

    await writeJsonProjectFile(root, "MyGame.yyp", {
        name: "MyGame",
        resourceType: "GMProject",
        resources: [{ id: { name: "sprPlayer", path: spritePath } }]
    });

    await writeJsonProjectFile(root, spritePath, {
        $GMSprite: "v2",
        "%Name": "sprPlayer",
        name: "sprPlayer",
        resourceType: "GMSprite",
        resourceVersion: "2.0",
        resourcePath: spritePath,
        frames: [
            {
                $GMSpriteFrame: "v1",
                "%Name": "91051c73-8376-47bf-961d-48259f5a302f",
                name: "91051c73-8376-47bf-961d-48259f5a302f",
                resourceType: "GMSpriteFrame",
                resourceVersion: "2.0"
            }
        ],
        layers: [
            {
                $GMImageLayer: "",
                "%Name": "38d01480-65c9-4a86-bb98-f0d58bfcea7a",
                name: "38d01480-65c9-4a86-bb98-f0d58bfcea7a",
                resourceType: "GMImageLayer",
                resourceVersion: "2.0"
            }
        ],
        sequence: {
            $GMSequence: "v1",
            "%Name": "sprPlayer",
            name: "sprPlayer",
            resourceType: "GMSequence",
            resourceVersion: "2.0",
            tracks: [
                {
                    keyframes: {
                        Keyframes: [
                            {
                                Channels: {
                                    "0": {
                                        Id: {
                                            name: "91051c73-8376-47bf-961d-48259f5a302f",
                                            path: spritePath
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

    await writeBinaryProjectFile(root, "sprites/sprPlayer/91051c73-8376-47bf-961d-48259f5a302f.png");
    await writeBinaryProjectFile(
        root,
        "sprites/sprPlayer/layers/91051c73-8376-47bf-961d-48259f5a302f/38d01480-65c9-4a86-bb98-f0d58bfcea7a.png"
    );

    return root;
}

async function createSoundRenameProject() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "gml-sound-rename-"));
    const soundPath = "sounds/sndColmeshDemo2Coin/sndColmeshDemo2Coin.yy";

    await writeJsonProjectFile(root, "MyGame.yyp", {
        name: "MyGame",
        resourceType: "GMProject",
        resources: [{ id: { name: "sndColmeshDemo2Coin", path: soundPath } }]
    });

    await writeJsonProjectFile(root, soundPath, {
        $GMSound: "v2",
        "%Name": "sndColmeshDemo2Coin",
        name: "sndColmeshDemo2Coin",
        resourceType: "GMSound",
        resourceVersion: "2.0",
        resourcePath: soundPath,
        soundFile: "sndColmeshDemo2Coin.mp3"
    });

    await writeBinaryProjectFile(root, "sounds/sndColmeshDemo2Coin/sndColmeshDemo2Coin.mp3");

    return root;
}

async function writeJsonProjectFile(root: string, relativePath: string, data: unknown) {
    const absolutePath = path.join(root, fromPosixPath(relativePath));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${JSON.stringify(data, null, 4)}\n`, "utf8");
}

async function writeBinaryProjectFile(root: string, relativePath: string) {
    const absolutePath = path.join(root, fromPosixPath(relativePath));
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, Buffer.from([0]));
}

async function readUtf8(root: string, relativePath: string) {
    return fs.readFile(path.join(root, fromPosixPath(relativePath)), "utf8");
}

async function assertResolves(targetPath: string) {
    await fs.access(targetPath);
}

async function assertRejectsNotFound(targetPath) {
    try {
        await fs.access(targetPath);
        assert.fail(`Path '${targetPath}' unexpectedly exists.`);
    } catch (error) {
        if (!error || error.code !== "ENOENT") {
            throw error;
        }
    }
}
