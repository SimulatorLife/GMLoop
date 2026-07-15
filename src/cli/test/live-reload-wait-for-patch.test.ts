import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { runLiveReloadWaitForPatchCommand } from "../src/commands/live-reload.js";
import { createStatusUrl } from "../src/modules/live-reload/config.js";
import { writeLiveReloadSessionRegistry } from "../src/modules/live-reload/session-registry.js";
import { captureCliErrorOutput } from "./test-helpers/capture-cli-error-output.js";

async function createTempSessionProject(port: number): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-live-reload-wait-"));
    await writeFile(
        path.join(projectRoot, "Game.yyp"),
        JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }),
        "utf8"
    );
    await writeLiveReloadSessionRegistry({
        lastHeartbeatAt: Date.now(),
        processId: process.pid,
        projectRoot,
        yypPath: path.join(projectRoot, "Game.yyp"),
        runtimeUrl: "http://127.0.0.1:50000/",
        startSource: "cli",
        status: "running",
        statusHost: "127.0.0.1",
        statusPort: port,
        statusUrl: createStatusUrl("127.0.0.1", port),
        watchedRoot: projectRoot,
        websocketHost: "127.0.0.1",
        websocketPort: 50_002,
        websocketUrl: "ws://127.0.0.1:50002"
    });
    return projectRoot;
}

function startStatusServer(
    port: number,
    initialPatches: Array<{ patchId: string }> = [],
    onStatusRequest: ((requestCount: number) => void) | null = null
) {
    let statusRequestCount = 0;
    const state = {
        patches: [...initialPatches],
        scanComplete: true,
        uptimeMs: 100,
        watcherStatus: "running"
    };

    const server = createServer((req, res) => {
        if (req.url === "/status") {
            statusRequestCount += 1;
            const lastPatch = state.patches.at(-1);
            const responseData = {
                ...state,
                lastPatchId: lastPatch ? lastPatch.patchId : null
            };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(responseData));
            onStatusRequest?.(statusRequestCount);
            return;
        }
        res.writeHead(404);
        res.end();
    });

    return {
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
        listen: () => new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve)),
        state
    };
}

