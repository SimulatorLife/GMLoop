import assert from "node:assert/strict";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

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

void test("runner start/stop uses runtime controller backend", async () => {
    const start = await runCliTestCommand({
        argv: ["runner", "start", "--json"]
    });
    assert.equal(start.exitCode, 0);
    const startPayload = JSON.parse(start.stdout) as { command: string; payload: { pid: number | null } };
    assert.equal(startPayload.command, "runner start");

    const status = await runCliTestCommand({
        argv: ["runner", "status", "--json"]
    });
    assert.equal(status.exitCode, 0);
    const statusPayload = JSON.parse(status.stdout) as {
        payload: { process: { running: boolean }; state: string };
    };
    assert.equal(statusPayload.payload.process.running, true);
    assert.equal(statusPayload.payload.state, "running");

    const stop = await runCliTestCommand({
        argv: ["runner", "stop", "--json"]
    });
    assert.equal(stop.exitCode, 0);
    const stopPayload = JSON.parse(stop.stdout) as { command: string; payload: { stopped: boolean } };
    assert.equal(stopPayload.command, "runner stop");
    assert.equal(stopPayload.payload.stopped, true);
});

void test("runner status returns runner snapshot payload", async () => {
    const result = await runCliTestCommand({
        argv: ["runner", "status", "--json"]
    });
    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout) as {
        command: string;
        payload: { logCount: number; room: string | null; state: string };
    };
    assert.equal(payload.command, "runner status");
    assert.equal(typeof payload.payload.logCount, "number");
});

void test("runner logs and clear-logs return structured payloads", async () => {
    const logs = await runCliTestCommand({
        argv: ["runner", "logs", "--json"]
    });
    assert.equal(logs.exitCode, 0);
    const logsPayload = JSON.parse(logs.stdout) as { command: string; payload: Array<unknown> };
    assert.equal(logsPayload.command, "runner logs");
    assert.ok(Array.isArray(logsPayload.payload));

    const clearLogs = await runCliTestCommand({
        argv: ["runner", "clear-logs", "--json"]
    });
    assert.equal(clearLogs.exitCode, 0);
    const clearPayload = JSON.parse(clearLogs.stdout) as { command: string; payload: { ok: boolean } };
    assert.equal(clearPayload.command, "runner clear-logs");
    assert.equal(clearPayload.payload.ok, true);
});

void test("runner logs --follow streams bounded payload windows", async () => {
    const start = await runCliTestCommand({
        argv: ["runner", "start", "--json"]
    });
    assert.equal(start.exitCode, 0);

    const follow = await runCliTestCommand({
        argv: ["runner", "logs", "--follow", "--json"]
    });
    assert.equal(follow.exitCode, 0);
    assert.match(follow.stdout, /"follow": true/u);

    const stop = await runCliTestCommand({
        argv: ["runner", "stop", "--json"]
    });
    assert.equal(stop.exitCode, 0);
});

void test("runner pause/resume and room set/current update runner state", async () => {
    const pause = await runCliTestCommand({
        argv: ["runner", "pause", "--json"]
    });
    assert.equal(pause.exitCode, 0);
    const pausePayload = JSON.parse(pause.stdout) as { command: string; payload: { ok: boolean } };
    assert.equal(pausePayload.command, "runner pause");
    assert.equal(pausePayload.payload.ok, true);

    const setRoom = await runCliTestCommand({
        argv: ["runner", "room", "set", "rm_debug", "--json"]
    });
    assert.equal(setRoom.exitCode, 0);
    const setRoomPayload = JSON.parse(setRoom.stdout) as { command: string; payload: { room: string } };
    assert.equal(setRoomPayload.command, "runner room set");
    assert.equal(setRoomPayload.payload.room, "rm_debug");

    const roomCurrent = await runCliTestCommand({
        argv: ["runner", "room", "current", "--json"]
    });
    assert.equal(roomCurrent.exitCode, 0);
    const roomCurrentPayload = JSON.parse(roomCurrent.stdout) as { command: string; payload: { room: string | null } };
    assert.equal(roomCurrentPayload.command, "runner room current");
    assert.equal(roomCurrentPayload.payload.room, "rm_debug");

    const resume = await runCliTestCommand({
        argv: ["runner", "resume", "--json"]
    });
    assert.equal(resume.exitCode, 0);
    const resumePayload = JSON.parse(resume.stdout) as { command: string; payload: { ok: boolean } };
    assert.equal(resumePayload.command, "runner resume");
    assert.equal(resumePayload.payload.ok, true);
});
