import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import { SKIP_CLI_RUN_ENV_VAR } from "../../shared/skip-cli-run.js";
import {
    DEFAULT_LIVE_RELOAD_SESSION_LOCK_INITIALIZATION_GRACE_MS,
    DEFAULT_LIVE_RELOAD_SESSION_POLL_INTERVAL_MS,
    DEFAULT_LIVE_RELOAD_SESSION_STARTUP_TIMEOUT_MS,
    DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS
} from "./config.js";
import {
    discoverLiveReloadSessionByPath,
    type LiveReloadRegisteredSession,
    resolveLiveReloadProjectIdentity
} from "./session-registry.js";

/**
 * Minimal contract for spawning the detached live-reload worker.
 *
 * Exists so unit tests can substitute a mock implementation without spawning
 * real child processes. The signature mirrors the subset of
 * `child_process.spawn` actually used by `startManagedLiveReloadSession`.
 */
export type LiveReloadWorkerSpawnFn = (
    command: string,
    args: ReadonlyArray<string>,
    options: {
        detached: true;
        env: NodeJS.ProcessEnv;
        stdio: ["ignore", number, number];
    }
) => ChildProcess;

export type LiveReloadSessionMode = "attached" | "started" | "restarted" | "stopped" | "not-running";

export type LiveReloadSessionResult = Readonly<{
    mode: LiveReloadSessionMode;
    session: LiveReloadRegisteredSession | null;
    status: Record<string, unknown> | null;
}>;

export type EnsureLiveReloadSessionOptions = Readonly<{
    forceStart: boolean;
    startArguments: ReadonlyArray<string>;
    stop: boolean;
    /**
     * Maximum time (milliseconds) to wait for a registered worker to exit
     * gracefully after `SIGTERM` before reporting a stop failure. Defaults to
     * {@link DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS}.
     */
    stopTimeoutMs?: number;
    targetPath: string;
}>;

/**
 * Create the environment for a detached live-reload worker.
 *
 * In-process CLI capture sets the skip-run sentinel to prevent the parent CLI
 * entrypoint from recursively starting itself. A worker has an explicit
 * command and must not inherit that sentinel, or MCP-started sessions exit
 * before registering their status endpoint.
 *
 * @param sourceEnvironment - Environment inherited by the worker process.
 * @returns A copy of the environment with the parent-only sentinel removed.
 */
export function createLiveReloadWorkerEnvironment(sourceEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const workerEnvironment = { ...sourceEnvironment };
    delete workerEnvironment[SKIP_CLI_RUN_ENV_VAR];
    return workerEnvironment;
}

function isProcessAlive(processId: number): boolean {
    try {
        process.kill(processId, 0);
        return true;
    } catch (error) {
        if (Core.isErrorWithCode(error, "ESRCH")) {
            return false;
        }

        return true;
    }
}

async function isLiveReloadSessionLockActive(lockPath: string): Promise<boolean> {
    const lockContents = await fs.readFile(lockPath, "utf8").catch(() => null);
    if (lockContents !== null) {
        const ownerProcessId = Number(lockContents.trim());
        if (Number.isSafeInteger(ownerProcessId) && ownerProcessId > 0) {
            return isProcessAlive(ownerProcessId);
        }
    }

    const lockStats = await fs.stat(lockPath).catch(() => null);
    return (
        lockStats !== null && Date.now() - lockStats.mtimeMs < DEFAULT_LIVE_RELOAD_SESSION_LOCK_INITIALIZATION_GRACE_MS
    );
}

async function tryAcquireLiveReloadSessionLock(lockPath: string, attempt: number): Promise<fs.FileHandle | null> {
    let lock: fs.FileHandle | null = null;
    try {
        lock = await fs.open(lockPath, "wx");
        await lock.writeFile(`${String(process.pid)}\n`, "utf8");
        return lock;
    } catch (error) {
        if (lock !== null) {
            await lock.close().catch(() => undefined);
        }

        if (!Core.isErrorWithCode(error, "EEXIST") || attempt === 1) {
            throw error;
        }

        if (await isLiveReloadSessionLockActive(lockPath)) {
            return null;
        }

        await fs.rm(lockPath, { force: true });
        return await tryAcquireLiveReloadSessionLock(lockPath, attempt + 1);
    }
}

