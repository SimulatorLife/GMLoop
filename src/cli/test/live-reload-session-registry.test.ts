import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createStatusUrl, createWebSocketUrl } from "../src/modules/live-reload/config.js";
import {
    acquireLiveReloadSessionLock,
    createLiveReloadWorkerEnvironment
} from "../src/modules/live-reload/session-controller.js";
import {
    discoverLiveReloadSessionByPath,
    LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH,
    readLiveReloadSessionRegistry,
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
    } finally {
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
