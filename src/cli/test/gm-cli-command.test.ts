import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getCliCommandCatalog, runCliTestCommand } from "../src/cli.js";

async function withTempExecutable<T>(contents: string, callback: (toolPath: string) => Promise<T>): Promise<T> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-gm-cli-command-"));
    const toolPath = path.join(tempRoot, "fake-gm-cli");

    try {
        await writeFile(toolPath, contents, "utf8");
        await chmod(toolPath, 0o755);
        return await callback(toolPath);
    } finally {
        await rm(tempRoot, { force: true, recursive: true });
    }
}

void test("gm-cli command is exposed in the CLI catalog", () => {
    const catalog = getCliCommandCatalog();
    assert.equal(
        catalog.some((entry) => entry.displayName === "gm-cli"),
        true
    );
});

void test("gm-cli command forwards arguments to the configured executable", async () => {
    await withTempExecutable(
        "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n",
        async (toolPath) => {
            const result = await runCliTestCommand({
                argv: ["gm-cli", "--tool-path", toolPath, "compile", "--target=html5", "--runtime=vm"]
            });

            assert.equal(result.exitCode, 7);
            assert.deepEqual(JSON.parse(result.stdout) as Array<string>, ["compile", "--target=html5", "--runtime=vm"]);
        }
    );
});
