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

void test("test case list returns persisted cases and supports filtering by target", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-list-"));
    const projectPath = path.join(projectRoot, "Game.yyp");
    await writeFile(projectPath, "{}\n", "utf8");

    const empty = await runCliTestCommand({
        argv: ["test", "case", "list", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(empty.exitCode, 0);
    const emptyPayload = JSON.parse(empty.stdout) as { payload: { cases: Array<unknown>; count: number } };
    assert.equal(emptyPayload.payload.count, 0);
    assert.deepEqual(emptyPayload.payload.cases, []);

    for (const [target, name] of [
        ["scr_damage_enemy", "kills_enemy_at_zero_hp"],
        ["scr_damage_enemy", "ignores_negative_damage"],
        ["scr_heal_player", "caps_at_max_hp"]
    ]) {
        await runCliTestCommand({
            argv: ["test", "case", "create", target, name, "--path", projectPath, "--write", "--json"],
            cwd: projectRoot
        });
    }

    const all = await runCliTestCommand({
        argv: ["test", "case", "list", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(all.exitCode, 0);
    const allPayload = JSON.parse(all.stdout) as {
        payload: { cases: Array<{ name: string; target: string }>; count: number };
    };
    assert.equal(allPayload.payload.count, 3);
    assert.deepEqual(
        allPayload.payload.cases.map((entry) => `${entry.target}:${entry.name}`),
        [
            "scr_damage_enemy:ignores_negative_damage",
            "scr_damage_enemy:kills_enemy_at_zero_hp",
            "scr_heal_player:caps_at_max_hp"
        ]
    );

    const filtered = await runCliTestCommand({
        argv: ["test", "case", "list", "--target", "scr_damage_enemy", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(filtered.exitCode, 0);
    const filteredPayload = JSON.parse(filtered.stdout) as {
        payload: { cases: Array<{ name: string; target: string }>; count: number };
    };
    assert.equal(filteredPayload.payload.count, 2);
    assert.ok(filteredPayload.payload.cases.every((entry) => entry.target === "scr_damage_enemy"));
});

void test("test case delete reports missing cases and removes persisted entries", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-test-case-delete-"));
    const projectPath = path.join(projectRoot, "Game.yyp");
    await writeFile(projectPath, "{}\n", "utf8");

    const missingDryRun = await runCliTestCommand({
        argv: ["test", "case", "delete", "scr_missing", "missing_case", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(missingDryRun.exitCode, 0);
    const missingPayload = JSON.parse(missingDryRun.stdout) as { payload: { ok: boolean; reason: string } };
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
    await runCliTestCommand({
        argv: [
            "test",
            "case",
            "create",
            "scr_heal_player",
            "caps_at_max_hp",
            "--path",
            projectPath,
            "--write",
            "--json"
        ],
        cwd: projectRoot
    });

    const dryRunDelete = await runCliTestCommand({
        argv: ["test", "case", "delete", "scr_damage_enemy", "kills_enemy_at_zero_hp", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    assert.equal(dryRunDelete.exitCode, 0);
    const dryRunDeletePayload = JSON.parse(dryRunDelete.stdout) as {
        payload: { manifestPath: string | null; mode: string; ok: boolean };
    };
    assert.equal(dryRunDeletePayload.payload.ok, true);
    assert.equal(dryRunDeletePayload.payload.mode, "dry-run");
    assert.equal(dryRunDeletePayload.payload.manifestPath, null);

    const listAfterDryRun = await runCliTestCommand({
        argv: ["test", "case", "list", "--path", projectPath, "--json"],
        cwd: projectRoot
    });
    const listAfterDryRunPayload = JSON.parse(listAfterDryRun.stdout) as { payload: { count: number } };
    assert.equal(listAfterDryRunPayload.payload.count, 2, "dry-run delete must not mutate the persisted manifest");

    const apply = await runCliTestCommand({
        argv: [
            "test",
            "case",
            "delete",
            "scr_damage_enemy",
            "kills_enemy_at_zero_hp",
            "--path",
            projectPath,
            "--write",
            "--json"
        ],
        cwd: projectRoot
    });
    assert.equal(apply.exitCode, 0);
    const applyPayload = JSON.parse(apply.stdout) as {
        payload: { manifestPath: string; mode: string; ok: boolean };
    };
    assert.equal(applyPayload.payload.ok, true);
    assert.equal(applyPayload.payload.mode, "apply");
    assert.match(applyPayload.payload.manifestPath, /\.gmloop[\\/]test[\\/]cases\.json$/u);

    const manifestText = await readFile(applyPayload.payload.manifestPath, "utf8");
    const manifest = JSON.parse(manifestText) as {
        cases: Array<{ name: string; target: string }>;
    };
    assert.deepEqual(manifest.cases, [{ name: "caps_at_max_hp", target: "scr_heal_player" }]);
});
