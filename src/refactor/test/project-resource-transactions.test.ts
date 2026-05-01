import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Semantic } from "@gmloop/semantic";

import {
    addProjectResource,
    duplicateProjectResource,
    moveProjectResource,
    ProjectResourceKind,
    removeProjectResource,
    renameProjectResource
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

        const manifestDocument = Semantic.parseProjectMetadataDocumentForMutation(
            await readFile(path.join(projectRoot, "MyGame.yyp"), "utf8"),
            path.join(projectRoot, "MyGame.yyp")
        ).document;
        assert.equal(manifestDocument.resources[0].id.name, "scr_bootstrap");
        assert.equal(manifestDocument.resources[0].id.path, "scripts/scr_bootstrap/scr_bootstrap.yy");

        const scriptMetadataPath = path.join(projectRoot, "scripts/scr_bootstrap/scr_bootstrap.yy");
        const scriptMetadata = Semantic.parseProjectMetadataDocumentForMutation(
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
        const spriteMetadata = Semantic.parseProjectMetadataDocumentForMutation(
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

        const manifestDocument = Semantic.parseProjectMetadataDocumentForMutation(
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
