import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gmloop-validate-"));
    try {
        return await callback(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

void test("validate command catalog includes file/project/room/resource leaves", async () => {
    const { getCliCommandCatalog } = await import("../src/cli.js");
    const catalog = getCliCommandCatalog();
    assert.ok(catalog.some((entry) => entry.displayName === "validate file"));
    assert.ok(catalog.some((entry) => entry.displayName === "validate project"));
    assert.ok(catalog.some((entry) => entry.displayName === "validate room"));
    assert.ok(catalog.some((entry) => entry.displayName === "validate resource"));
});

void test("validate file parses a valid GML file", async () => {
    await withTempDir(async (dir) => {
        const filePath = path.join(dir, "example.gml");
        await writeFile(filePath, "var score = 1;\n", "utf8");
        const result = await runCliTestCommand({
            argv: ["validate", "file", filePath, "--json"]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; scope: string };
        assert.equal(payload.ok, true);
        assert.equal(payload.scope, "file");
    });
});

void test("validate file accepts kind/scope/fix options", async () => {
    await withTempDir(async (dir) => {
        const filePath = path.join(dir, "example.gml");
        await writeFile(filePath, "var score = 1;\n", "utf8");
        const result = await runCliTestCommand({
            argv: ["validate", "file", filePath, "--kind", "gml", "--scope", "syntax", "--fix", "--json"]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as {
            ok: boolean;
            payload: { fixApplied: boolean; kind: string; scope: string };
            scope: string;
        };
        assert.equal(payload.ok, true);
        assert.equal(payload.scope, "file");
        assert.equal(payload.payload.kind, "gml");
        assert.equal(payload.payload.scope, "syntax");
        assert.equal(payload.payload.fixApplied, false);
    });
});
