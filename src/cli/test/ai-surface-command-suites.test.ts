import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getCliCommandCatalog, runCliTestCommand } from "../src/cli.js";

void test("AI surface command catalog includes planned leaf commands", () => {
    const catalog = getCliCommandCatalog();
    const leaves = new Set(catalog.map((entry) => entry.displayName));

    const expectedLeaves = [
        "room list",
        "room inspect",
        "room query",
        "room instance add",
        "room layer list",
        "room camera list",
        "object list",
        "object inspect",
        "object update",
        "object event list",
        "project cache clean",
        "ui inspect",
        "ui validate",
        "ui preview",
        "profile start",
        "profile stop",
        "profile snapshot",
        "profile compare",
        "profile report",
        "test run",
        "test list",
        "test results",
        "test case create",
        "test case update",
        "replay record",
        "replay run",
        "replay compare",
        "replay assert"
    ];

    for (const leaf of expectedLeaves) {
        assert.equal(leaves.has(leaf), true, `Expected leaf command in catalog: ${leaf}`);
    }
});

void test("ui validate command executes successfully with structured payload", async () => {
    const result = await runCliTestCommand({
        argv: ["ui", "validate", "--json"]
    });

    assert.equal(result.exitCode, 0);

    const payload = JSON.parse(result.stdout) as {
        command: string;
        ok: boolean;
        payload: {
            catalogBackend: string;
            mutationBackend: string;
        };
    };

    assert.equal(payload.command, "ui validate");
    assert.equal(payload.ok, true);
    assert.equal(payload.payload.catalogBackend, "available");
});

void test("replay run returns machine-readable payload", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-ai-surface-replay-"));
    await writeFile(path.join(projectRoot, "stub.yyp"), "{}\n", "utf8");
    const result = await runCliTestCommand({
        argv: ["replay", "run", "--json", "--path", projectRoot]
    });

    assert.equal(result.exitCode, 0);

    const payload = JSON.parse(result.stdout) as {
        command: string;
        payload: {
            ok: boolean;
            reason?: string;
        };
    };

    assert.equal(payload.command, "replay run");
    assert.equal(typeof payload.payload.ok, "boolean");
});
