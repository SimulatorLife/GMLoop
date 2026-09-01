import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { writeGameMakerCliActiveProjectState } from "../src/workflow/project-root.js";

void test("format accepts a .yyp --path target and formats project .gml files, while ignoring cache and .gmcache", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-format-yyp-"));

    try {
        const yypPath = path.join(temporaryDirectory, "MyGame.yyp");
        const sourcePath = path.join(temporaryDirectory, "demo.gml");
        const gmcacheSourcePath = path.join(temporaryDirectory, ".gmcache", "nested", "demo.gml");
        const cacheSourcePath = path.join(temporaryDirectory, "cache", "nested", "demo.gml");

        await writeFile(yypPath, JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(sourcePath, "function demo( ) {\nif(true){\nreturn 1;\n}\n}\n", "utf8");

        await mkdir(path.dirname(gmcacheSourcePath), { recursive: true });
        await mkdir(path.dirname(cacheSourcePath), { recursive: true });
        await writeFile(gmcacheSourcePath, "function demo( ) {\nif(true){\nreturn 1;\n}\n}\n", "utf8");
        await writeFile(cacheSourcePath, "function demo( ) {\nif(true){\nreturn 1;\n}\n}\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["format", "--write", "--path", yypPath]
        });

        assert.equal(result.exitCode, 0);
        const formattedSource = await readFile(sourcePath, "utf8");
        assert.match(formattedSource, /if \(true\) \{/);

        // Files in .gmcache and cache should remain unformatted (not formatted)
        const gmcacheSource = await readFile(gmcacheSourcePath, "utf8");
        assert.match(gmcacheSource, /if\(true\)\{\r?\nreturn 1;\r?\n\}\r?\n/);

        const cacheSource = await readFile(cacheSourcePath, "utf8");
        assert.match(cacheSource, /if\(true\)\{\r?\nreturn 1;\r?\n\}\r?\n/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});

void test("format uses the active file from shared project state when no target is supplied", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-format-active-file-"));

    try {
        const projectPath = path.join(temporaryDirectory, "MyGame.yyp");
        const sourcePath = path.join(temporaryDirectory, "demo.gml");
        const statePath = path.join(temporaryDirectory, "active-project.json");
        const cwd = path.join(temporaryDirectory, "agent-cwd");

        await mkdir(cwd, { recursive: true });
        await writeFile(projectPath, JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(sourcePath, "function demo( ) {\nif(true){\nreturn 1;\n}\n}\n", "utf8");
        await writeGameMakerCliActiveProjectState({
            activeFilePath: sourcePath,
            env: process.env,
            projectPath,
            statePathOption: statePath
        });

        const result = await runCliTestCommand({
            argv: ["format", "--write"],
            cwd,
            env: {
                GMLOOP_GM_CLI_PROJECT_PATH: undefined,
                GMLOOP_GM_CLI_PROJECT_STATE_PATH: statePath
            }
        });

        assert.equal(result.exitCode, 0);
        assert.match(await readFile(sourcePath, "utf8"), /if \(true\) \{/u);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
