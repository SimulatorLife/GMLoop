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

void test("object planned leaves emit concrete non-stub payloads", async () => {
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

    const eventListResult = await runCliTestCommand({
        argv: ["object", "event", "list", "obj_player", "--json"]
    });
    assert.equal(eventListResult.exitCode, 0);
    const eventListPayload = JSON.parse(eventListResult.stdout) as {
        command: string;
        payload: { state: string };
    };
    assert.equal(eventListPayload.command, "object event list");
    assert.equal(eventListPayload.payload.state, "not_available");
});

void test("object event add and update support dry-run and write modes", async () => {
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
                dryRun: boolean;
                eventFilePath: string;
                eventNumber: number;
                eventType: number;
                writtenPaths: Array<string>;
            };
        };
        assert.equal(addDryRunPayload.command, "object event add");
        assert.equal(addDryRunPayload.payload.action, "add");
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

void test("room layer update planned leaf emits apply mode when write is requested", async () => {
    const updateResult = await runCliTestCommand({
        argv: ["room", "layer", "update", "--json", "--write"]
    });

    assert.equal(updateResult.exitCode, 0);
    const updatePayload = JSON.parse(updateResult.stdout) as {
        command: string;
        payload: {
            capability: string;
            mode: string;
            state: string;
        };
    };

    assert.equal(updatePayload.command, "room layer update");
    assert.equal(updatePayload.payload.capability, "room_layer_mutation");
    assert.equal(updatePayload.payload.mode, "apply");
    assert.equal(updatePayload.payload.state, "not_available");
});

void test("room camera update planned leaf emits write-aware payload details", async () => {
    const updateResult = await runCliTestCommand({
        argv: ["room", "camera", "update", "rm_main", "camera_0", "32", "64", "1280", "720", "--json", "--write"]
    });

    assert.equal(updateResult.exitCode, 0);
    const updatePayload = JSON.parse(updateResult.stdout) as {
        command: string;
        payload: {
            capability: string;
            details: {
                cameraId: string;
                height: string;
                room: string;
                width: string;
                x: string;
                y: string;
            };
            mode: string;
            state: string;
        };
    };

    assert.equal(updatePayload.command, "room camera update");
    assert.equal(updatePayload.payload.capability, "room_camera_mutation");
    assert.equal(updatePayload.payload.mode, "apply");
    assert.equal(updatePayload.payload.state, "not_available");
    assert.equal(updatePayload.payload.details.room, "rm_main");
    assert.equal(updatePayload.payload.details.cameraId, "camera_0");
    assert.equal(updatePayload.payload.details.x, "32");
    assert.equal(updatePayload.payload.details.y, "64");
    assert.equal(updatePayload.payload.details.width, "1280");
    assert.equal(updatePayload.payload.details.height, "720");
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
