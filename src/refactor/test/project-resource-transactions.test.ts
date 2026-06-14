import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Core } from "@gmloop/core";

import {
    addObjectEvent,
    addProjectResource,
    addRoomInstance,
    deleteObjectEvent,
    deleteRoomInstance,
    duplicateProjectResource,
    moveProjectResource,
    ProjectResourceKind,
    readProjectMetadataDocument,
    removeProjectResource,
    renameProjectResource,
    resolveProjectManifestFile,
    updateRoomInstance
} from "../src/project-resources/index.js";

async function createTemporaryProjectRoot(): Promise<string> {
    const projectRoot = await fsMkdtemp("gmloop-project-resource-");
    await writeProjectFile(
        projectRoot,
        "MyGame.yyp",
        `${JSON.stringify({ name: "MyGame", resourceType: "GMProject", resources: [] }, null, 4)}\n`
    );
    return projectRoot;
}

async function fsMkdtemp(prefix: string): Promise<string> {
    return await mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeProjectFile(projectRoot: string, relativePath: string, contents: string | Buffer): Promise<void> {
    const absolutePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
}

void test("addProjectResource creates script metadata, source, and manifest entry", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        const result = await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_bootstrap"
        });

        assert.deepEqual(result.deletedPaths, []);
        assert.deepEqual(result.warnings, []);
        assert.deepEqual(result.writtenPaths, [
            "MyGame.yyp",
            "scripts/scr_bootstrap/scr_bootstrap.yy",
            "scripts/scr_bootstrap/scr_bootstrap.gml"
        ]);

        const manifestDocument = Core.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        assert.equal(manifestDocument.resources[0].id.name, "scr_bootstrap");
        assert.equal(manifestDocument.resources[0].id.path, "scripts/scr_bootstrap/scr_bootstrap.yy");

        const scriptMetadataPath = path.join(projectRoot, "scripts/scr_bootstrap/scr_bootstrap.yy");
        const scriptMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(scriptMetadataPath, "utf8"),
            scriptMetadataPath
        ).document;
        assert.equal(scriptMetadata.name, "scr_bootstrap");
        assert.equal(scriptMetadata.resourceType, "GMScript");
        assert.equal(scriptMetadata.resourcePath, "scripts/scr_bootstrap/scr_bootstrap.yy");

        const scriptSource = await readFile(path.join(projectRoot, "scripts/scr_bootstrap/scr_bootstrap.gml"), "utf8");
        assert.equal(scriptSource, "function scr_bootstrap() {\n}\n");
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("addProjectResource creates sprite metadata plus frame and layer png placeholders", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        const result = await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SPRITE,
            resourceName: "spr_cursor"
        });

        assert.equal(result.resourcePath, "sprites/spr_cursor/spr_cursor.yy");

        const spriteMetadataPath = path.join(projectRoot, "sprites/spr_cursor/spr_cursor.yy");
        const spriteMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(spriteMetadataPath, "utf8"),
            spriteMetadataPath
        ).document;
        const frameName = spriteMetadata.frames[0].name;
        const layerName = spriteMetadata.layers[0].name;

        await assert.doesNotReject(access(path.join(projectRoot, `sprites/spr_cursor/${frameName}.png`)));
        await assert.doesNotReject(
            access(path.join(projectRoot, `sprites/spr_cursor/layers/${frameName}/${layerName}.png`))
        );
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("removeProjectResource removes the manifest entry and canonical resource directory", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_cleanup"
        });

        const result = await removeProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_cleanup"
        });

        assert.deepEqual(result.deletedPaths, ["scripts/scr_cleanup"]);

        const manifestDocument = Core.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        assert.deepEqual(manifestDocument.resources, []);

        await assert.rejects(access(path.join(projectRoot, "scripts/scr_cleanup")));
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("addProjectResource rejects duplicate resources in the same manifest", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.FONT,
            resourceName: "fnt_menu"
        });

        await assert.rejects(
            addProjectResource({
                dryRun: false,
                projectRoot,
                resourceKind: ProjectResourceKind.FONT,
                resourceName: "fnt_menu"
            }),
            /already exists/
        );
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("renameProjectResource updates manifest and filesystem in write mode", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_before"
        });

        const result = await renameProjectResource({
            dryRun: false,
            newResourceName: "scr_after",
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_before"
        });

        assert.equal(result.action, "rename");
        assert.equal(result.resourcePath, "scripts/scr_after/scr_after.yy");
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/scr_after/scr_after.gml")));
        await assert.rejects(access(path.join(projectRoot, "scripts/scr_before")));
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("duplicateProjectResource and moveProjectResource support dry-run semantics", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_source"
        });

        const duplicateDryRun = await duplicateProjectResource({
            dryRun: true,
            newResourceName: "scr_copy",
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_source"
        });
        assert.equal(duplicateDryRun.action, "duplicate");
        await assert.rejects(access(path.join(projectRoot, "scripts/scr_copy/scr_copy.yy")));

        const duplicateWrite = await duplicateProjectResource({
            dryRun: false,
            newResourceName: "scr_copy",
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_source"
        });
        assert.equal(duplicateWrite.action, "duplicate");
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/scr_copy/scr_copy.gml")));

        const moveDryRun = await moveProjectResource({
            destinationFolder: "scripts/moved",
            dryRun: true,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_copy"
        });
        assert.equal(moveDryRun.action, "move");
        await assert.rejects(access(path.join(projectRoot, "scripts/moved/scr_copy.yy")));

        const moveWrite = await moveProjectResource({
            destinationFolder: "scripts/moved",
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.SCRIPT,
            resourceName: "scr_copy"
        });
        assert.equal(moveWrite.resourcePath, "scripts/moved/scr_copy.yy");
        await assert.doesNotReject(access(path.join(projectRoot, "scripts/moved/scr_copy.gml")));
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("addObjectEvent appends event metadata and source with dry-run safety", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.OBJECT,
            resourceName: "obj_player"
        });

        const dryRun = await addObjectEvent({
            descriptor: { category: "Create", descriptor: "0" },
            dryRun: true,
            handlerSource: "x = 1;",
            objectName: "obj_player",
            projectRoot
        });
        assert.equal(dryRun.action, "add");
        assert.deepEqual(dryRun.deletedPaths, []);
        assert.equal(dryRun.dryRun, true);
        assert.equal(dryRun.eventFilePath, "objects/obj_player/0_0.gml");
        assert.deepEqual(dryRun.writtenPaths, ["objects/obj_player/obj_player.yy", "objects/obj_player/0_0.gml"]);
        await assert.rejects(access(path.join(projectRoot, "objects/obj_player/0_0.gml")));

        const writeResult = await addObjectEvent({
            descriptor: { category: "Create", descriptor: "0" },
            dryRun: false,
            handlerSource: "x = 2;",
            objectName: "obj_player",
            projectRoot
        });
        assert.equal(writeResult.dryRun, false);
        assert.deepEqual(writeResult.deletedPaths, []);
        assert.equal(writeResult.eventType, 0);
        assert.equal(writeResult.eventNumber, 0);

        const objectMetadataPath = path.join(projectRoot, "objects/obj_player/obj_player.yy");
        const objectMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(objectMetadataPath, "utf8"),
            objectMetadataPath
        ).document;
        assert.equal(objectMetadata.eventList[0].eventType, 0);
        assert.equal(objectMetadata.eventList[0].eventNum, 0);
        assert.equal(objectMetadata.eventList[0].eventContents, "objects/obj_player/0_0.gml");
        assert.equal(await readFile(path.join(projectRoot, "objects/obj_player/0_0.gml"), "utf8"), "x = 2;\n");

        await assert.rejects(
            addObjectEvent({
                descriptor: { category: "Create", descriptor: "0" },
                dryRun: true,
                handlerSource: "x = 3;",
                objectName: "obj_player",
                projectRoot
            }),
            /already has event 0:0/u
        );

        const deleteDryRun = await deleteObjectEvent({
            descriptor: { category: "Create", descriptor: "0" },
            dryRun: true,
            objectName: "obj_player",
            projectRoot
        });
        assert.equal(deleteDryRun.action, "delete");
        assert.equal(deleteDryRun.dryRun, true);
        assert.deepEqual(deleteDryRun.deletedPaths, ["objects/obj_player/0_0.gml"]);
        assert.deepEqual(deleteDryRun.writtenPaths, ["objects/obj_player/obj_player.yy"]);
        await assert.doesNotReject(access(path.join(projectRoot, "objects/obj_player/0_0.gml")));

        const deleteWrite = await deleteObjectEvent({
            descriptor: { category: "Create", descriptor: "0" },
            dryRun: false,
            objectName: "obj_player",
            projectRoot
        });
        assert.equal(deleteWrite.dryRun, false);
        assert.deepEqual(deleteWrite.deletedPaths, ["objects/obj_player/0_0.gml"]);
        await assert.rejects(access(path.join(projectRoot, "objects/obj_player/0_0.gml")));

        const deletedObjectMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(objectMetadataPath, "utf8"),
            objectMetadataPath
        ).document;
        assert.deepEqual(deletedObjectMetadata.eventList, []);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("addRoomInstance appends an object instance to a room with dry-run safety", async () => {
    const projectRoot = await createTemporaryProjectRoot();

    try {
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.OBJECT,
            resourceName: "obj_player"
        });
        await addProjectResource({
            dryRun: false,
            projectRoot,
            resourceKind: ProjectResourceKind.ROOM,
            resourceName: "rm_main"
        });

        const dryRun = await addRoomInstance({
            dryRun: true,
            objectName: "obj_player",
            projectRoot,
            roomName: "rm_main",
            x: 32,
            y: 64
        });
        assert.equal(dryRun.action, "add");
        assert.deepEqual(dryRun.deletedPaths, []);
        assert.equal(dryRun.dryRun, true);
        assert.equal(dryRun.objectPath, "objects/obj_player/obj_player.yy");
        assert.equal(dryRun.roomPath, "rooms/rm_main/rm_main.yy");
        assert.deepEqual(dryRun.writtenPaths, ["rooms/rm_main/rm_main.yy"]);

        const roomMetadataPath = path.join(projectRoot, "rooms/rm_main/rm_main.yy");
        const dryRunRoomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.deepEqual(dryRunRoomMetadata.instanceCreationOrder, []);

        const writeResult = await addRoomInstance({
            dryRun: false,
            objectName: "obj_player",
            projectRoot,
            roomName: "rm_main",
            x: 128,
            y: 256
        });
        assert.equal(writeResult.dryRun, false);
        assert.match(writeResult.instanceId, /^inst_[a-f0-9]{32}$/u);

        const roomMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.equal(roomMetadata.instanceCreationOrder[0].name, writeResult.instanceId);
        assert.equal(roomMetadata.instanceCreationOrder[0].path, "rooms/rm_main/rm_main.yy");
        assert.equal(roomMetadata.layers[0].instances[0].name, writeResult.instanceId);
        assert.equal(roomMetadata.layers[0].instances[0].objectId.name, "obj_player");
        assert.equal(roomMetadata.layers[0].instances[0].objectId.path, "objects/obj_player/obj_player.yy");
        assert.equal(Number(roomMetadata.layers[0].instances[0].x), 128);
        assert.equal(Number(roomMetadata.layers[0].instances[0].y), 256);

        const updateDryRun = await updateRoomInstance({
            dryRun: true,
            instanceId: writeResult.instanceId,
            projectRoot,
            roomName: "rm_main",
            x: 400,
            y: 500
        });
        assert.equal(updateDryRun.action, "update");
        assert.equal(updateDryRun.dryRun, true);
        assert.equal(updateDryRun.x, 400);
        assert.equal(updateDryRun.y, 500);

        const dryRunUpdateMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.equal(Number(dryRunUpdateMetadata.layers[0].instances[0].x), 128);
        assert.equal(Number(dryRunUpdateMetadata.layers[0].instances[0].y), 256);

        const updateWrite = await updateRoomInstance({
            dryRun: false,
            instanceId: writeResult.instanceId,
            projectRoot,
            roomName: "rm_main",
            x: 640,
            y: 360
        });
        assert.equal(updateWrite.action, "update");
        assert.equal(updateWrite.objectPath, "objects/obj_player/obj_player.yy");

        const updatedMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.equal(Number(updatedMetadata.layers[0].instances[0].x), 640);
        assert.equal(Number(updatedMetadata.layers[0].instances[0].y), 360);

        const deleteDryRun = await deleteRoomInstance({
            dryRun: true,
            instanceId: writeResult.instanceId,
            projectRoot,
            roomName: "rm_main"
        });
        assert.equal(deleteDryRun.action, "delete");
        assert.equal(deleteDryRun.dryRun, true);
        assert.equal(deleteDryRun.x, 640);
        assert.equal(deleteDryRun.y, 360);

        const dryRunDeleteMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.equal(dryRunDeleteMetadata.instanceCreationOrder[0].name, writeResult.instanceId);
        assert.equal(dryRunDeleteMetadata.layers[0].instances[0].name, writeResult.instanceId);

        const deleteWrite = await deleteRoomInstance({
            dryRun: false,
            instanceId: writeResult.instanceId,
            projectRoot,
            roomName: "rm_main"
        });
        assert.equal(deleteWrite.action, "delete");
        assert.equal(deleteWrite.objectName, "obj_player");

        const deletedMetadata = Core.parseProjectMetadataDocumentForMutation(
            await readFile(roomMetadataPath, "utf8"),
            roomMetadataPath
        ).document;
        assert.deepEqual(deletedMetadata.instanceCreationOrder, []);
        assert.deepEqual(deletedMetadata.layers[0].instances, []);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("resolveProjectManifestFile returns the only .yyp file with a filename fallback name", async () => {
    const projectRoot = await fsMkdtemp("gmloop-project-resource-");

    try {
        await writeProjectFile(projectRoot, "MyGame.yyp", "");

        const manifest = await resolveProjectManifestFile(projectRoot);
        assert.equal(manifest.absolutePath, path.join(projectRoot, "MyGame.yyp"));
        assert.equal(manifest.projectName, "MyGame");
        assert.equal(manifest.relativePath, "MyGame.yyp");
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("resolveProjectManifestFile throws when the project root is missing a .yyp manifest", async () => {
    const projectRoot = await fsMkdtemp("gmloop-project-resource-");

    try {
        await assert.rejects(resolveProjectManifestFile(projectRoot), /Could not locate a \.yyp manifest/u);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("resolveProjectManifestFile throws when multiple .yyp manifests are present", async () => {
    const projectRoot = await fsMkdtemp("gmloop-project-resource-");

    try {
        await writeProjectFile(projectRoot, "MyGame.yyp", "");
        await writeProjectFile(projectRoot, "Secondary.yyp", "");

        await assert.rejects(resolveProjectManifestFile(projectRoot), /require exactly one project manifest/u);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});

void test("readProjectMetadataDocument returns the parsed JSON document for a metadata file", async () => {
    const projectRoot = await fsMkdtemp("gmloop-project-resource-");
    const metadataRelativePath = "objects/obj_player/obj_player.yy";
    const metadataAbsolutePath = path.join(projectRoot, metadataRelativePath);
    const metadataContents = `${JSON.stringify(
        {
            name: "obj_player",
            resourceType: "GMObject",
            eventList: []
        },
        null,
        4
    )}\n`;

    try {
        await writeProjectFile(projectRoot, metadataRelativePath, metadataContents);

        const document = await readProjectMetadataDocument(metadataAbsolutePath);
        assert.equal(document.name, "obj_player");
        assert.equal(document.resourceType, "GMObject");
        assert.deepEqual(document.eventList, []);
    } finally {
        await rm(projectRoot, { force: true, recursive: true });
    }
});
