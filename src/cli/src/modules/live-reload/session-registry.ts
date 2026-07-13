import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { resolveCommandProjectContext } from "../../workflow/project-root.js";

export const LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH = path.join(".gmloop", "live-reload-session.json");

export type LiveReloadSessionStartSource = "cli" | "mcp" | "ui";

export type LiveReloadSessionStatus = "running";

export type LiveReloadRegisteredSession = Readonly<{
    lastHeartbeatAt: number;
    processId: number | null;
    projectRoot: string;
    runtimeUrl: string | null;
    startSource: LiveReloadSessionStartSource;
    status: LiveReloadSessionStatus;
    statusHost: string;
    statusPort: number;
    statusUrl: string;
    watchedRoot: string;
    websocketHost: string;
    websocketPort: number;
    websocketUrl: string;
    yypPath: string | null;
}>;

export type LiveReloadProjectIdentity = Readonly<{
    projectRoot: string;
    registryPath: string;
    yypPath: string | null;
}>;

export type LiveReloadSessionDiscovery = Readonly<{
    alive: boolean;
    registryPath: string;
    session: LiveReloadRegisteredSession | null;
}>;

type SessionHealthFetch = (url: string) => Promise<unknown>;

function isRegisteredSession(value: unknown): value is LiveReloadRegisteredSession {
    if (!Core.isObjectLike(value)) {
        return false;
    }
    const record = value as Record<string, unknown>;

    return (
        typeof record.lastHeartbeatAt === "number" &&
        (typeof record.processId === "number" || record.processId === null) &&
        typeof record.projectRoot === "string" &&
        (typeof record.runtimeUrl === "string" || record.runtimeUrl === null) &&
        (record.startSource === "cli" || record.startSource === "mcp" || record.startSource === "ui") &&
        record.status === "running" &&
        typeof record.statusHost === "string" &&
        typeof record.statusPort === "number" &&
        typeof record.statusUrl === "string" &&
        typeof record.watchedRoot === "string" &&
        typeof record.websocketHost === "string" &&
        typeof record.websocketPort === "number" &&
        typeof record.websocketUrl === "string" &&
        (typeof record.yypPath === "string" || record.yypPath === null)
    );
}

async function canonicalizeExistingPath(inputPath: string): Promise<string> {
    const resolvedPath = path.resolve(inputPath);
    try {
        return await fs.realpath(resolvedPath);
    } catch {
        return resolvedPath;
    }
}

async function resolveSingleYypPath(projectRoot: string): Promise<string | null> {
    const entries = await Core.safeReaddirDirent({ readDir: fs.readdir }, projectRoot);
    const candidates = entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
        .map((entry) => path.join(projectRoot, entry.name))
        .sort((left, right) => left.localeCompare(right));

    if (candidates.length !== 1) {
        return null;
    }

    return await canonicalizeExistingPath(candidates[0] ?? projectRoot);
}

/**
 * Resolve the canonical live-reload identity used by the project-local session registry.
 */
export async function resolveLiveReloadProjectIdentity(
    targetPath: string,
    projectContextResolver: typeof resolveCommandProjectContext = resolveCommandProjectContext
): Promise<LiveReloadProjectIdentity> {
    const projectContext = await projectContextResolver({ path: targetPath });
    const projectRoot = await canonicalizeExistingPath(projectContext.projectRoot);
    const explicitYypPath = targetPath.toLowerCase().endsWith(".yyp")
        ? await canonicalizeExistingPath(targetPath)
        : null;
    const yypPath = explicitYypPath ?? (await resolveSingleYypPath(projectRoot));

    return Object.freeze({
        projectRoot,
        registryPath: path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH),
        yypPath
    });
}

export async function readLiveReloadSessionRegistry(registryPath: string): Promise<LiveReloadRegisteredSession | null> {
    const rawText = await Core.readTextFile(registryPath).catch(() => null);
    const rawSession =
        rawText === null
            ? null
            : (() => {
                  try {
                      return Core.parseJsonWithContext(rawText, {
                          description: `live-reload session registry ${registryPath}`
                      });
                  } catch {
                      return null;
                  }
              })();
    return isRegisteredSession(rawSession) ? rawSession : null;
}

export async function writeLiveReloadSessionRegistry(session: LiveReloadRegisteredSession): Promise<void> {
    const registryPath = path.join(session.projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH);
    const temporaryPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(registryPath), { recursive: true });
    try {
        await fs.writeFile(temporaryPath, `${JSON.stringify(session, null, 2)}\n`, {
            encoding: "utf8",
            flag: "wx"
        });
        await fs.rename(temporaryPath, registryPath);
    } finally {
        await fs.rm(temporaryPath, { force: true });
    }
}

function isSameRegisteredSession(current: LiveReloadRegisteredSession, expected: LiveReloadRegisteredSession): boolean {
    return (
        current.processId === expected.processId &&
        current.statusUrl === expected.statusUrl &&
        current.watchedRoot === expected.watchedRoot
    );
}

export async function removeLiveReloadSessionRegistry(
    projectRoot: string,
    expected?: LiveReloadRegisteredSession
): Promise<boolean> {
    const registryPath = path.join(projectRoot, LIVE_RELOAD_SESSION_REGISTRY_RELATIVE_PATH);
    if (expected !== undefined) {
        const current = await readLiveReloadSessionRegistry(registryPath);
        if (current === null || !isSameRegisteredSession(current, expected)) {
            return false;
        }
    }
    await fs.rm(registryPath, { force: true });
    return true;
}

async function fetchJsonWithTimeout(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, 1000);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            return null;
        }

        return await response.json();
    } finally {
        clearTimeout(timeout);
    }
}

function resolveStatusEndpointUrl(statusUrl: string): string {
    return statusUrl.endsWith("/status") ? statusUrl : `${statusUrl}/status`;
}

export async function isLiveReloadRegisteredSessionAlive(
    session: LiveReloadRegisteredSession,
    fetchStatus: SessionHealthFetch = fetchJsonWithTimeout
): Promise<boolean> {
    const statusPayload = await fetchStatus(resolveStatusEndpointUrl(session.statusUrl)).catch(() => null);
    return Core.isObjectLike(statusPayload);
}

/**
 * Read a project-local live-reload session and evict it when the status server no longer responds.
 */
export async function discoverLiveReloadSessionByPath(
    targetPath: string,
    options: Readonly<{
        fetchStatus?: SessionHealthFetch;
        projectContextResolver?: typeof resolveCommandProjectContext;
    }> = {}
): Promise<LiveReloadSessionDiscovery> {
    const identity = await resolveLiveReloadProjectIdentity(targetPath, options.projectContextResolver);
    const session = await readLiveReloadSessionRegistry(identity.registryPath);
    if (session === null) {
        return Object.freeze({ alive: false, registryPath: identity.registryPath, session: null });
    }

    const alive = await isLiveReloadRegisteredSessionAlive(session, options.fetchStatus);
    if (!alive) {
        await removeLiveReloadSessionRegistry(identity.projectRoot, session);
        return Object.freeze({ alive: false, registryPath: identity.registryPath, session: null });
    }

    return Object.freeze({ alive: true, registryPath: identity.registryPath, session });
}
