import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS } from "../src/modules/live-reload/config.js";
import { manageLiveReloadSession } from "../src/modules/live-reload/session-controller.js";
import { writeLiveReloadSessionRegistry } from "../src/modules/live-reload/session-registry.js";
import { startStatusServer } from "../src/modules/status/index.js";

async function createTemporaryGameMakerProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-live-reload-stop-timeout-"));
    await writeFile(
        path.join(projectRoot, "Game.yyp"),
        `${JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }, null, 2)}\n`,
        "utf8"
    );
    return projectRoot;
}

void test("live-reload session stop honors a configurable stopTimeoutMs instead of the built-in default", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const sessionId = "stop-timeout-test-session";

    // A worker that ignores SIGTERM so the stop path is forced to time out;
    // this proves the configured timeout (not the built-in default) governs
    // how long `manageLiveReloadSession` waits before giving up.
    const stubbornWorker = spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
        {
            stdio: "ignore"
        }
    );

    const statusServer = await startStatusServer({
        port: 0,
        getSnapshot: () => ({
            errorCount: 0,
            liveReloadSession: {
                processId: stubbornWorker.pid ?? -1,
                projectRoot,
                sessionId
            },
            patchCount: 0,
            recentErrors: [],
            recentPatches: [],
            uptime: 1,
            websocketClients: 0
        })
    });

    try {
        await writeLiveReloadSessionRegistry({
            lastHeartbeatAt: Date.now(),
            processId: stubbornWorker.pid ?? null,
            projectRoot,
            runtimeUrl: null,
            sessionId,
            startSource: "cli",
            status: "running",
            statusHost: statusServer.host,
            statusPort: statusServer.port,
            statusUrl: statusServer.url,
            watchedRoot: projectRoot,
            websocketHost: "127.0.0.1",
            websocketPort: 50_002,
            websocketUrl: "ws://127.0.0.1:50002",
            yypPath: path.join(projectRoot, "Game.yyp")
        });

        const configuredStopTimeoutMs = 200;
        assert.ok(
            configuredStopTimeoutMs < DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS,
            "test timeout must be shorter than the built-in default to prove it is actually honored"
        );

        const startedAt = Date.now();
        await assert.rejects(
            () =>
                manageLiveReloadSession({
                    forceStart: false,
                    startArguments: [],
                    stop: true,
                    stopTimeoutMs: configuredStopTimeoutMs,
                    targetPath: projectRoot
                }),
            /Timed out stopping live-reload session/
        );
        const elapsedMs = Date.now() - startedAt;

        assert.ok(
            elapsedMs < DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS,
            `expected stop to time out near the configured ${String(configuredStopTimeoutMs)}ms budget, took ${String(elapsedMs)}ms`
        );
    } finally {
        stubbornWorker.kill("SIGKILL");
        await statusServer.stop();
        await rm(projectRoot, { recursive: true, force: true });
    }
});
