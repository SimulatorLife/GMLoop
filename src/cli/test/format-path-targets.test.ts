import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void test("format accepts a .yyp --path target and formats project .gml files", async () => {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-format-yyp-"));

    try {
        const yypPath = path.join(temporaryDirectory, "MyGame.yyp");
        const sourcePath = path.join(temporaryDirectory, "demo.gml");
        await writeFile(yypPath, JSON.stringify({ name: "MyGame" }), "utf8");
        await writeFile(sourcePath, "function demo( ) {\nif(true){\nreturn 1;\n}\n}\n", "utf8");

        const result = await runCliTestCommand({
            argv: ["format", "--write", "--path", yypPath]
        });

        assert.equal(result.exitCode, 0);
        const formattedSource = await readFile(sourcePath, "utf8");
        assert.match(formattedSource, /if \(true\) \{/);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
});
