import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { runCliTestCommand } from "../src/cli.js";

const cliEntrypoint = fileURLToPath(new URL("../index.js", import.meta.url));

function runValidateCli(args: ReadonlyArray<string>): { exitCode: number; stderr: string; stdout: string } {
    const result = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", cliEntrypoint, ...args], {
        encoding: "utf8"
    });
    return {
        exitCode: result.status ?? 1,
        stderr: result.stderr,
        stdout: result.stdout
    };
}

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

void test("validate project rejects a missing project directory with JSON output", async () => {
    const missingProjectRoot = path.join(
        os.tmpdir(),
        `gmloop-missing-project-${String(process.pid)}-${String(Date.now())}`
    );
    const result = runValidateCli(["validate", "project", "--path", missingProjectRoot, "--json"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout) as {
        error: { message: string };
        ok: boolean;
        scope: string;
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.scope, "project");
    assert.match(payload.error.message, /project directory does not exist/i);
});

void test("validate project rejects a directory without a .yyp manifest", async () => {
    await withTempDir(async (projectRoot) => {
        const result = runValidateCli(["validate", "project", "--path", projectRoot, "--json"]);

        assert.equal(result.exitCode, 1);
        assert.equal(result.stderr, "");
        const payload = JSON.parse(result.stdout) as {
            error: { message: string };
            ok: boolean;
            scope: string;
        };
        assert.equal(payload.ok, false);
        assert.equal(payload.scope, "project");
        assert.match(payload.error.message, /\.yyp manifest/i);
    });
});

void test("validate project accepts a directory with a .yyp manifest", async () => {
    await withTempDir(async (projectRoot) => {
        await writeFile(path.join(projectRoot, "Example.yyp"), JSON.stringify({ resources: [] }), "utf8");
        const result = await runCliTestCommand({
            argv: ["validate", "project", "--path", projectRoot, "--json"]
        });

        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; scope: string };
        assert.equal(payload.ok, true);
        assert.equal(payload.scope, "project");
    });
});

void test("validate file emits JSON failures when --json is requested", async () => {
    const missingFile = path.join(os.tmpdir(), `gmloop-missing-file-${String(process.pid)}-${String(Date.now())}.gml`);
    const result = runValidateCli(["validate", "file", missingFile, "--json"]);

    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout) as {
        error: { message: string };
        ok: boolean;
        scope: string;
    };
    assert.equal(payload.ok, false);
    assert.equal(payload.scope, "file");
    assert.match(payload.error.message, /ENOENT|no such file/i);
});
