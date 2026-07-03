import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Core } from "@gmloop/core";
import { Refactor } from "@gmloop/refactor";

import { runCliTestCommand } from "../src/cli.js";
import { createRoomCommand } from "../src/commands/room.js";

async function createTemporaryObjectEventCliProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-object-cli-"));
    await writeFile(
        path.join(projectRoot, "MyGame.yyp"),
        `${JSON.stringify({ name: "MyGame", resourceType: "GMProject", resources: [] }, null, 4)}\n`,
        "utf8"
    );
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    await Refactor.addProjectResource({
        dryRun: false,
        projectRoot,
        resourceKind: "object",
        resourceName: "obj_player"
    });

    const objectMetadataPath = path.join(projectRoot, "objects/obj_player/obj_player.yy");
    const objectMetadata = Core.parseProjectMetadataDocumentForMutation(
        await readFile(objectMetadataPath, "utf8"),
        objectMetadataPath
    ).document;
    objectMetadata.eventList = [
        {
            $GMEvent: "",
            "%Name": "",
            collisionObjectId: null,
            eventNum: 0,
            eventType: 0,
            isDnD: false,
            name: "",
            resourceType: "GMEvent",
            resourceVersion: "2.0"
        }
    ];
    await writeFile(
        objectMetadataPath,
        `${Core.stringifyProjectMetadataDocument(objectMetadata, objectMetadataPath)}\n`,
        "utf8"
    );
    await writeFile(path.join(projectRoot, "objects/obj_player/0_0.gml"), "x = 1;\n", "utf8");
    return projectRoot;
}

async function createTemporaryRoomInstanceCliProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-room-cli-"));
    await writeFile(
        path.join(projectRoot, "MyGame.yyp"),
        `${JSON.stringify({ name: "MyGame", resourceType: "GMProject", resources: [] }, null, 4)}\n`,
        "utf8"
    );
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    await Refactor.addProjectResource({
        dryRun: false,
        projectRoot,
        resourceKind: "object",
        resourceName: "obj_player"
    });
    await Refactor.addProjectResource({
        dryRun: false,
        projectRoot,
        resourceKind: "room",
        resourceName: "rm_main"
    });
    return projectRoot;
}

void test("room command keeps inspection leaves and drops bespoke mutation leaves", () => {
    const command = createRoomCommand();
    const commandNames = command.commands.map((entry) => entry.name()).sort();

    assert.deepEqual(
        commandNames,
        [
            "camera",
            "inspect",
            "instance",
            "layer",
            "preview",
            "query",
            "repair",
            "summary",
            "update",
            "validate",
            "list"
        ].sort()
    );
});

