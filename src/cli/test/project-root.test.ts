import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import {
    discoverProjectRoot,
    filterGraphIndexResultsByKind,
    resolveCommandProjectContext,
    resolveExistingGmloopConfigPath,
    resolveExplicitWorkflowTargetPath,
    resolveGameMakerCliActiveTargetPath,
    resolveWorkflowTargetPath
} from "../src/workflow/project-root.js";

/**
 * Per-test-instance state to avoid cross-test contamination when tests
 * run in parallel (e.g., multiple Node.js workers, or future worker_threads
 * test execution). Keeping cleanup tracking local to each test ensures
 * that one test's temporary directory is never accidentally removed by
 * another test's teardown, and that one test's teardown never blocks a
 * concurrent test's resource usage.
 */
class TestState {
    public readonly tempDirs: Array<string> = [];

    public async createTempDirectory(): Promise<string> {
        const directoryPath = await mkdtemp(path.join(os.tmpdir(), "cli-project-root-"));
        this.tempDirs.push(directoryPath);
        return directoryPath;
    }

    public async cleanup(): Promise<void> {
        await Promise.all(
            this.tempDirs.splice(0).map(async (directoryPath) => {
                await rm(directoryPath, { recursive: true, force: true });
            })
        );
    }
}

void describe("resolveExistingGmloopConfigPath", () => {
    const state = new TestState();

    afterEach(() => state.cleanup());

    void it("accepts gmloop.json symlinks that point at files", async () => {
        const projectRoot = await state.createTempDirectory();
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

void describe("filterGraphIndexResultsByKind", () => {
    void it("returns an empty array for empty input", () => {
        const results: Array<{ kind: string }> = [];
        const filtered = filterGraphIndexResultsByKind(results, "room");
        assert.equal(filtered.length, 0);
    });

    void it("returns only entries matching the specified kind", () => {
        const results = [
            { kind: "room", id: "room-1", name: "Main" },
            { kind: "object", id: "obj-1", name: "Player" },
            { kind: "room", id: "room-2", name: "Hub" },
            { kind: "script", id: "scr-1", name: "init" }
        ] as const;
        const filtered = filterGraphIndexResultsByKind(results, "room");
        assert.equal(filtered.length, 2);
        assert.equal(filtered[0].id, "room-1");
        assert.equal(filtered[1].id, "room-2");
    });

    void it("returns an empty array when no entries match the kind", () => {
        const results = [
            { kind: "script", id: "scr-1" },
            { kind: "function", id: "fn-1" }
        ] as const;
        const filtered = filterGraphIndexResultsByKind(results, "object");
        assert.equal(filtered.length, 0);
    });

    void it("preserves readonly input array when filtering", () => {
        const results: readonly { kind: string }[] = [{ kind: "room" }, { kind: "room" }];
        const filtered = filterGraphIndexResultsByKind(results, "room");
        assert.equal(filtered.length, 2);
    });

    void it("returns the first matching entry via index access", () => {
        const results = [
            { kind: "room", id: "room-first" },
            { kind: "room", id: "room-second" }
        ] as const;
        const first = filterGraphIndexResultsByKind(results, "room")[0];
        assert.equal(first?.id, "room-first");
    });
});

void describe("discoverProjectRoot", () => {
    const state = new TestState();

    afterEach(() => state.cleanup());

    void it("discovers the enclosing project root when --path points to a single .gml file", async () => {
        const projectRoot = await state.createTempDirectory();
        const scriptPath = path.join(projectRoot, "scripts", "demo", "demo.gml");
        await mkdir(path.dirname(scriptPath), { recursive: true });
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(scriptPath, "function demo() { return 1; }\n", "utf8");

        const discoveredProjectRoot = await discoverProjectRoot({
            explicitProjectPath: scriptPath
        });

        assert.equal(discoveredProjectRoot, projectRoot);
    });

    void it("uses the shared active project state before cwd discovery", async () => {
        const projectRoot = await state.createTempDirectory();
        const statePath = path.join(await state.createTempDirectory(), "active-project.json");
        const projectPath = path.join(projectRoot, "MyGame.yyp");
        await writeFile(projectPath, JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(statePath, `${JSON.stringify({ projectPath })}\n`, "utf8");

        const discoveredProjectRoot = await discoverProjectRoot({
            env: { GMLOOP_GM_CLI_PROJECT_STATE_PATH: statePath }
        });

        assert.equal(discoveredProjectRoot, projectRoot);
    });

    void it("uses activeFilePath for file targets while retaining projectPath for project targets", async () => {
        const projectRoot = await state.createTempDirectory();
        const environmentProjectRoot = await state.createTempDirectory();
        const statePath = path.join(await state.createTempDirectory(), "active-project.json");
        const projectPath = path.join(projectRoot, "MyGame.yyp");
        const environmentProjectPath = path.join(environmentProjectRoot, "EnvironmentGame.yyp");
        const activeFilePath = path.join(projectRoot, "scripts", "demo.gml");
        await mkdir(path.dirname(activeFilePath), { recursive: true });
        await writeFile(projectPath, JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(environmentProjectPath, JSON.stringify({ name: "EnvironmentGame" }), "utf8");
        await writeFile(activeFilePath, "function demo() { return 1; }\n", "utf8");
        await writeFile(statePath, `${JSON.stringify({ activeFilePath, projectPath })}\n`, "utf8");

        const env = {
            GMLOOP_GM_CLI_PROJECT_PATH: environmentProjectPath,
            GMLOOP_GM_CLI_PROJECT_STATE_PATH: statePath
        };
        const stateOnlyEnv = { GMLOOP_GM_CLI_PROJECT_STATE_PATH: statePath };
        assert.equal(await resolveGameMakerCliActiveTargetPath({ env: stateOnlyEnv, scope: "file" }), activeFilePath);
        assert.equal(
            await resolveWorkflowTargetPath({ env: stateOnlyEnv, fallbackPath: ".", scope: "file" }),
            activeFilePath
        );
        assert.equal(
            await resolveWorkflowTargetPath({ env: stateOnlyEnv, fallbackPath: ".", scope: "project" }),
            projectPath
        );
        assert.equal(
            await resolveWorkflowTargetPath({ env, fallbackPath: ".", scope: "project" }),
            environmentProjectPath
        );
        assert.equal(
            await resolveWorkflowTargetPath({
                env,
                explicitPath: activeFilePath,
                fallbackPath: ".",
                scope: "file"
            }),
            activeFilePath
        );
    });

    void it("fails clearly when the active project state points to a missing target", async () => {
        const statePath = path.join(await state.createTempDirectory(), "active-project.json");
        await writeFile(
            statePath,
            `${JSON.stringify({ projectPath: path.join(path.dirname(statePath), "missing", "MyGame.yyp") })}\n`,
            "utf8"
        );

        await assert.rejects(
            discoverProjectRoot({
                env: { GMLOOP_GM_CLI_PROJECT_STATE_PATH: statePath }
            }),
            /GameMaker project target path does not exist/u
        );
    });
});

void describe("resolveCommandProjectContext", () => {
    const state = new TestState();

    afterEach(() => state.cleanup());

    void it("returns the resolved projectRoot and an empty projectConfig when no gmloop.json exists", async () => {
        const projectRoot = await state.createTempDirectory();
        // Write a .yyp so discoverProjectRoot can locate the project root from the path option.
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot });

        assert.equal(context.projectRoot, projectRoot);
        assert.deepEqual(context.projectConfig, {});
    });

    void it("loads projectConfig from gmloop.json in the project root", async () => {
        const projectRoot = await state.createTempDirectory();
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        const configData = { lint: { enabled: true }, outputDir: "build" };
        await writeFile(path.join(projectRoot, "gmloop.json"), JSON.stringify(configData), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot });

        assert.equal(context.projectRoot, projectRoot);
        assert.deepEqual(context.projectConfig, configData);
    });

    void it("uses an explicit --config path instead of the default gmloop.json location", async () => {
        const projectRoot = await state.createTempDirectory();
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
        const projectRoot = await state.createTempDirectory();
        await writeFile(path.join(projectRoot, "MyGame.yyp"), JSON.stringify({ name: "MyGame" }), "utf8");
        // Write a JSON array at the config path — not a plain object.
        await writeFile(path.join(projectRoot, "gmloop.json"), JSON.stringify([1, 2, 3]), "utf8");

        const context = await resolveCommandProjectContext({ path: projectRoot });

        assert.deepEqual(context.projectConfig, {});
    });
});
