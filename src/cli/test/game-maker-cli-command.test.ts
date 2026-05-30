import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    resolveGameMakerCliMcpProjectPath,
    writeGameMakerCliActiveProjectState
} from "../src/commands/game-maker-cli.js";

void test("gm-cli mcp help documents active project path resolution", async () => {
    const result = await runCliTestCommand({
        argv: ["gm-cli", "mcp", "--help"]
    });

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Start the official gm-cli ResourceTool MCP server/u);
    assert.match(result.stdout, /GMLOOP_GM_CLI_PROJECT_PATH/u);
    assert.match(result.stdout, /gm-cli-active-project\.json/u);
});

void test("gm-cli active-project state stores a resolved .yyp path", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-gm-cli-active-project-"));
    const projectDirectory = path.join(temporaryDirectory, "Game");
    const projectPath = path.join(projectDirectory, "Game.yyp");
    const statePath = path.join(temporaryDirectory, "state", "active-project.json");

    try {
        await mkdir(projectDirectory, { recursive: true });
        await writeFile(projectPath, "{}\n", "utf8");

        const result = await writeGameMakerCliActiveProjectState({
            env: {},
            projectPath: projectDirectory,
            statePathOption: statePath
        });

        assert.deepEqual(result, { projectPath, statePath });
        assert.equal(
            await resolveGameMakerCliMcpProjectPath({
                env: {},
                statePathOption: statePath
            }),
            projectPath
        );
    } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
});

void test("gm-cli mcp project path resolution prefers explicit path over state", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-gm-cli-resolution-"));
    const stateProjectDirectory = path.join(temporaryDirectory, "StateProject");
    const explicitProjectDirectory = path.join(temporaryDirectory, "ExplicitProject");
    const stateProjectPath = path.join(stateProjectDirectory, "StateProject.yyp");
    const explicitProjectPath = path.join(explicitProjectDirectory, "ExplicitProject.yyp");
    const statePath = path.join(temporaryDirectory, "active-project.json");

    try {
        await mkdir(stateProjectDirectory, { recursive: true });
        await mkdir(explicitProjectDirectory, { recursive: true });
        await writeFile(stateProjectPath, "{}\n", "utf8");
        await writeFile(explicitProjectPath, "{}\n", "utf8");
        await writeGameMakerCliActiveProjectState({
            env: {},
            projectPath: stateProjectPath,
            statePathOption: statePath
        });

        const resolvedProjectPath = await resolveGameMakerCliMcpProjectPath({
            env: {},
            pathOption: explicitProjectDirectory,
            statePathOption: statePath
        });

        assert.equal(resolvedProjectPath, explicitProjectPath);
    } finally {
        await rm(temporaryDirectory, { force: true, recursive: true });
    }
});
