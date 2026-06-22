import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

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
