import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runWatchCommand } from "../src/commands/watch.js";
import { createStatusUrl, createWebSocketUrl } from "../src/modules/live-reload/config.js";
import {
    discoverLiveReloadSessionByPath,
    LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH,
    type LiveReloadRegisteredSession,
    readLiveReloadSessionRegistry,
    removeLiveReloadSessionRegistry,
    resolveLiveReloadProjectIdentity,
    writeLiveReloadSessionRegistry
} from "../src/modules/live-reload/session-registry.js";
import { startStatusServer } from "../src/modules/status/index.js";

async function createTemporaryGameMakerProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-live-reload-registry-"));
    await writeFile(
        path.join(projectRoot, "Game.yyp"),
        `${JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }, null, 2)}\n`,
        "utf8"
    );
    return projectRoot;
}

void test("live-reload project identity uses the project-local .gmloop registry path", async () => {
    const projectRoot = await createTemporaryGameMakerProject();

    try {
        const identity = await resolveLiveReloadProjectIdentity(path.join(projectRoot, "Game.yyp"));
        const canonicalProjectRoot = await realpath(projectRoot);

        assert.equal(identity.projectRoot, canonicalProjectRoot);
        assert.equal(identity.yypPath, path.join(canonicalProjectRoot, "Game.yyp"));
        assert.equal(
            identity.registryPath,
            path.join(canonicalProjectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH)
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload session registry round-trips endpoint metadata", async () => {
    const projectRoot = await createTemporaryGameMakerProject();

    try {
        await writeLiveReloadSessionRegistry({
            lastHeartbeatAt: 123,
            processId: 456,
            projectRoot,
            runtimeUrl: "http://127.0.0.1:50000/",
            startSource: "ui",
            status: "running",
            statusHost: "127.0.0.1",
            statusPort: 50_001,
            statusUrl: createStatusUrl("127.0.0.1", 50_001),
            watchedRoot: projectRoot,
            websocketHost: "127.0.0.1",
            websocketPort: 50_002,
            websocketUrl: createWebSocketUrl("127.0.0.1", 50_002),
            yypPath: path.join(projectRoot, "Game.yyp")
        });

        const session = await readLiveReloadSessionRegistry(
            path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH)
        );

        assert.equal(session?.projectRoot, projectRoot);
        assert.equal(session?.runtimeUrl, "http://127.0.0.1:50000/");
        assert.equal(session?.statusUrl, "http://127.0.0.1:50001/status");
        assert.equal(session?.websocketUrl, "ws://127.0.0.1:50002");
        assert.equal(session?.startSource, "ui");
        assert.deepEqual(await readdir(path.join(projectRoot, ".gmloop")), ["live-reload-session.json"]);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload registry cleanup does not remove a replacement session", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const baseSession = {
        lastHeartbeatAt: 123,
        processId: 456,
        projectRoot,
        runtimeUrl: null,
        startSource: "ui" as const,
        status: "running" as const,
        statusHost: "127.0.0.1",
        statusPort: 50_001,
        statusUrl: createStatusUrl("127.0.0.1", 50_001),
        watchedRoot: projectRoot,
        websocketHost: "127.0.0.1",
        websocketPort: 50_002,
        websocketUrl: createWebSocketUrl("127.0.0.1", 50_002),
        yypPath: path.join(projectRoot, "Game.yyp")
    };

    try {
        await writeLiveReloadSessionRegistry(baseSession);
        const replacement = {
            ...baseSession,
            lastHeartbeatAt: 789,
            processId: 999,
            statusPort: 50_003,
            statusUrl: createStatusUrl("127.0.0.1", 50_003)
        };
        await writeLiveReloadSessionRegistry(replacement);

        assert.equal(await removeLiveReloadSessionRegistry(projectRoot, baseSession), false);
        const retainedSession = await readLiveReloadSessionRegistry(
            path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH)
        );
        assert.equal(retainedSession?.processId, 999);
        assert.equal(await removeLiveReloadSessionRegistry(projectRoot, replacement), true);
        assert.equal(
            await readLiveReloadSessionRegistry(path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH)),
            null
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload watcher cleanup removes its own registry entry", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const abortController = new AbortController();
    const registryPath = path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH);
    const watchPromise = runWatchCommand(projectRoot, {
        abortSignal: abortController.signal,
        liveReloadSession: {
            projectRoot,
            startSource: "ui",
            yypPath: path.join(projectRoot, "Game.yyp")
        },
        quiet: true,
        runtimeServer: false,
        statusPort: 0,
        websocketPort: 0
    });

    try {
        let session: LiveReloadRegisteredSession | null = null;
        for (let attempt = 0; attempt < 100 && session === null; attempt += 1) {
            session = await readLiveReloadSessionRegistry(registryPath);
            if (session === null) await delay(20);
        }
        assert.notEqual(session, null, "watcher should register its live-reload session");

        abortController.abort();
        await watchPromise;
        assert.equal(await readLiveReloadSessionRegistry(registryPath), null);
    } finally {
        abortController.abort();
        await watchPromise.catch(() => undefined);
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload discovery evicts stale project-local sessions", async () => {
    const projectRoot = await createTemporaryGameMakerProject();

    try {
        await mkdir(path.join(projectRoot, ".gmloop"), { recursive: true });
        await writeLiveReloadSessionRegistry({
            lastHeartbeatAt: 123,
            processId: null,
            projectRoot,
            runtimeUrl: null,
            startSource: "cli",
            status: "running",
            statusHost: "127.0.0.1",
            statusPort: 9,
            statusUrl: createStatusUrl("127.0.0.1", 9),
            watchedRoot: projectRoot,
            websocketHost: "127.0.0.1",
            websocketPort: 10,
            websocketUrl: createWebSocketUrl("127.0.0.1", 10),
            yypPath: path.join(projectRoot, "Game.yyp")
        });

        const discovery = await discoverLiveReloadSessionByPath(projectRoot, {
            fetchStatus: async () => null
        });

        assert.equal(discovery.alive, false);
        assert.equal(discovery.session, null);
        assert.equal(await readLiveReloadSessionRegistry(discovery.registryPath), null);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload discovery returns alive sessions without requiring the caller to know the port", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const statusServer = await startStatusServer({
        port: 0,
        getSnapshot: () => ({
            errorCount: 0,
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
            processId: process.pid,
            projectRoot,
            runtimeUrl: "http://127.0.0.1:50000/",
            startSource: "ui",
            status: "running",
            statusHost: statusServer.host,
            statusPort: statusServer.port,
            statusUrl: statusServer.url,
            watchedRoot: projectRoot,
            websocketHost: "127.0.0.1",
            websocketPort: 50_002,
            websocketUrl: createWebSocketUrl("127.0.0.1", 50_002),
            yypPath: path.join(projectRoot, "Game.yyp")
        });

        const discovery = await discoverLiveReloadSessionByPath(projectRoot);

        assert.equal(discovery.alive, true);
        assert.equal(discovery.session?.statusPort, statusServer.port);
        assert.equal(discovery.session?.runtimeUrl, "http://127.0.0.1:50000/");
    } finally {
        await statusServer.stop();
        await rm(projectRoot, { recursive: true, force: true });
    }
});