/**
 * Acquire the project-local live-reload startup lock, recovering locks left by
 * a process that was terminated before its cleanup handler ran.
 *
 * @param lockPath - Project-local lock file path.
 * @returns The open lock handle, or `null` when another live process owns it.
 */
export async function acquireLiveReloadSessionLock(lockPath: string): Promise<fs.FileHandle | null> {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    return await tryAcquireLiveReloadSessionLock(lockPath, 0);
}

/** Ensure, replace, or stop the single live-reload worker registered for a project. */
export async function manageLiveReloadSession(
    options: EnsureLiveReloadSessionOptions,
    spawnFn: LiveReloadWorkerSpawnFn = spawn
): Promise<LiveReloadSessionResult> {
    if (options.forceStart && options.stop) {
        throw new Error("--force-start and --stop cannot be used together.");
    }

    const discovery = await discoverLiveReloadSessionByPath(options.targetPath);
    if (options.stop) {
        if (!discovery.alive || discovery.session === null) {
            return Object.freeze({ mode: "not-running", session: null, status: null });
        }
        await stopRegisteredLiveReloadSession(options.targetPath, discovery.session, options.stopTimeoutMs);
        return Object.freeze({ mode: "stopped", session: null, status: null });
    }
    if (discovery.alive && discovery.session !== null && !options.forceStart) {
        return Object.freeze({ mode: "attached", session: discovery.session, status: discovery.status });
    }

    const restarted = discovery.alive && discovery.session !== null;
    if (restarted && discovery.session !== null) {
        await stopRegisteredLiveReloadSession(options.targetPath, discovery.session, options.stopTimeoutMs);
    }
    return await startManagedLiveReloadSession(options, restarted ? "restarted" : "started", spawnFn);
}

/**
 * Start a fresh detached live-reload worker, acquiring the project-local lock,
 * opening the session log, spawning the worker process, and polling for the
 * registry to appear.
 *
 * The log `FileHandle` returned by `fs.open` is closed under a dedicated
 * `try/finally` so a `spawn()` failure (or any later synchronous error before
 * the explicit `log.close()` runs) cannot strand the parent-side descriptor
 * until the next GC cycle. Without that guard, repeated failed startup
 * attempts — for example, a missing CLI entrypoint or an invalid argument —
 * accumulate open file descriptors inside the parent process. On Linux each
 * leaked descriptor is visible in `/proc/self/fd`, and reaching the per-process
 * `ulimit -n` causes subsequent file operations across the project to fail
 * with `EMFILE`.
 *
 * Exported so unit tests can exercise the spawn-failure cleanup path without
 * relying on internal module mocking.
 *
 * @param options - Startup options forwarded to the worker.
 * @param mode - Lifecycle mode reported back through the returned result.
 * @param spawnFn - Process spawn implementation; defaults to Node's built-in
 *   `child_process.spawn`. Tests can substitute a mock that throws to verify
 *   the log-handle cleanup path.
 */
