import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

const { sortObjectKeys } = Core;

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const GMLOOP_DIRECTORY_NAME = ".gmloop";

function stableStringify(payload: unknown): string {
    return JSON.stringify(sortObjectKeys(payload), null, 2);
}

export function resolveGmloopRoot(projectRoot: string): string {
    return path.join(projectRoot, GMLOOP_DIRECTORY_NAME);
}

export function resolveArtifactDirectory(projectRoot: string, domain: string): string {
    return path.join(resolveGmloopRoot(projectRoot), domain);
}

/**
 * Ensure a `.gmloop/<domain>` directory exists and return its absolute path.
 */
export async function ensureArtifactDirectory(projectRoot: string, domain: string): Promise<string> {
    const directory = resolveArtifactDirectory(projectRoot, domain);
    await mkdir(directory, { recursive: true });
    return directory;
}

/**
 * Write JSON with stable key ordering to keep artifacts deterministic.
 */
export async function writeArtifactJson(filePath: string, payload: unknown): Promise<void> {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    await writeFile(filePath, `${stableStringify(payload)}\n`, "utf8");
}

/**
 * Read JSON from disk. Returns `null` when file is missing or invalid JSON.
 */
export async function readArtifactJson<T>(filePath: string): Promise<T | null> {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export async function fileExists(filePath: string): Promise<boolean> {
    try {
        const fileStats = await stat(filePath);
        return fileStats.isFile();
    } catch {
        return false;
    }
}

/**
 * Build a deterministic artifact id from a scope prefix and canonical payload.
 */
export function createDeterministicArtifactId(scope: string, payload: unknown): string {
    const digest = createHash("sha256").update(stableStringify(payload)).digest("hex").slice(0, 12);
    return `${scope}-${digest}`;
}

export async function listJsonBasenames(directory: string): Promise<Array<string>> {
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right));
    } catch {
        return [];
    }
}
