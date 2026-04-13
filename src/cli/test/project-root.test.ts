import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
    discoverProjectRoot,
    resolveExistingGmloopConfigPath,
    resolveExplicitWorkflowTargetPath
} from "../src/workflow/project-root.js";

const temporaryDirectories: Array<string> = [];

async function createTemporaryDirectory(): Promise<string> {
    const directoryPath = await mkdtemp(path.join(os.tmpdir(), "cli-project-root-"));
    temporaryDirectories.push(directoryPath);
    return directoryPath;
}

void describe("resolveExistingGmloopConfigPath", () => {
    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.splice(0).map(async (directoryPath) => {
                await rm(directoryPath, { recursive: true, force: true });
            })
        );
    });

    void it("accepts gmloop.json symlinks that point at files", async () => {
        const projectRoot = await createTemporaryDirectory();
        const actualConfigPath = path.join(projectRoot, "shared-gmloop.json");
        const symlinkConfigPath = path.join(projectRoot, "gmloop.json");

        await writeFile(actualConfigPath, JSON.stringify({ projectRoot }), "utf8");
        await symlink(actualConfigPath, symlinkConfigPath);

        const resolvedConfigPath = await resolveExistingGmloopConfigPath(projectRoot, undefined);

        assert.equal(resolvedConfigPath, symlinkConfigPath);
    });
});

void describe("resolveExplicitWorkflowTargetPath", () => {
    void it("normalizes .yyp file paths to their project directory", () => {
        const normalizedPath = resolveExplicitWorkflowTargetPath("/tmp/MyGame/MyGame.yyp");
        assert.equal(normalizedPath, path.resolve("/tmp/MyGame"));
    });

    void it("returns .gml file paths as file targets", () => {
        const normalizedPath = resolveExplicitWorkflowTargetPath("/tmp/MyGame/scripts/demo/demo.gml");
        assert.equal(normalizedPath, path.resolve("/tmp/MyGame/scripts/demo/demo.gml"));
    });
});

void describe("discoverProjectRoot", () => {
    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.splice(0).map(async (directoryPath) => {
                await rm(directoryPath, { recursive: true, force: true });
            })
        );
    });

    void it("discovers the enclosing project root when --path points to a single .gml file", async () => {
        const projectRoot = await createTemporaryDirectory();
        const scriptPath = path.join(projectRoot, "scripts", "demo", "demo.gml");
        await mkdir(path.dirname(scriptPath), { recursive: true });
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(scriptPath, "function demo() { return 1; }\n", "utf8");

        const discoveredProjectRoot = await discoverProjectRoot({
            explicitProjectPath: scriptPath
        });

        assert.equal(discoveredProjectRoot, projectRoot);
    });
});
