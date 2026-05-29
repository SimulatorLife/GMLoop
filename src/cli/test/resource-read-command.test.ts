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
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource add"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource remove"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource rename"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource duplicate"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource move"),
        false
    );
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

void test("resource command help points edits at gm-cli resourcetool", async () => {
    await withTempDir(async (projectRoot) => {
        await writeFile(path.join(projectRoot, "Project.yyp"), JSON.stringify({ name: "Project" }), "utf8");

        const helpResult = await runCliTestCommand({
            argv: ["resource", "--help"],
            cwd: projectRoot
        });
        assert.equal(helpResult.exitCode, 0);
        assert.match(helpResult.stdout, /@gamemaker\/gm-cli@latest resourcetool eval/u);
    });
});
