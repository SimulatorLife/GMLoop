import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void test("test case create supports dry-run and apply modes with deterministic payloads", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-create-"));
    const projectPath = path.join(projectRoot, "Game.yyp");
    await writeFile(projectPath, "{}\n", "utf8");

    const dryRun = await runCliTestCommand({
        argv: ["test", "case", "create", "scr_damage_enemy", "kills_enemy_at_zero_hp", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(dryRun.exitCode, 0);
    const dryRunPayload = JSON.parse(dryRun.stdout) as {
        payload: { changed: boolean; manifestPath: string | null; mode: string };
    };
    assert.equal(dryRunPayload.payload.mode, "dry-run");
    assert.equal(dryRunPayload.payload.changed, true);
    assert.equal(dryRunPayload.payload.manifestPath, null);

    const apply = await runCliTestCommand({
        argv: [
            "test",
            "case",
            "create",
            "scr_damage_enemy",
            "kills_enemy_at_zero_hp",
            "--path",
            projectPath,
            "--expected",
            "Enemy dies when HP reaches zero",
            "--write",
            "--json"
        ],
        cwd: projectRoot
    });
    assert.equal(apply.exitCode, 0);
    const applyPayload = JSON.parse(apply.stdout) as { payload: { manifestPath: string; mode: string } };
    assert.equal(applyPayload.payload.mode, "apply");
    assert.match(applyPayload.payload.manifestPath, /\.gmloop[\\/]test[\\/]cases\.json$/u);

    const manifestText = await readFile(applyPayload.payload.manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as {
        cases: Array<{ expected?: string; name: string; target: string }>;
        version: string;
    };
    assert.equal(manifest.version, "1");
    assert.deepEqual(manifest.cases, [
        {
            expected: "Enemy dies when HP reaches zero",
            name: "kills_enemy_at_zero_hp",
            target: "scr_damage_enemy"
        }
    ]);
});

void test("test case update reports missing cases and updates persisted entries", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-update-"));
    const projectPath = path.join(projectRoot, "Game.yyp");
    await writeFile(projectPath, "{}\n", "utf8");

    const missing = await runCliTestCommand({
        argv: ["test", "case", "update", "scr_missing", "missing_case", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(missing.exitCode, 0);
    const missingPayload = JSON.parse(missing.stdout) as { payload: { ok: boolean; reason: string } };
    assert.equal(missingPayload.payload.ok, false);
    assert.equal(missingPayload.payload.reason, "test_case_not_found");

    await runCliTestCommand({
        argv: [
            "test",
            "case",
            "create",
            "scr_damage_enemy",
            "kills_enemy_at_zero_hp",
            "--path",
            projectPath,
            "--write",
            "--json"
        ],
        cwd: projectRoot
    });

    const update = await runCliTestCommand({
        argv: [
            "test",
            "case",
            "update",
            "scr_damage_enemy",
            "kills_enemy_at_zero_hp",
            "--path",
            projectPath,
            "--expected",
            "Includes burn-over-time edge case",
            "--write",
            "--json"
        ],
        cwd: projectRoot
    });
    assert.equal(update.exitCode, 0);
    const updatePayload = JSON.parse(update.stdout) as {
        payload: { changed: boolean; manifestPath: string | null; ok: boolean };
    };
    assert.equal(updatePayload.payload.ok, true);
    assert.equal(updatePayload.payload.changed, true);
    assert.ok(updatePayload.payload.manifestPath);

    const outputPath = updatePayload.payload.manifestPath;
    assert.ok(outputPath);
    const manifestText = await readFile(outputPath, "utf8");
    const manifest = JSON.parse(manifestText) as { cases: Array<{ expected?: string; name: string; target: string }> };
    assert.equal(manifest.cases[0]?.expected, "Includes burn-over-time edge case");
});