void test("live-reload wait-for-patch succeeds instantly if a new patch exists", async () => {
    const port = 60_991;
    const projectRoot = await createTempSessionProject(port);
    const server = startStatusServer(port, [{ patchId: "patch-1" }]);
    await server.listen();

    try {
        const result = await runCliTestCommand({
            argv: [
                "live-reload",
                "wait-for-patch",
                "--since-patch-id",
                "patch-0",
                "--path",
                projectRoot,
                "--timeout-ms",
                "500"
            ]
        });
        if (result.exitCode !== 0) {
            console.log("WAIT-FOR-PATCH STDOUT:", result.stdout);
            console.log("WAIT-FOR-PATCH STDERR:", result.stderr);
        }
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; payload: { patches: Array<{ patchId: string }> } };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.patches.length, 1);
        assert.equal(payload.payload.patches[0]?.patchId, "patch-1");
    } finally {
        await server.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch polls and resolves when a new patch is produced", async () => {
    const port = 60_992;
    const projectRoot = await createTempSessionProject(port);
    const server = startStatusServer(port, [{ patchId: "patch-1" }]);
    await server.listen();

    // After 150ms, append a new patch to status response
    const timer = setTimeout(() => {
        server.state.patches.push({ patchId: "patch-2" });
    }, 150);

    try {
        const result = await runCliTestCommand({
            argv: [
                "live-reload",
                "wait-for-patch",
                "--since-patch-id",
                "patch-1",
                "--path",
                projectRoot,
                "--poll-interval-ms",
                "50",
                "--timeout-ms",
                "1000"
            ]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; payload: { patches: Array<{ patchId: string }> } };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.patches.length, 2);
        assert.equal(payload.payload.patches[1]?.patchId, "patch-2");
    } finally {
        clearTimeout(timer);
        await server.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch infers since-patch-id if omitted", async () => {
    const port = 60_993;
    const projectRoot = await createTempSessionProject(port);
    const server = startStatusServer(port, [{ patchId: "patch-1" }], (requestCount) => {
        if (requestCount === 2) {
            server.state.patches.push({ patchId: "patch-2" });
        }
    });
    await server.listen();

    try {
        const result = await runCliTestCommand({
            argv: [
                "live-reload",
                "wait-for-patch",
                "--path",
                projectRoot,
                "--poll-interval-ms",
                "50",
                "--timeout-ms",
                "1000"
            ]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; payload: { patches: Array<{ patchId: string }> } };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.patches.length, 2);
        assert.equal(payload.payload.patches[1]?.patchId, "patch-2");
    } finally {
        await server.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch fails with timeout structured JSON on expiry", async () => {
    const port = 60_994;
    const projectRoot = await createTempSessionProject(port);
    const server = startStatusServer(port, [{ patchId: "patch-1" }]);
    await server.listen();

    try {
        const result = await runCliTestCommand({
            argv: [
                "live-reload",
                "wait-for-patch",
                "--since-patch-id",
                "patch-1",
                "--path",
                projectRoot,
                "--poll-interval-ms",
                "50",
                "--timeout-ms",
                "200"
            ]
        });
        assert.equal(result.exitCode, 1);
        const payload = JSON.parse(result.stdout) as { ok: boolean; code: string; error: string };
        assert.equal(payload.ok, false);
        assert.equal(payload.code, "timeout");
        assert.match(payload.error, /timed out/i);
    } finally {
        await server.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch fails with connection_failed structured JSON if offline", async () => {
    const port = 60_995; // Server not listening
    const projectRoot = await createTempSessionProject(port);
    try {
        const result = await runCliTestCommand({
            argv: [
                "live-reload",
                "wait-for-patch",
                "--since-patch-id",
                "patch-1",
                "--path",
                projectRoot,
                "--timeout-ms",
                "200"
            ]
        });
        assert.equal(result.exitCode, 1);
        const payload = JSON.parse(result.stdout) as { ok: boolean; code: string; error: string };
        assert.equal(payload.ok, false);
        assert.equal(payload.code, "connection_failed");
        assert.match(payload.error, /Failed to connect/i);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch tolerates transient fetch failures during polling", async () => {
    const port = 60_996;
    const projectRoot = await createTempSessionProject(port);

    // The discovery check (first request) must succeed so the registry survives.
    // Subsequent poll requests are flaky: first returns 500, then recovers with patch-2.
    const responses = [
        { status: 200, body: JSON.stringify({ patches: [{ patchId: "patch-1" }], lastPatchId: "patch-1" }) },
        { status: 500, body: "boom" },
        { status: 200, body: JSON.stringify({ patches: [{ patchId: "patch-2" }], lastPatchId: "patch-2" }) }
    ];
    const state = { index: 0 };

    const server = createServer((req, res) => {
        if (req.url === "/status") {
            const next = responses[state.index] ?? responses.at(-1);
            state.index += 1;
            res.writeHead(next.status, { "Content-Type": "application/json" });
            res.end(next.body);
            return;
        }
        res.writeHead(404);
        res.end();
    });

    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));

    try {
        const result = await runCliTestCommand({
            argv: [
                "live-reload",
                "wait-for-patch",
                "--since-patch-id",
                "patch-1",
                "--path",
                projectRoot,
                "--poll-interval-ms",
                "50",
                "--timeout-ms",
                "1500"
            ]
        });
        if (result.exitCode !== 0) {
            console.log("WAIT-FOR-PATCH STDOUT:", result.stdout);
            console.log("WAIT-FOR-PATCH STDERR:", result.stderr);
        }
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; payload: { lastPatchId: string } };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.lastPatchId, "patch-2");
    } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch honours a pre-aborted AbortSignal", async () => {
    const port = 60_997;
    const projectRoot = await createTempSessionProject(port);
    const server = startStatusServer(port, [{ patchId: "patch-1" }]);
    await server.listen();
    const abortController = new AbortController();
    abortController.abort();

    try {
        const { exitCodes } = await captureCliErrorOutput(() => {
            return assert.rejects(
                runLiveReloadWaitForPatchCommand({
                    abortSignal: abortController.signal,
                    path: projectRoot,
                    pollIntervalMs: 50,
                    sincePatchId: "patch-1",
                    timeoutMs: 5000
                }),
                /process\.exit called with code 1/u
            );
        });
        assert.deepEqual(exitCodes, [1]);
    } finally {
        await server.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload wait-for-patch exits early when aborted mid-poll", async () => {
    const port = 60_998;
    const projectRoot = await createTempSessionProject(port);
    const server = startStatusServer(port, [{ patchId: "patch-1" }]);
    await server.listen();
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), 75);

    try {
        const start = Date.now();
        const { exitCodes } = await captureCliErrorOutput(() => {
            return assert.rejects(
                runLiveReloadWaitForPatchCommand({
                    abortSignal: abortController.signal,
                    path: projectRoot,
                    pollIntervalMs: 50,
                    sincePatchId: "patch-1",
                    timeoutMs: 5000
                }),
                /process\.exit called with code 1/u
            );
        });
        const elapsed = Date.now() - start;
        assert.deepEqual(exitCodes, [1]);
        // Should bail well before the 5s timeout once abort fires.
        assert.ok(elapsed < 1500, `expected early abort exit, but took ${String(elapsed)}ms`);
    } finally {
        clearTimeout(timer);
        await server.close();
        await rm(projectRoot, { recursive: true, force: true });
    }
});
