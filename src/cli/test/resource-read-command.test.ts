import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gmloop-resource-read-"));
    try {
        return await callback(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

void test("resource command catalog includes list and find leaves", async () => {
    const { getCliCommandCatalog } = await import("../src/cli.js");
    const catalog = getCliCommandCatalog();
    assert.ok(catalog.some((entry) => entry.displayName === "resource list"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource find"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource inspect"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource deps"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource dependents"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource audit"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource rename"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource duplicate"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource move"));
});

void test("resource find returns graph search payload", async () => {
    await withTempDir(async (projectRoot) => {
        await writeFile(path.join(projectRoot, "Project.yyp"), JSON.stringify({ name: "Project" }), "utf8");
        await mkdir(path.join(projectRoot, "scripts", "demo"), { recursive: true });
        await writeFile(
            path.join(projectRoot, "scripts", "demo", "demo.yy"),
            JSON.stringify({ name: "demo", resourceType: "GMScript" }),
            "utf8"
        );
        await writeFile(
            path.join(projectRoot, "scripts", "demo", "demo.gml"),
            "function demo() { return 1; }\n",
            "utf8"
        );

        const result = await runCliTestCommand({
            argv: ["resource", "find", "demo", "--path", projectRoot, "--json"]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; payload: { query: string } };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.query, "demo");
    });
});

void test("resource rename/duplicate/move require their contract options", async () => {
    const renameHelp = await runCliTestCommand({
        argv: ["resource", "rename", "--help"]
    });
    assert.equal(renameHelp.exitCode, 0);
    assert.match(renameHelp.stdout, /--new-name <name>/);

    const duplicateHelp = await runCliTestCommand({
        argv: ["resource", "duplicate", "--help"]
    });
    assert.equal(duplicateHelp.exitCode, 0);
    assert.match(duplicateHelp.stdout, /--new-name <name>/);

    const moveHelp = await runCliTestCommand({
        argv: ["resource", "move", "--help"]
    });
    assert.equal(moveHelp.exitCode, 0);
    assert.match(moveHelp.stdout, /--destination-folder <path>/);
});

void test("resource rename/duplicate/move resolve to implemented backend mutations", async () => {
    await withTempDir(async (projectRoot) => {
        await writeFile(
            path.join(projectRoot, "Project.yyp"),
            JSON.stringify({ name: "Project", resources: [] }),
            "utf8"
        );

        const rename = await runCliTestCommand({
            argv: ["resource", "rename", "script", "old_name", "--new-name", "new_name", "--path", projectRoot]
        });
        assert.equal(rename.exitCode, 1);
        assert.match(rename.stderr, /Could not find a script resource named 'old_name'/u);

        const duplicate = await runCliTestCommand({
            argv: ["resource", "duplicate", "script", "old_name", "--new-name", "copy_name", "--path", projectRoot]
        });
        assert.equal(duplicate.exitCode, 1);
        assert.match(duplicate.stderr, /Could not find a script resource named 'old_name'/u);

        const move = await runCliTestCommand({
            argv: [
                "resource",
                "move",
                "script",
                "old_name",
                "--destination-folder",
                "scripts/new_folder",
                "--path",
                projectRoot
            ]
        });
        assert.equal(move.exitCode, 1);
        assert.match(move.stderr, /Could not find a script resource named 'old_name'/u);
    });
});
