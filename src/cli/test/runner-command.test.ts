import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function withTempProject(testName: string, run: (projectRoot: string) => Promise<void>): Promise<void> {
    const projectRoot = await mkdtemp(path.join(tmpdir(), `gmloop-${testName}-`));
    await writeFile(path.join(projectRoot, "gmloop.json"), "{}\n", "utf8");
    try {
        await run(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
}

void test("runner command catalog includes lifecycle, logs, and room leaves", async () => {
    const { getCliCommandCatalog } = await import("../src/cli.js");
    const catalog = getCliCommandCatalog();
    const leaves = new Set(catalog.map((entry) => entry.displayName));
    assert.ok(leaves.has("runner start"));
    assert.ok(leaves.has("runner stop"));
    assert.ok(leaves.has("runner restart"));
    assert.ok(leaves.has("runner pause"));
    assert.ok(leaves.has("runner resume"));
    assert.ok(leaves.has("runner status"));
    assert.ok(leaves.has("runner logs"));
    assert.ok(leaves.has("runner clear-logs"));
    assert.ok(leaves.has("runner room set"));
    assert.ok(leaves.has("runner room current"));
});

void test("runner logs exposes expected filtering options", async () => {
    const help = await runCliTestCommand({
        argv: ["runner", "logs", "--help"]
    });
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /--follow/);
    assert.match(help.stdout, /--kind <kind>/);
    assert.match(help.stdout, /--errors-only/);
    assert.match(help.stdout, /--filter <text>/);
});

void test("runner start fails when no command source is configured", async () => {
    await withTempProject("runner-no-command", async (projectRoot) => {
        const start = await runCliTestCommand({
            argv: ["runner", "start", "--project", projectRoot, "--json"],
            env: {
                ...process.env,
                GMLOOP_RUNNER_COMMAND: undefined,
                GMLOOP_RUNNER_ARGS: undefined
            }
        });

        assert.equal(start.exitCode, 1);
        assert.match(start.stderr, /Runner command is not configured/u);
    });
});

void test("runner start/stop uses explicit runtime command backend", async () => {
    await withTempProject("runner-start-stop", async (projectRoot) => {
        const start = await runCliTestCommand({
            argv: ["runner", "start", "--project", projectRoot, "--json"],
            env: {
                ...process.env,
                GMLOOP_RUNNER_COMMAND: "node",
                GMLOOP_RUNNER_ARGS: '["-e","setInterval(() => {}, 1000)"]'
            }
        });
        assert.equal(start.exitCode, 0);
        const startPayload = JSON.parse(start.stdout) as { command: string; payload: { pid: number | null } };
        assert.equal(startPayload.command, "runner start");

        const status = await runCliTestCommand({
            argv: ["runner", "status", "--project", projectRoot, "--json"]
        });
        assert.equal(status.exitCode, 0);
        const statusPayload = JSON.parse(status.stdout) as {
            payload: { process: { running: boolean }; state: string };
        };
        assert.equal(statusPayload.payload.process.running, true);
        assert.equal(statusPayload.payload.state, "running");

        const stop = await runCliTestCommand({
            argv: ["runner", "stop", "--project", projectRoot, "--json"]
        });
        assert.equal(stop.exitCode, 0);
        const stopPayload = JSON.parse(stop.stdout) as { command: string; payload: { stopped: boolean } };
        assert.equal(stopPayload.command, "runner stop");
        assert.equal(stopPayload.payload.stopped, true);
    });
});

void test("runner status returns runner snapshot payload", async () => {
    await withTempProject("runner-status", async (projectRoot) => {
        const result = await runCliTestCommand({
            argv: ["runner", "status", "--project", projectRoot, "--json"]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as {
            command: string;
            payload: { logCount: number; room: string | null; state: string };
        };
        assert.equal(payload.command, "runner status");
        assert.equal(typeof payload.payload.logCount, "number");
    });
});

void test("runner logs and clear-logs return structured payloads", async () => {
    await withTempProject("runner-logs", async (projectRoot) => {
        const logs = await runCliTestCommand({
            argv: ["runner", "logs", "--project", projectRoot, "--json"]
        });
        assert.equal(logs.exitCode, 0);
        const logsPayload = JSON.parse(logs.stdout) as { command: string; payload: Array<unknown> };
        assert.equal(logsPayload.command, "runner logs");
        assert.ok(Array.isArray(logsPayload.payload));

        const clearLogs = await runCliTestCommand({
            argv: ["runner", "clear-logs", "--project", projectRoot, "--json"]
        });
        assert.equal(clearLogs.exitCode, 0);
        const clearPayload = JSON.parse(clearLogs.stdout) as { command: string; payload: { ok: boolean } };
        assert.equal(clearPayload.command, "runner clear-logs");
        assert.equal(clearPayload.payload.ok, true);
    });
});

void test("runner pause/resume and room set/current update persisted runner state", async () => {
    await withTempProject("runner-room", async (projectRoot) => {
        const pause = await runCliTestCommand({
            argv: ["runner", "pause", "--project", projectRoot, "--json"]
        });
        assert.equal(pause.exitCode, 0);

        const setRoom = await runCliTestCommand({
            argv: ["runner", "room", "set", "rm_debug", "--project", projectRoot, "--json"]
        });
        assert.equal(setRoom.exitCode, 0);

        const roomCurrent = await runCliTestCommand({
            argv: ["runner", "room", "current", "--project", projectRoot, "--json"]
        });
        assert.equal(roomCurrent.exitCode, 0);
        const roomCurrentPayload = JSON.parse(roomCurrent.stdout) as {
            command: string;
            payload: { room: string | null };
        };
        assert.equal(roomCurrentPayload.command, "runner room current");
        assert.equal(roomCurrentPayload.payload.room, "rm_debug");

        const resume = await runCliTestCommand({
            argv: ["runner", "resume", "--project", projectRoot, "--json"]
        });
        assert.equal(resume.exitCode, 0);

        const status = await runCliTestCommand({
            argv: ["runner", "status", "--project", projectRoot, "--json"]
        });
        assert.equal(status.exitCode, 0);
        const statusPayload = JSON.parse(status.stdout) as { payload: { room: string | null; state: string } };
        assert.equal(statusPayload.payload.room, "rm_debug");
        assert.equal(statusPayload.payload.state, "running");
    });
});