export async function startManagedLiveReloadSession(
    options: EnsureLiveReloadSessionOptions,
    mode: "restarted" | "started",
    spawnFn: LiveReloadWorkerSpawnFn = spawn
): Promise<LiveReloadSessionResult> {
    const identity = await resolveLiveReloadProjectIdentity(options.targetPath);
    const lockPath = path.join(identity.projectRoot, ".gmloop", "live-reload-session.lock");
    const lock = await acquireLiveReloadSessionLock(lockPath);
    if (lock === null) {
        return await waitForConcurrentLiveReloadSession(options.targetPath);
    }

    try {
        const sessionId = randomUUID();
        const logPath = path.join(identity.projectRoot, ".gmloop", "live-reload-session.log");
        const log = await fs.open(logPath, "a");
        // The log descriptor must be handed to the child via `spawn({ stdio })`
        // *before* the parent closes its own copy of the handle, because once
        // closed the parent-side `FileHandle` no longer exposes a usable fd.
        // A dedicated `finally` guarantees the handle is released even when the
        // synchronous `spawn()` or `child.unref()` throws — the previous
        // single-`finally` design only covered the lock file and would leak
        // this descriptor on every failed startup attempt.
        let logClosed = false;
        try {
            const cliEntrypoint = fileURLToPath(new URL("../../../index.js", import.meta.url));
            const child = spawnFn(
                process.execPath,
                [
                    cliEntrypoint,
                    "live-reload",
                    "worker",
                    "--path",
                    options.targetPath,
                    "--session-id",
                    sessionId,
                    ...options.startArguments
                ],
                {
                    detached: true,
                    env: createLiveReloadWorkerEnvironment(process.env),
                    stdio: ["ignore", log.fd, log.fd]
                }
            );
            child.unref();
            await log.close();
            logClosed = true;
            return await waitForSession(options.targetPath, sessionId, mode);
        } finally {
            if (!logClosed) {
                // Swallow the secondary close error so the original failure
                // surfaced by `spawn()` (or its callers) remains the dominant
                // diagnostic. Without `.catch`, a close-time EBADF would mask
                // the real reason the worker failed to start.
                await log.close().catch(() => undefined);
            }
        }
    } finally {
        await lock.close();
        await fs.rm(lockPath, { force: true });
    }
}

async function waitForConcurrentLiveReloadSession(targetPath: string): Promise<LiveReloadSessionResult> {
    const result = await pollForSession(
        targetPath,
        Date.now() + DEFAULT_LIVE_RELOAD_SESSION_STARTUP_TIMEOUT_MS,
        () => true
    );
    if (result !== null) {
        return Object.freeze({ mode: "attached", session: result.session, status: result.status });
    }
    throw new Error("Timed out waiting for another live-reload session startup.");
}

async function pollForSession(
    targetPath: string,
    deadline: number,
    predicate: (session: LiveReloadRegisteredSession) => boolean
): Promise<Readonly<{ session: LiveReloadRegisteredSession; status: Record<string, unknown> }> | null> {
    const discovery = await discoverLiveReloadSessionByPath(targetPath);
    if (discovery.alive && discovery.session !== null && predicate(discovery.session)) {
        return { session: discovery.session, status: discovery.status ?? {} };
    }
    if (Date.now() >= deadline) {
        return null;
    }
    return delay(DEFAULT_LIVE_RELOAD_SESSION_POLL_INTERVAL_MS).then(() =>
        pollForSession(targetPath, deadline, predicate)
    );
}

async function waitForSession(
    targetPath: string,
    sessionId: string,
    mode: "restarted" | "started"
): Promise<LiveReloadSessionResult> {
    const result = await pollForSession(
        targetPath,
        Date.now() + DEFAULT_LIVE_RELOAD_SESSION_STARTUP_TIMEOUT_MS,
        (session) => session.sessionId === sessionId
    );
    if (result !== null) {
        return Object.freeze({ mode, session: result.session, status: result.status });
    }
    throw new Error("Timed out waiting for the live-reload worker to become ready.");
}

async function stopRegisteredLiveReloadSession(
    targetPath: string,
    session: LiveReloadRegisteredSession,
    stopTimeoutMs = DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS
): Promise<void> {
    if (session.processId === null || session.sessionId === undefined) {
        throw new Error(
            "The registered live-reload session cannot be safely stopped because it has no worker identity."
        );
    }
    process.kill(session.processId, "SIGTERM");
    const stopped = await waitForSessionToStop(targetPath, session.sessionId, Date.now() + stopTimeoutMs);
    if (stopped) {
        return;
    }
    throw new Error(`Timed out stopping live-reload session ${session.sessionId}.`);
}

async function waitForSessionToStop(targetPath: string, sessionId: string, deadline: number): Promise<boolean> {
    const discovery = await discoverLiveReloadSessionByPath(targetPath);
    if (!discovery.alive || discovery.session?.sessionId !== sessionId) {
        return true;
    }
    if (Date.now() >= deadline) {
        return false;
    }
    return delay(DEFAULT_LIVE_RELOAD_SESSION_POLL_INTERVAL_MS).then(() =>
        waitForSessionToStop(targetPath, sessionId, deadline)
    );
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
