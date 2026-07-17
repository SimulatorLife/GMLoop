import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import {
    discoverLiveReloadSessionByPath,
    type LiveReloadRegisteredSession,
    resolveLiveReloadProjectIdentity
} from "./session-registry.js";

const STARTUP_TIMEOUT_MS = 600_000;
const STOP_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 100;
const SESSION_LOCK_INITIALIZATION_GRACE_MS = 1000;

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
    targetPath: string;
}>;

async function isProcessAlive(processId: number): Promise<boolean> {
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
            return await isProcessAlive(ownerProcessId);
        }
    }

    const lockStats = await fs.stat(lockPath).catch(() => null);
    return lockStats !== null && Date.now() - lockStats.mtimeMs < SESSION_LOCK_INITIALIZATION_GRACE_MS;
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

    for (let attempt = 0; attempt < 2; attempt += 1) {
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
        }
    }

    return null;
}

/** Ensure, replace, or stop the single live-reload worker registered for a project. */
export async function manageLiveReloadSession(
    options: EnsureLiveReloadSessionOptions
): Promise<LiveReloadSessionResult> {
    if (options.forceStart && options.stop) {
        throw new Error("--force-start and --stop cannot be used together.");
    }

    const discovery = await discoverLiveReloadSessionByPath(options.targetPath);
    if (options.stop) {
        if (!discovery.alive || discovery.session === null) {
            return Object.freeze({ mode: "not-running", session: null, status: null });
        }
        await stopRegisteredLiveReloadSession(options.targetPath, discovery.session);
        return Object.freeze({ mode: "stopped", session: null, status: null });
    }
    if (discovery.alive && discovery.session !== null && !options.forceStart) {
        return Object.freeze({ mode: "attached", session: discovery.session, status: discovery.status });
    }

    const restarted = discovery.alive && discovery.session !== null;
    if (restarted && discovery.session !== null) {
        await stopRegisteredLiveReloadSession(options.targetPath, discovery.session);
    }
    return await startManagedLiveReloadSession(options, restarted ? "restarted" : "started");
}

async function startManagedLiveReloadSession(
    options: EnsureLiveReloadSessionOptions,
    mode: "restarted" | "started"
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
        const cliEntrypoint = fileURLToPath(new URL("../../../index.js", import.meta.url));
        const child = spawn(
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
                stdio: ["ignore", log.fd, log.fd]
            }
        );
        child.unref();
        await log.close();
        return await waitForSession(options.targetPath, sessionId, mode);
    } finally {
        await lock.close();
        await fs.rm(lockPath, { force: true });
    }
}

async function waitForConcurrentLiveReloadSession(targetPath: string): Promise<LiveReloadSessionResult> {
    const result = await pollForSession(targetPath, Date.now() + STARTUP_TIMEOUT_MS, () => true);
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
    return delay(POLL_INTERVAL_MS).then(() => pollForSession(targetPath, deadline, predicate));
}

async function waitForSession(
    targetPath: string,
    sessionId: string,
    mode: "restarted" | "started"
): Promise<LiveReloadSessionResult> {
    const result = await pollForSession(
        targetPath,
        Date.now() + STARTUP_TIMEOUT_MS,
        (session) => session.sessionId === sessionId
    );
    if (result !== null) {
        return Object.freeze({ mode, session: result.session, status: result.status });
    }
    throw new Error("Timed out waiting for the live-reload worker to become ready.");
}

async function stopRegisteredLiveReloadSession(
    targetPath: string,
    session: LiveReloadRegisteredSession
): Promise<void> {
    if (session.processId === null || session.sessionId === undefined) {
        throw new Error(
            "The registered live-reload session cannot be safely stopped because it has no worker identity."
        );
    }
    process.kill(session.processId, "SIGTERM");
    const stopped = await waitForSessionToStop(targetPath, session.sessionId, Date.now() + STOP_TIMEOUT_MS);
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
    return delay(POLL_INTERVAL_MS).then(() => waitForSessionToStop(targetPath, sessionId, deadline));
}

function delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}
