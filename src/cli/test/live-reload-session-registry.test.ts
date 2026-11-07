import assert from "node:assert/strict";
import fs, { mkdir, mkdtemp, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runWatchCommand } from "../src/commands/watch.js";
import { createStatusUrl, createWebSocketUrl } from "../src/modules/live-reload/config.js";
import {
    acquireLiveReloadSessionLock,
    createLiveReloadWorkerEnvironment
} from "../src/modules/live-reload/session-controller.js";
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
import { SKIP_CLI_RUN_ENV_VAR } from "../src/shared/skip-cli-run.js";

async function createTemporaryGameMakerProject(): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-live-reload-registry-"));
    await writeFile(
        path.join(projectRoot, "Game.yyp"),
        `${JSON.stringify({ name: "Game", resourceType: "GMProject", resources: [] }, null, 2)}\n`,
        "utf8"
    );
    return projectRoot;
}

function createRegisteredSession(projectRoot: string): LiveReloadRegisteredSession {
    return {
        lastHeartbeatAt: 123,
        processId: 456,
        projectRoot,
        runtimeUrl: null,
        sessionId: "original-session",
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
    };
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
            sessionId: "round-trip-session",
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
        assert.equal(session?.sessionId, "round-trip-session");
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
    const baseSession = createRegisteredSession(projectRoot);

    try {
        await writeLiveReloadSessionRegistry(baseSession);
        const replacement = {
            ...baseSession,
            lastHeartbeatAt: 789,
            sessionId: "replacement-session"
        };
        await writeLiveReloadSessionRegistry(replacement);

        await removeLiveReloadSessionRegistry(projectRoot, baseSession);
        const retainedSession = await readLiveReloadSessionRegistry(
            path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH)
        );
        assert.deepEqual(retainedSession, replacement);
        await writeLiveReloadSessionRegistry({ ...replacement, lastHeartbeatAt: 999 });
        await removeLiveReloadSessionRegistry(projectRoot, replacement);
        assert.equal(
            await readLiveReloadSessionRegistry(path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH)),
            null
        );
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload registry publishes a complete replacement by rename", async (context) => {
    const projectRoot = await createTemporaryGameMakerProject();
    const registryPath = path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH);
    const original = createRegisteredSession(projectRoot);
    const replacement = { ...original, sessionId: "replacement-session" };

    try {
        await writeLiveReloadSessionRegistry(original);
        const rename = fs.rename;
        const renameMock = context.mock.method(fs, "rename", async (source: string, destination: string) => {
            assert.equal(destination, registryPath);
            assert.equal(path.dirname(source), path.dirname(registryPath));
            assert.notEqual(source, registryPath);
            assert.deepEqual(await readLiveReloadSessionRegistry(registryPath), original);
            assert.deepEqual(await readLiveReloadSessionRegistry(source), replacement);
            await rename(source, destination);
        });

        await writeLiveReloadSessionRegistry(replacement);
        assert.equal(renameMock.mock.callCount(), 1);
        assert.deepEqual(await readLiveReloadSessionRegistry(registryPath), replacement);
        assert.deepEqual(await readdir(path.dirname(registryPath)), ["live-reload-session.json"]);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload registry preserves the old entry and removes temporary files when rename fails", async (context) => {
    const projectRoot = await createTemporaryGameMakerProject();
    const registryPath = path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH);
    const original = createRegisteredSession(projectRoot);

    try {
        await writeLiveReloadSessionRegistry(original);
        context.mock.method(fs, "rename", async () => {
            throw new Error("rename failed");
        });

        await assert.rejects(
            writeLiveReloadSessionRegistry({ ...original, sessionId: "replacement-session" }),
            /rename failed/
        );
        assert.deepEqual(await readLiveReloadSessionRegistry(registryPath), original);
        assert.deepEqual(await readdir(path.dirname(registryPath)), ["live-reload-session.json"]);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload discovery preserves sessions replaced during the status check", async (context) => {
    for (const scenario of [
        {
            name: "new session ID on the same PID and endpoint",
            original: {},
            replacement: { sessionId: "new-session" }
        },
        { name: "session ID added", original: { sessionId: undefined }, replacement: { sessionId: "new-session" } },
        { name: "session ID omitted", original: {}, replacement: { sessionId: undefined } },
        {
            name: "no session IDs and a new PID",
            original: { sessionId: undefined },
            replacement: { sessionId: undefined, processId: 999 }
        },
        {
            name: "no session IDs and a new endpoint",
            original: { sessionId: undefined },
            replacement: { sessionId: undefined, statusPort: 50_003, statusUrl: createStatusUrl("127.0.0.1", 50_003) }
        }
    ]) {
        await context.test(scenario.name, async () => {
            const projectRoot = await createTemporaryGameMakerProject();
            const original = { ...createRegisteredSession(projectRoot), ...scenario.original };
            const replacement = { ...original, ...scenario.replacement };

            try {
                await writeLiveReloadSessionRegistry(original);
                const discovery = await discoverLiveReloadSessionByPath(projectRoot, {
                    fetchStatus: async () => {
                        await writeLiveReloadSessionRegistry(replacement);
                        return null;
                    }
                });

                assert.equal(discovery.alive, false);
                assert.equal(discovery.session, null);
                assert.equal(discovery.status, null);
                const retainedSession = await readLiveReloadSessionRegistry(discovery.registryPath);
                assert.equal(retainedSession?.sessionId, replacement.sessionId);
                assert.equal(retainedSession?.processId, replacement.processId);
                assert.equal(retainedSession?.statusUrl, replacement.statusUrl);
            } finally {
                await rm(projectRoot, { recursive: true, force: true });
            }
        });
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
            sessionId: "watcher-session",
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
            liveReloadSession: { processId: process.pid, projectRoot, sessionId: "alive-session" },
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
            sessionId: "alive-session",
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
        assert.equal(discovery.session?.sessionId, "alive-session");
        assert.deepEqual(discovery.status?.liveReloadSession, {
            processId: process.pid,
            projectRoot,
            sessionId: "alive-session"
        });
        assert.equal(discovery.session?.statusPort, statusServer.port);
        assert.equal(discovery.session?.runtimeUrl, "http://127.0.0.1:50000/");
    } finally {
        await statusServer.stop();
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload startup recovers a stale session lock", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const lockPath = path.join(projectRoot, ".gmloop", "live-reload-session.lock");

    try {
        await mkdir(path.dirname(lockPath), { recursive: true });
        await writeFile(lockPath, "999999\n", "utf8");

        const lock = await acquireLiveReloadSessionLock(lockPath);
        assert.ok(lock);
        await lock.close();
        await rm(lockPath, { force: true });
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload startup does not steal an active session lock", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const lockPath = path.join(projectRoot, ".gmloop", "live-reload-session.lock");

    try {
        await mkdir(path.dirname(lockPath), { recursive: true });
        await writeFile(lockPath, `${String(process.pid)}\n`, "utf8");

        const lock = await acquireLiveReloadSessionLock(lockPath);
        assert.equal(lock, null);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("live-reload startup recovers legacy empty locks after initialization grace", async () => {
    const projectRoot = await createTemporaryGameMakerProject();
    const lockPath = path.join(projectRoot, ".gmloop", "live-reload-session.lock");

    try {
        await mkdir(path.dirname(lockPath), { recursive: true });
        await writeFile(lockPath, "", "utf8");
        const oldTime = new Date(Date.now() - 2000);
        await utimes(lockPath, oldTime, oldTime);

        const lock = await acquireLiveReloadSessionLock(lockPath);
        assert.ok(lock);
        await lock.close();
        await rm(lockPath, { force: true });
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("MCP-started workers do not inherit the parent CLI skip-run sentinel", () => {
    const workerEnvironment = createLiveReloadWorkerEnvironment({
        [SKIP_CLI_RUN_ENV_VAR]: "1",
        GMLOOP_LIVE_RELOAD_START_SOURCE: "mcp",
        PATH: "/usr/bin"
    });

    assert.equal(workerEnvironment[SKIP_CLI_RUN_ENV_VAR], undefined);
    assert.equal(workerEnvironment.GMLOOP_LIVE_RELOAD_START_SOURCE, "mcp");
    assert.equal(workerEnvironment.PATH, "/usr/bin");
});
