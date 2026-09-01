import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

const { sortObjectKeys, stringifyJsonForFile } = Core;

type JsonPrimitive = boolean | null | number | string;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

const GMLOOP_DIRECTORY_NAME = ".gmloop";

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
 *
 * Serialization delegates to {@link Core.stringifyJsonForFile} so trailing
 * newline semantics, error handling for unserializable payloads, and
 * indentation match the rest of the CLI's artifact-writing helpers
 * (see `shared/fs-artifacts.ts`). The payload is pre-sorted via
 * {@link Core.sortObjectKeys} so the on-disk format is deterministic across
 * runs and platforms.
 */
export async function writeArtifactJson(filePath: string, payload: unknown): Promise<void> {
    const directory = path.dirname(filePath);
    await mkdir(directory, { recursive: true });
    const contents = stringifyJsonForFile(sortObjectKeys(payload), { space: 2 });
    await writeFile(filePath, contents, "utf8");
}

/**
 * Read JSON from disk. Returns `null` when file is missing or invalid JSON.
 *
 * The caller is responsible for narrowing the parsed value before treating it
 * as a specific shape — use {@link readValidatedArtifactJson} when a schema
 * predicate is available so malformed payloads are rejected early instead of
 * silently propagating through the call site.
 */
export async function readArtifactJson<T>(filePath: string): Promise<T | null> {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export type ReadValidatedArtifactJsonOptions<T> = Readonly<{
    /**
     * Type guard that confirms the parsed JSON value matches the expected
     * artifact shape. Returning `false` causes the helper to resolve to
     * `null`, mirroring the missing-file case so callers do not have to
     * distinguish "absent" from "malformed" at every read site.
     */
    validate: (value: unknown) => value is T;
}>;

/**
 * Read JSON from disk and validate the parsed payload against a schema
 * predicate.
 *
 * Returns `null` when the file is missing, the JSON cannot be parsed, or the
 * parsed value does not satisfy the supplied validator. This guards against
 * hand-edited, truncated, or version-mismatched artifact files whose contents
 * parse as JSON but do not match the runtime contract — without this layer
 * the call site would receive a value typed as `T` that is actually a
 * structurally invalid object, which can crash downstream consumers that
 * dereference nested properties.
 *
 * The helper deliberately keeps the success path to `T` (not `T | undefined`)
 * so callers can compose it with the same `?? defaultValue` patterns they use
 * with {@link readArtifactJson}.
 */
export async function readValidatedArtifactJson<T>(
    filePath: string,
    { validate }: ReadValidatedArtifactJsonOptions<T>
): Promise<T | null> {
    let raw: string;
    try {
        raw = await readFile(filePath, "utf8");
    } catch {
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    if (!validate(parsed)) {
        return null;
    }

    return parsed;
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
 *
 * The digest input is the payload serialized with sorted keys — the same
 * canonical form used by {@link writeArtifactJson} — so ids derived from
 * {@link createDeterministicArtifactId} stay stable across processes and
 * platforms. The serialization intentionally omits a trailing newline so
 * existing artifact filenames produced before this helper migrated to the
 * shared utilities remain byte-for-byte comparable.
 */
export function createDeterministicArtifactId(scope: string, payload: unknown): string {
    const serialized = JSON.stringify(sortObjectKeys(payload), null, 2);
    const digest = createHash("sha256").update(serialized).digest("hex").slice(0, 12);
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