void test("object planned leaves expose event inspection while keeping object update deferred", async () => {
    const projectRoot = await createTemporaryObjectEventCliProject();
    const updateResult = await runCliTestCommand({
        argv: ["object", "update", "obj_player", "--json"]
    });

    assert.equal(updateResult.exitCode, 0);
    const updatePayload = JSON.parse(updateResult.stdout) as {
        command: string;
        ok: boolean;
        payload: {
            capability: string;
            details: { object: string };
            state: string;
        };
    };

    assert.equal(updatePayload.command, "object update");
    assert.equal(updatePayload.ok, true);
    assert.equal(updatePayload.payload.state, "not_available");
    assert.equal(updatePayload.payload.details.object, "obj_player");

    try {
        const eventListResult = await runCliTestCommand({
            argv: ["object", "event", "list", "obj_player", "--path", projectRoot, "--json"]
        });
        assert.equal(eventListResult.exitCode, 0);
        const eventListPayload = JSON.parse(eventListResult.stdout) as {
            command: string;
            payload: {
                events: Array<{
                    descriptor: string;
                    eventFilePath: string;
                    parse: { ok: boolean };
                    source: { present: boolean; summary: string };
                }>;
            };
        };
        assert.equal(eventListPayload.command, "object event list");
        assert.equal(eventListPayload.payload.events[0]?.descriptor, "create:create");
        assert.equal(eventListPayload.payload.events[0]?.eventFilePath, "objects/obj_player/0_0.gml");
        assert.equal(eventListPayload.payload.events[0]?.parse.ok, true);
        assert.equal(eventListPayload.payload.events[0]?.source.present, true);
        assert.equal(eventListPayload.payload.events[0]?.source.summary, "x = 1;");

        const eventInspectResult = await runCliTestCommand({
            argv: ["object", "event", "inspect", "obj_player", "Create:0", "--path", projectRoot, "--json"]
        });
        assert.equal(eventInspectResult.exitCode, 0);
        const eventInspectPayload = JSON.parse(eventInspectResult.stdout) as {
            command: string;
            payload: { descriptor: string; eventType: number; eventNumber: number };
        };
        assert.equal(eventInspectPayload.command, "object event inspect");
        assert.equal(eventInspectPayload.payload.descriptor, "create:create");
        assert.equal(eventInspectPayload.payload.eventType, 0);
        assert.equal(eventInspectPayload.payload.eventNumber, 0);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("object event add, update, and delete support dry-run and write modes", async () => {
    const projectRoot = await createTemporaryObjectEventCliProject();
    const eventSourcePath = path.join(projectRoot, "objects/obj_player/0_0.gml");
    const addedEventSourcePath = path.join(projectRoot, "objects/obj_player/3_1.gml");
    const objectMetadataPath = path.join(projectRoot, "objects/obj_player/obj_player.yy");

    try {
        const addDryRunResult = await runCliTestCommand({
            argv: ["object", "event", "add", "obj_player", "Step:Begin", "x += 1;", "--path", projectRoot, "--json"]
        });

        assert.equal(addDryRunResult.exitCode, 0);
        const addDryRunPayload = JSON.parse(addDryRunResult.stdout) as {
            command: string;
            payload: {
                action: string;
                deletedPaths: Array<string>;
                dryRun: boolean;
                eventFilePath: string;
                eventNumber: number;
                eventType: number;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(addDryRunPayload.command, "object event add");
        assert.equal(addDryRunPayload.payload.action, "add");
        assert.deepEqual(addDryRunPayload.payload.deletedPaths, []);
        assert.equal(addDryRunPayload.payload.dryRun, true);
        assert.equal(addDryRunPayload.payload.eventType, 3);
        assert.equal(addDryRunPayload.payload.eventNumber, 1);
        assert.equal(addDryRunPayload.payload.eventFilePath, "objects/obj_player/3_1.gml");
        assert.deepEqual(addDryRunPayload.payload.writtenPaths, [
            "objects/obj_player/obj_player.yy",
            "objects/obj_player/3_1.gml"
        ]);
        await assert.rejects(readFile(addedEventSourcePath, "utf8"));

        const addWriteResult = await runCliTestCommand({
            argv: [
                "object",
                "event",
                "add",
                "obj_player",
                "Step:Begin",
                "x += 2;",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });

        assert.equal(addWriteResult.exitCode, 0);
        const addWritePayload = JSON.parse(addWriteResult.stdout) as {
            payload: { dryRun: boolean; objectName: string; objectPath: string };
        };
        assert.equal(addWritePayload.payload.dryRun, false);
        assert.equal(addWritePayload.payload.objectName, "obj_player");
        assert.equal(addWritePayload.payload.objectPath, "objects/obj_player/obj_player.yy");
        assert.equal(await readFile(addedEventSourcePath, "utf8"), "x += 2;\n");

        const objectMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(objectMetadataPath, "utf8"),
            objectMetadataPath
        ).document;
        const eventList = Core.asArray(objectMetadata.eventList);
        const addedEvent = eventList[1] as Record<string, unknown>;
        assert.equal(eventList.length, 2);
        assert.equal(addedEvent.eventType, 3);
        assert.equal(addedEvent.eventNum, 1);
        assert.equal(addedEvent.eventContents, "objects/obj_player/3_1.gml");

        const dryRunResult = await runCliTestCommand({
            argv: ["object", "event", "update", "obj_player", "Create:0", "x = 2;", "--path", projectRoot, "--json"]
        });

        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: {
                dryRun: boolean;
                eventFilePath: string;
                eventNumber: number;
                eventType: number;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(dryRunPayload.command, "object event update");
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.equal(dryRunPayload.payload.eventType, 0);
        assert.equal(dryRunPayload.payload.eventNumber, 0);
        assert.equal(dryRunPayload.payload.eventFilePath, "objects/obj_player/0_0.gml");
        assert.deepEqual(dryRunPayload.payload.writtenPaths, ["objects/obj_player/0_0.gml"]);
        assert.equal(await readFile(eventSourcePath, "utf8"), "x = 1;\n");

        const writeResult = await runCliTestCommand({
            argv: [
                "object",
                "event",
                "update",
                "obj_player",
                "Create:0",
                "x = 3;",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });

        assert.equal(writeResult.exitCode, 0);
        const writePayload = JSON.parse(writeResult.stdout) as {
            payload: { dryRun: boolean; objectName: string; objectPath: string };
        };
        assert.equal(writePayload.payload.dryRun, false);
        assert.equal(writePayload.payload.objectName, "obj_player");
        assert.equal(writePayload.payload.objectPath, "objects/obj_player/obj_player.yy");
        assert.equal(await readFile(eventSourcePath, "utf8"), "x = 3;\n");

        const deleteDryRunResult = await runCliTestCommand({
            argv: ["object", "event", "delete", "obj_player", "Step:Begin", "--path", projectRoot, "--json"]
        });
        assert.equal(deleteDryRunResult.exitCode, 0);
        const deleteDryRunPayload = JSON.parse(deleteDryRunResult.stdout) as {
            command: string;
            payload: {
                action: string;
                deletedPaths: Array<string>;
                dryRun: boolean;
                eventFilePath: string;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(deleteDryRunPayload.command, "object event delete");
        assert.equal(deleteDryRunPayload.payload.action, "delete");
        assert.equal(deleteDryRunPayload.payload.dryRun, true);
        assert.equal(deleteDryRunPayload.payload.eventFilePath, "objects/obj_player/3_1.gml");
        assert.deepEqual(deleteDryRunPayload.payload.deletedPaths, ["objects/obj_player/3_1.gml"]);
        assert.deepEqual(deleteDryRunPayload.payload.writtenPaths, ["objects/obj_player/obj_player.yy"]);
        assert.equal(await readFile(addedEventSourcePath, "utf8"), "x += 2;\n");

        const deleteWriteResult = await runCliTestCommand({
            argv: ["object", "event", "delete", "obj_player", "Step:Begin", "--path", projectRoot, "--json", "--write"]
        });
        assert.equal(deleteWriteResult.exitCode, 0);
        const deleteWritePayload = JSON.parse(deleteWriteResult.stdout) as { payload: { dryRun: boolean } };
        assert.equal(deleteWritePayload.payload.dryRun, false);
        await assert.rejects(readFile(addedEventSourcePath, "utf8"));

        const deletedEventMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(objectMetadataPath, "utf8"),
            objectMetadataPath
        ).document;
        assert.equal(Core.asArray(deletedEventMetadata.eventList).length, 1);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("object event mutations reject invalid event descriptor format", async () => {
    const eventAddResult = await runCliTestCommand({
        argv: ["object", "event", "add", "obj_player", "Step", "x += 1;", "--json"]
    });

    assert.equal(eventAddResult.exitCode, 1);
    assert.match(eventAddResult.stderr, /Expected format: category:event \(for example Step:Begin\)\./u);
});

void test("room layer create supports dry-run and write modes", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();
    const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");

    try {
        const dryRunResult = await runCliTestCommand({
            argv: ["room", "layer", "create", "rm_main", "Gameplay", "-100", "--path", projectRoot, "--json"]
        });

        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: {
                action: string;
                depth: number;
                dryRun: boolean;
                layerName: string;
                layerType: string;
                roomPath: string;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(dryRunPayload.command, "room layer create");
        assert.equal(dryRunPayload.payload.action, "create");
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.equal(dryRunPayload.payload.layerName, "Gameplay");
        assert.equal(dryRunPayload.payload.layerType, "instance");
        assert.equal(dryRunPayload.payload.depth, -100);
        assert.equal(dryRunPayload.payload.roomPath, "rooms/rm_main/rm_main.yy");
        assert.deepEqual(dryRunPayload.payload.writtenPaths, ["rooms/rm_main/rm_main.yy"]);

        const dryRunRoomMetadata = Core.parseProjectMetadataDocument(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        );
        assert.equal(Core.asArray(dryRunRoomMetadata.layers).length, 2);

        const writeResult = await runCliTestCommand({
            argv: ["room", "layer", "create", "rm_main", "Gameplay", "-100", "--path", projectRoot, "--json", "--write"]
        });

        assert.equal(writeResult.exitCode, 0);
        const writePayload = JSON.parse(writeResult.stdout) as {
            payload: { dryRun: boolean; layerName: string; roomName: string };
        };
        assert.equal(writePayload.payload.dryRun, false);
        assert.equal(writePayload.payload.layerName, "Gameplay");
        assert.equal(writePayload.payload.roomName, "rm_main");

        const updatedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const layers = Core.asArray(updatedRoomMetadata.layers);
        const createdLayer = layers[2] as Record<string, unknown>;
        assert.ok(Core.isObjectLike(createdLayer));
        assert.equal(createdLayer.resourceType, "GMRInstanceLayer");
        assert.equal(createdLayer.name, "Gameplay");
        assert.equal(createdLayer.depth, -100);
        assert.deepEqual(createdLayer.instances, []);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room layer list and inspect expose structured room metadata", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();

    try {
        const listResult = await runCliTestCommand({
            argv: ["room", "layer", "list", "rm_main", "--path", projectRoot, "--json"]
        });
        assert.equal(listResult.exitCode, 0);
        const listPayload = JSON.parse(listResult.stdout) as {
            command: string;
            payload: {
                layers: Array<{
                    depth: number | null;
                    instanceCount: number;
                    layerName: string;
                    layerType: string;
                    visible: boolean | null;
                }>;
            };
        };
        assert.equal(listPayload.command, "room layer list");
        assert.deepEqual(
            listPayload.payload.layers.map((layer) => layer.layerName),
            ["Instances", "Background"]
        );
        assert.equal(listPayload.payload.layers[0]?.layerType, "GMRInstanceLayer");
        assert.equal(listPayload.payload.layers[0]?.instanceCount, 0);

        const inspectResult = await runCliTestCommand({
            argv: ["room", "layer", "inspect", "rm_main", "Background", "--path", projectRoot, "--json"]
        });
        assert.equal(inspectResult.exitCode, 0);
        const inspectPayload = JSON.parse(inspectResult.stdout) as {
            command: string;
            payload: { depth: number | null; layerName: string; layerType: string };
        };
        assert.equal(inspectPayload.command, "room layer inspect");
        assert.equal(inspectPayload.payload.layerName, "Background");
        assert.equal(inspectPayload.payload.layerType, "GMRBackgroundLayer");
        assert.equal(inspectPayload.payload.depth, 100);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room layer update, reorder, and delete support dry-run and write modes", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();
    const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");

    try {
        const dryRunResult = await runCliTestCommand({
            argv: [
                "room",
                "layer",
                "update",
                "rm_main",
                "Instances",
                "--name",
                "Actors",
                "--depth",
                "-50",
                "--path",
                projectRoot,
                "--json"
            ]
        });
        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: {
                action: string;
                changed: boolean;
                depth: number;
                dryRun: boolean;
                layerIndex: number;
                layerName: string;
                previousLayerIndex: number | null;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(dryRunPayload.command, "room layer update");
        assert.equal(dryRunPayload.payload.action, "update");
        assert.equal(dryRunPayload.payload.changed, true);
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.equal(dryRunPayload.payload.layerName, "Actors");
        assert.equal(dryRunPayload.payload.depth, -50);
        assert.equal(dryRunPayload.payload.layerIndex, 0);
        assert.equal(dryRunPayload.payload.previousLayerIndex, 0);
        assert.deepEqual(dryRunPayload.payload.writtenPaths, ["rooms/rm_main/rm_main.yy"]);

        const dryRunRoomMetadata = Core.parseProjectMetadataDocument(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        );
        const dryRunLayers = Core.asArray(dryRunRoomMetadata.layers);
        const originalFirstLayer = dryRunLayers[0] as Record<string, unknown>;
        assert.equal(originalFirstLayer.name, "Instances");
        assert.equal(originalFirstLayer.depth, 0);

        const updateWriteResult = await runCliTestCommand({
            argv: [
                "room",
                "layer",
                "update",
                "rm_main",
                "Instances",
                "--name",
                "Actors",
                "--depth",
                "-50",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(updateWriteResult.exitCode, 0);

        const createResult = await runCliTestCommand({
            argv: [
                "room",
                "layer",
                "create",
                "rm_main",
                "Foreground",
                "-200",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(createResult.exitCode, 0);

        const reorderResult = await runCliTestCommand({
            argv: ["room", "layer", "reorder", "rm_main", "Foreground", "0", "--path", projectRoot, "--json", "--write"]
        });
        assert.equal(reorderResult.exitCode, 0);
        const reorderPayload = JSON.parse(reorderResult.stdout) as {
            payload: { action: string; changed: boolean; layerIndex: number; previousLayerIndex: number | null };
        };
        assert.equal(reorderPayload.payload.action, "reorder");
        assert.equal(reorderPayload.payload.changed, true);
        assert.equal(reorderPayload.payload.layerIndex, 0);
        assert.equal(reorderPayload.payload.previousLayerIndex, 2);

        const deleteResult = await runCliTestCommand({
            argv: ["room", "layer", "delete", "rm_main", "Background", "--path", projectRoot, "--json", "--write"]
        });
        assert.equal(deleteResult.exitCode, 0);
        const deletePayload = JSON.parse(deleteResult.stdout) as {
            payload: { action: string; changed: boolean; layerName: string };
        };
        assert.equal(deletePayload.payload.action, "delete");
        assert.equal(deletePayload.payload.changed, true);
        assert.equal(deletePayload.payload.layerName, "Background");

        const updatedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const layers = Core.asArray(updatedRoomMetadata.layers);
        assert.deepEqual(
            layers.map((layer) => {
                if (!Core.isObjectLike(layer)) {
                    return null;
                }
                const layerRecord = layer as Record<string, unknown>;
                return layerRecord.name;
            }),
            ["Foreground", "Actors"]
        );
        const actorsLayer = layers[1] as Record<string, unknown>;
        assert.equal(actorsLayer["%Name"], "Actors");
        assert.equal(actorsLayer.depth, -50);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room layer delete rejects non-empty instance layers", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();

    try {
        const addInstanceResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "add",
                "rm_main",
                "obj_player",
                "10",
                "20",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(addInstanceResult.exitCode, 0);

        const deleteResult = await runCliTestCommand({
            argv: ["room", "layer", "delete", "rm_main", "Instances", "--path", projectRoot, "--json", "--write"]
        });
        assert.equal(deleteResult.exitCode, 1);
        assert.match(deleteResult.stderr, /contains 1 instance\(s\) and cannot be deleted/u);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room camera list and inspect expose structured view metadata", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();

    try {
        const listResult = await runCliTestCommand({
            argv: ["room", "camera", "list", "rm_main", "--path", projectRoot, "--json"]
        });
        assert.equal(listResult.exitCode, 0);
        const listPayload = JSON.parse(listResult.stdout) as {
            command: string;
            payload: {
                cameras: Array<{
                    cameraId: string;
                    enabled: boolean;
                    height: number | null;
                    visible: boolean;
                    width: number | null;
                    x: number | null;
                    y: number | null;
                }>;
            };
        };
        assert.equal(listPayload.command, "room camera list");
        assert.equal(listPayload.payload.cameras[0]?.cameraId, "camera_0");
        assert.equal(listPayload.payload.cameras[0]?.enabled, false);
        assert.equal(listPayload.payload.cameras[0]?.x, 0);

        const inspectResult = await runCliTestCommand({
            argv: ["room", "camera", "inspect", "rm_main", "camera_0", "--path", projectRoot, "--json"]
        });
        assert.equal(inspectResult.exitCode, 0);
        const inspectPayload = JSON.parse(inspectResult.stdout) as {
            command: string;
            payload: { cameraId: string; height: number | null; width: number | null };
        };
        assert.equal(inspectPayload.command, "room camera inspect");
        assert.equal(inspectPayload.payload.cameraId, "camera_0");
        assert.equal(inspectPayload.payload.width, 1024);
        assert.equal(inspectPayload.payload.height, 768);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room camera update supports dry-run and write modes", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();
    const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");

    try {
        const dryRunResult = await runCliTestCommand({
            argv: [
                "room",
                "camera",
                "update",
                "rm_main",
                "camera_0",
                "32",
                "64",
                "1280",
                "720",
                "--path",
                projectRoot,
                "--json"
            ]
        });

        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: {
                action: string;
                cameraId: string;
                dryRun: boolean;
                roomPath: string;
                writtenPaths: Array<string>;
                x: number;
            };
        };
        assert.equal(dryRunPayload.command, "room camera update");
        assert.equal(dryRunPayload.payload.action, "update");
        assert.equal(dryRunPayload.payload.cameraId, "camera_0");
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.equal(dryRunPayload.payload.roomPath, "rooms/rm_main/rm_main.yy");
        assert.deepEqual(dryRunPayload.payload.writtenPaths, ["rooms/rm_main/rm_main.yy"]);
        assert.equal(dryRunPayload.payload.x, 32);

        const dryRunRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const dryRunViewSettings = dryRunRoomMetadata.viewSettings as Record<string, unknown>;
        const dryRunViews = dryRunRoomMetadata.views as Array<Record<string, unknown>>;
        assert.equal(dryRunViewSettings.enableViews, false);
        assert.equal(dryRunViews[0].xview, 0);

        const writeResult = await runCliTestCommand({
            argv: [
                "room",
                "camera",
                "update",
                "rm_main",
                "camera_0",
                "32",
                "64",
                "1280",
                "720",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });

        assert.equal(writeResult.exitCode, 0);
        const writePayload = JSON.parse(writeResult.stdout) as {
            payload: { dryRun: boolean; height: number; roomName: string; width: number; y: number };
        };
        assert.equal(writePayload.payload.dryRun, false);
        assert.equal(writePayload.payload.roomName, "rm_main");
        assert.equal(writePayload.payload.width, 1280);
        assert.equal(writePayload.payload.height, 720);
        assert.equal(writePayload.payload.y, 64);

        const updatedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const updatedViewSettings = updatedRoomMetadata.viewSettings as Record<string, unknown>;
        const updatedViews = updatedRoomMetadata.views as Array<Record<string, unknown>>;
        assert.equal(updatedViewSettings.enableViews, true);
        assert.equal(updatedViews[0].visible, true);
        assert.equal(updatedViews[0].xview, 32);
        assert.equal(updatedViews[0].yview, 64);
        assert.equal(updatedViews[0].wview, 1280);
        assert.equal(updatedViews[0].hview, 720);
        assert.equal(updatedViews[0].wport, 1280);
        assert.equal(updatedViews[0].hport, 720);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room camera frame uses room instances to set a padded playable viewport", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();
    const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");

    try {
        const firstInstanceResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "add",
                "rm_main",
                "obj_player",
                "10",
                "20",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(firstInstanceResult.exitCode, 0);

        const secondInstanceResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "add",
                "rm_main",
                "obj_player",
                "110",
                "70",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(secondInstanceResult.exitCode, 0);

        const dryRunResult = await runCliTestCommand({
            argv: [
                "room",
                "camera",
                "frame",
                "rm_main",
                "camera_0",
                "Instances",
                "--padding",
                "16",
                "--path",
                projectRoot,
                "--json"
            ]
        });
        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: {
                action: string;
                dryRun: boolean;
                framedInstanceCount: number | null;
                height: number;
                layerName: string | null;
                width: number;
                x: number;
                y: number;
            };
        };
        assert.equal(dryRunPayload.command, "room camera frame");
        assert.equal(dryRunPayload.payload.action, "frame");
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.equal(dryRunPayload.payload.framedInstanceCount, 2);
        assert.equal(dryRunPayload.payload.layerName, "Instances");
        assert.equal(dryRunPayload.payload.x, -6);
        assert.equal(dryRunPayload.payload.y, 4);
        assert.equal(dryRunPayload.payload.width, 132);
        assert.equal(dryRunPayload.payload.height, 82);

        const dryRunRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const dryRunViews = dryRunRoomMetadata.views as Array<Record<string, unknown>>;
        assert.equal(dryRunViews[0].xview, 0);

        const writeResult = await runCliTestCommand({
            argv: [
                "room",
                "camera",
                "frame",
                "rm_main",
                "camera_0",
                "Instances",
                "--padding",
                "16",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(writeResult.exitCode, 0);
        const writePayload = JSON.parse(writeResult.stdout) as {
            payload: { dryRun: boolean; framedInstanceCount: number | null; layerName: string | null };
        };
        assert.equal(writePayload.payload.dryRun, false);
        assert.equal(writePayload.payload.framedInstanceCount, 2);
        assert.equal(writePayload.payload.layerName, "Instances");

        const updatedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const updatedViewSettings = updatedRoomMetadata.viewSettings as Record<string, unknown>;
        const updatedViews = updatedRoomMetadata.views as Array<Record<string, unknown>>;
        assert.equal(updatedViewSettings.enableViews, true);
        assert.equal(updatedViews[0].visible, true);
        assert.equal(updatedViews[0].xview, -6);
        assert.equal(updatedViews[0].yview, 4);
        assert.equal(updatedViews[0].wview, 132);
        assert.equal(updatedViews[0].hview, 82);
        assert.equal(updatedViews[0].wport, 132);
        assert.equal(updatedViews[0].hport, 82);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room camera frame rejects empty layers", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();

    try {
        const result = await runCliTestCommand({
            argv: ["room", "camera", "frame", "rm_main", "camera_0", "Background", "--path", projectRoot, "--json"]
        });
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /does not contain any frameable instances/u);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("room repair plans and applies common room metadata repairs", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();
    const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");

    try {
        const addInstanceResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "add",
                "rm_main",
                "obj_player",
                "10",
                "20",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });
        assert.equal(addInstanceResult.exitCode, 0);
        const addInstancePayload = JSON.parse(addInstanceResult.stdout) as {
            payload: { instanceId: string };
        };

        const corruptedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const corruptedLayer = Core.asArray(corruptedRoomMetadata.layers)[0] as Record<string, unknown>;
        const corruptedInstance = Core.asArray(corruptedLayer.instances)[0] as Record<string, unknown>;
        delete corruptedInstance.name;
        corruptedRoomMetadata.viewSettings = "invalid";
        corruptedRoomMetadata.views = [null];
        corruptedRoomMetadata.instanceCreationOrder = [
            {
                name: addInstancePayload.payload.instanceId,
                path: "rooms/wrong/wrong.yy"
            },
            {
                name: "inst_missing",
                path: "rooms/rm_main/rm_main.yy"
            }
        ];
        await writeFile(roomMetadataPath, `${JSON.stringify(corruptedRoomMetadata, null, 4)}\n`, "utf8");

        const dryRunResult = await runCliTestCommand({
            argv: ["room", "repair", "rm_main", "--path", projectRoot, "--json"]
        });
        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: {
                changed: boolean;
                dryRun: boolean;
                repairs: Array<{ code: string }>;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(dryRunPayload.command, "room repair");
        assert.equal(dryRunPayload.payload.changed, true);
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.deepEqual(dryRunPayload.payload.writtenPaths, ["rooms/rm_main/rm_main.yy"]);
        assert.ok(dryRunPayload.payload.repairs.some((repair) => repair.code === "room.viewSettings.not_object"));
        assert.ok(
            dryRunPayload.payload.repairs.some((repair) => repair.code === "room.instanceCreationOrder.invalid_path")
        );
        assert.ok(dryRunPayload.payload.repairs.some((repair) => repair.code === "room.instance.name_mismatch"));

        const dryRunRoomMetadata = Core.parseProjectMetadataDocument(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        );
        assert.equal(dryRunRoomMetadata.viewSettings, "invalid");

        const writeResult = await runCliTestCommand({
            argv: ["room", "repair", "rm_main", "--path", projectRoot, "--json", "--write"]
        });
        assert.equal(writeResult.exitCode, 0);
        const writePayload = JSON.parse(writeResult.stdout) as {
            payload: { changed: boolean; dryRun: boolean; roomName: string };
        };
        assert.equal(writePayload.payload.changed, true);
        assert.equal(writePayload.payload.dryRun, false);
        assert.equal(writePayload.payload.roomName, "rm_main");

        const repairedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        const repairedViewSettings = repairedRoomMetadata.viewSettings as Record<string, unknown>;
        const repairedViews = repairedRoomMetadata.views as Array<unknown>;
        const repairedCreationOrder = repairedRoomMetadata.instanceCreationOrder as Array<Record<string, unknown>>;
        const repairedLayer = Core.asArray(repairedRoomMetadata.layers)[0] as Record<string, unknown>;
        const repairedInstance = Core.asArray(repairedLayer.instances)[0] as Record<string, unknown>;
        assert.equal(repairedViewSettings.enableViews, false);
        assert.equal(repairedViews.length, 8);
        assert.ok(Core.isObjectLike(repairedViews[0]));
        assert.equal(repairedInstance.name, addInstancePayload.payload.instanceId);
        assert.equal(repairedInstance["%Name"], addInstancePayload.payload.instanceId);
        assert.deepEqual(repairedCreationOrder, [
            {
                name: addInstancePayload.payload.instanceId,
                path: "rooms/rm_main/rm_main.yy"
            }
        ]);

        const cleanResult = await runCliTestCommand({
            argv: ["room", "repair", "rm_main", "--path", projectRoot, "--json"]
        });
        assert.equal(cleanResult.exitCode, 0);
        const cleanPayload = JSON.parse(cleanResult.stdout) as {
            payload: { changed: boolean; repairs: Array<unknown>; writtenPaths: Array<string> };
        };
        assert.equal(cleanPayload.payload.changed, false);
        assert.deepEqual(cleanPayload.payload.repairs, []);
        assert.deepEqual(cleanPayload.payload.writtenPaths, []);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("ui planned leaves emit concrete payloads without unsupported backend state", async () => {
    const previewResult = await runCliTestCommand({
        argv: ["ui", "preview", "--json"]
    });

    assert.equal(previewResult.exitCode, 0);
    const previewPayload = JSON.parse(previewResult.stdout) as {
        command: string;
        ok: boolean;
        payload: {
            capability: string;
            state: string;
        };
    };

    assert.equal(previewPayload.command, "ui preview");
    assert.equal(previewPayload.ok, true);
    assert.equal(previewPayload.payload.state, "not_available");

    const scaffoldResult = await runCliTestCommand({
        argv: ["ui", "scaffold", "--json"]
    });

    assert.equal(scaffoldResult.exitCode, 0);
    const scaffoldPayload = JSON.parse(scaffoldResult.stdout) as {
        command: string;
        payload: {
            state: string;
        };
    };

    assert.equal(scaffoldPayload.command, "ui scaffold");
    assert.equal(scaffoldPayload.payload.state, "not_available");
});

void test("room instance mutations reject non-numeric coordinates", async () => {
    const addResult = await runCliTestCommand({
        argv: ["room", "instance", "add", "rm_main", "obj_player", "left", "240", "--json"]
    });

    assert.equal(addResult.exitCode, 1);
    assert.match(addResult.stderr, /Invalid x coordinate "left"\. Expected a finite numeric value\./u);

    const updateResult = await runCliTestCommand({
        argv: ["room", "instance", "update", "rm_main", "111", "320", "top", "--json"]
    });

    assert.equal(updateResult.exitCode, 1);
    assert.match(updateResult.stderr, /Invalid y coordinate "top"\. Expected a finite numeric value\./u);
});

void test("room instance add/update/delete mutate room metadata through CLI write mode", async () => {
    const projectRoot = await createTemporaryRoomInstanceCliProject();

    try {
        const dryRunResult = await runCliTestCommand({
            argv: ["room", "instance", "add", "rm_main", "obj_player", "12", "34", "--path", projectRoot, "--json"]
        });

        assert.equal(dryRunResult.exitCode, 0);
        const dryRunPayload = JSON.parse(dryRunResult.stdout) as {
            command: string;
            payload: { dryRun: boolean; objectPath: string; roomPath: string; writtenPaths: Array<string> };
        };
        assert.equal(dryRunPayload.command, "room instance add");
        assert.equal(dryRunPayload.payload.dryRun, true);
        assert.equal(dryRunPayload.payload.objectPath, "objects/obj_player/obj_player.yy");
        assert.deepEqual(dryRunPayload.payload.writtenPaths, ["rooms/rm_main/rm_main.yy"]);

        const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");
        const dryRunRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.deepEqual(dryRunRoomMetadata.instanceCreationOrder, []);

        const writeResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "add",
                "rm_main",
                "obj_player",
                "56",
                "78",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });

        assert.equal(writeResult.exitCode, 0);
        const writePayload = JSON.parse(writeResult.stdout) as {
            payload: { dryRun: boolean; instanceId: string; layerName: string; x: number; y: number };
        };
        assert.equal(writePayload.payload.dryRun, false);
        assert.equal(writePayload.payload.layerName, "Instances");
        assert.equal(writePayload.payload.x, 56);
        assert.equal(writePayload.payload.y, 78);

        const listResult = await runCliTestCommand({
            argv: ["room", "instance", "list", "rm_main", "--path", projectRoot, "--json"]
        });
        assert.equal(listResult.exitCode, 0);
        const listPayload = JSON.parse(listResult.stdout) as {
            command: string;
            payload: {
                instances: Array<{
                    instanceId: string;
                    layerName: string;
                    objectName: string;
                    objectPath: string;
                    roomName: string;
                    roomPath: string;
                    x: number;
                    y: number;
                }>;
            };
        };
        assert.equal(listPayload.command, "room instance list");
        assert.deepEqual(listPayload.payload.instances, [
            {
                instanceId: writePayload.payload.instanceId,
                layerName: "Instances",
                objectName: "obj_player",
                objectPath: "objects/obj_player/obj_player.yy",
                roomName: "rm_main",
                roomPath: "rooms/rm_main/rm_main.yy",
                x: 56,
                y: 78
            }
        ]);

        const inspectResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "inspect",
                "rm_main",
                writePayload.payload.instanceId,
                "--path",
                projectRoot,
                "--json"
            ]
        });
        assert.equal(inspectResult.exitCode, 0);
        const inspectPayload = JSON.parse(inspectResult.stdout) as {
            command: string;
            payload: { instanceId: string; objectName: string; x: number; y: number };
        };
        assert.equal(inspectPayload.command, "room instance inspect");
        assert.equal(inspectPayload.payload.instanceId, writePayload.payload.instanceId);
        assert.equal(inspectPayload.payload.objectName, "obj_player");
        assert.equal(inspectPayload.payload.x, 56);
        assert.equal(inspectPayload.payload.y, 78);

        const updateResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "update",
                "rm_main",
                writePayload.payload.instanceId,
                "320",
                "240",
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });

        assert.equal(updateResult.exitCode, 0);
        const updatePayload = JSON.parse(updateResult.stdout) as {
            command: string;
            payload: { action: string; dryRun: boolean; instanceId: string; x: number; y: number };
        };
        assert.equal(updatePayload.command, "room instance update");
        assert.equal(updatePayload.payload.action, "update");
        assert.equal(updatePayload.payload.dryRun, false);
        assert.equal(updatePayload.payload.instanceId, writePayload.payload.instanceId);
        assert.equal(updatePayload.payload.x, 320);
        assert.equal(updatePayload.payload.y, 240);

        const updatedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.equal(updatedRoomMetadata.instanceCreationOrder[0].name, writePayload.payload.instanceId);
        assert.equal(updatedRoomMetadata.layers[0].instances[0].objectId.path, "objects/obj_player/obj_player.yy");
        assert.equal(Number(updatedRoomMetadata.layers[0].instances[0].x), 320);
        assert.equal(Number(updatedRoomMetadata.layers[0].instances[0].y), 240);

        const deleteResult = await runCliTestCommand({
            argv: [
                "room",
                "instance",
                "delete",
                "rm_main",
                writePayload.payload.instanceId,
                "--path",
                projectRoot,
                "--json",
                "--write"
            ]
        });

        assert.equal(deleteResult.exitCode, 0);
        const deletePayload = JSON.parse(deleteResult.stdout) as {
            command: string;
            payload: { action: string; dryRun: boolean; instanceId: string; x: number; y: number };
        };
        assert.equal(deletePayload.command, "room instance delete");
        assert.equal(deletePayload.payload.action, "delete");
        assert.equal(deletePayload.payload.dryRun, false);
        assert.equal(deletePayload.payload.instanceId, writePayload.payload.instanceId);
        assert.equal(deletePayload.payload.x, 320);
        assert.equal(deletePayload.payload.y, 240);

        const deletedRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.deepEqual(deletedRoomMetadata.instanceCreationOrder, []);
        assert.deepEqual(deletedRoomMetadata.layers[0].instances, []);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});
