import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
    discoverProjectRoot,
    resolveCommandProjectContext,
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

void describe("resolveCommandProjectContext", () => {
    afterEach(async () => {
        await Promise.all(
            temporaryDirectories.splice(0).map(async (directoryPath) => {
                await rm(directoryPath, { recursive: true, force: true });
            })
        );
    });

    void it("returns the resolved projectRoot and an empty projectConfig when no gmloop.json exists", async () => {
        const projectRoot = await createTemporaryDirectory();
        // Write a .yyp so discoverProjectRoot can locate the project root from the path option.
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot });

        assert.equal(context.projectRoot, projectRoot);
        assert.deepEqual(context.projectConfig, {});
    });

    void it("loads projectConfig from gmloop.json in the project root", async () => {
        const projectRoot = await createTemporaryDirectory();
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        const configData = { lint: { enabled: true }, outputDir: "build" };
        await writeFile(path.join(projectRoot, "gmloop.json"), JSON.stringify(configData), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot });

        assert.equal(context.projectRoot, projectRoot);
        assert.deepEqual(context.projectConfig, configData);
    });

    void it("uses an explicit --config path instead of the default gmloop.json location", async () => {
        const projectRoot = await createTemporaryDirectory();
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        const customConfigPath = path.join(projectRoot, "custom-config.json");
        const customConfigData = { custom: true };
        await writeFile(customConfigPath, JSON.stringify(customConfigData), "utf8");
        // Write a different gmloop.json to confirm the explicit path wins.
        await writeFile(path.join(projectRoot, "gmloop.json"), JSON.stringify({ custom: false }), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot, config: customConfigPath });

        assert.deepEqual(context.projectConfig, customConfigData);
    });

    void it("returns an empty projectConfig when gmloop.json exists but is not a plain object", async () => {
        const projectRoot = await createTemporaryDirectory();
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        // Write a JSON array at the config path — not a plain object.
        await writeFile(path.join(projectRoot, "gmloop.json"), JSON.stringify([1, 2, 3]), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot });

        assert.deepEqual(context.projectConfig, {});
    });
});
