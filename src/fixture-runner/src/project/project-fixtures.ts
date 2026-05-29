import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import net, { type Server } from "node:net";
import os from "node:os";
import path from "node:path";

import { Core, type ProjectExcludeRules } from "@gmloop/core";

const DEFAULT_COPY_DIRECTORY_NAME = "project";
const DEFAULT_JSON_ENDPOINT_TIMEOUT_MS = 5000;
const DEFAULT_JSON_ENDPOINT_POLL_INTERVAL_MS = 25;

/**
 * Copied project fixture handle returned by {@link copyExternalProjectFixture}.
 */
export interface CopiedExternalProjectFixture {
    sourceProjectPath: string;
    workingProjectDirectoryPath: string;
    temporaryRootPath: string;
    copiedRelativeFilePaths: ReadonlyArray<string>;
    dispose(): Promise<void>;
}

/**
 * Options for copying a real external project into an isolated writable
 * fixture workspace.
 */
export interface ExternalProjectCopyOptions {
    sourceProjectPath: string;
    temporaryRootPath?: string;
    copyDirectoryName?: string;
    excludes?: ProjectExcludeRules;
}

/**
 * Stable content fingerprint for one file in a project tree.
 */
export interface ProjectFileFingerprint {
    relativePath: string;
    sha256: string;
    sizeBytes: number;
}

/**
 * Stable content fingerprint for a whole project tree.
 */
export interface ProjectFingerprint {
    rootPath: string;
    digest: string;
    fileCount: number;
    files: ReadonlyArray<ProjectFileFingerprint>;
}

/**
 * Stable changed-file summary between two project fingerprints.
 */
export interface ProjectChangeSummary {
    added: ReadonlyArray<string>;
    modified: ReadonlyArray<string>;
    removed: ReadonlyArray<string>;
}

/**
 * Parsed JSON payload emitted by a CLI command.
 */
export type JsonCliPayload = Record<string, unknown> | ReadonlyArray<unknown>;

export type JsonEndpointPayload = Record<string, unknown>;

function createDelay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds);
    });
}

async function collectIncludedFilePaths(rootPath: string, excludes: ProjectExcludeRules): Promise<Array<string>> {
    return await Core.listRelativeFilePathsRecursively(rootPath, {
        includeFile: ({ relativePath }) => !Core.isProjectPathExcluded(relativePath, excludes),
        shouldEnterDirectory: ({ relativePath }) => !Core.isProjectPathExcluded(relativePath, excludes)
    });
}

async function assertSourceProjectDirectory(sourceProjectPath: string): Promise<void> {
    const sourceStats = await stat(sourceProjectPath).catch(() => null);
    if (!sourceStats?.isDirectory()) {
        throw new Error(
            `External project fixture source does not exist or is not a directory: ${sourceProjectPath}. Initialize required submodules before running this test.`
        );
    }
}

async function createWritableCopiedProject(
    sourceProjectPath: string,
    destinationProjectPath: string,
    relativeFilePaths: ReadonlyArray<string>
): Promise<void> {
    await mkdir(destinationProjectPath, { recursive: true });

    await Promise.all(
        relativeFilePaths.map(async (relativePath) => {
            const sourceFilePath = path.join(sourceProjectPath, relativePath);
            const destinationFilePath = path.join(destinationProjectPath, relativePath);

            await mkdir(path.dirname(destinationFilePath), { recursive: true });
            await copyFile(sourceFilePath, destinationFilePath);
            await chmod(destinationFilePath, 0o644);
        })
    );
}

/**
 * Copy a real external project into an isolated writable temporary directory.
 *
 * @param options External project copy options.
 * @returns Handle for the copied project and cleanup.
 */
export async function copyExternalProjectFixture(
    options: ExternalProjectCopyOptions
): Promise<CopiedExternalProjectFixture> {
    const sourceProjectPath = path.resolve(options.sourceProjectPath);
    await assertSourceProjectDirectory(sourceProjectPath);

    const excludes = Core.mergeExcludeRules(Core.DEFAULT_PROJECT_EXCLUDES, options.excludes);
    const copiedRelativeFilePaths = await collectIncludedFilePaths(sourceProjectPath, excludes);
    const temporaryRootPath =
        options.temporaryRootPath ?? (await mkdtemp(path.join(os.tmpdir(), "gmloop-external-project-")));
    const workingProjectDirectoryPath = path.join(
        temporaryRootPath,
        options.copyDirectoryName ?? DEFAULT_COPY_DIRECTORY_NAME
    );

    await createWritableCopiedProject(sourceProjectPath, workingProjectDirectoryPath, copiedRelativeFilePaths);

    return Object.freeze({
        sourceProjectPath,
        workingProjectDirectoryPath,
        temporaryRootPath,
        copiedRelativeFilePaths: Object.freeze([...copiedRelativeFilePaths]),
        async dispose() {
            await rm(temporaryRootPath, { recursive: true, force: true });
        }
    });
}

function createFileContentDigest(content: Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

function createProjectDigest(files: ReadonlyArray<ProjectFileFingerprint>): string {
    const hash = createHash("sha256");

    for (const file of files) {
        hash.update(file.relativePath);
        hash.update("\0");
        hash.update(file.sha256);
        hash.update("\0");
        hash.update(String(file.sizeBytes));
        hash.update("\n");
    }

    return hash.digest("hex");
}

/**
 * Create a stable content fingerprint for a whole project tree.
 *
 * @param projectRootPath Project root to fingerprint.
 * @param excludes Optional path exclusions.
 * @returns Whole-project fingerprint.
 */
export async function createProjectFingerprint(
    projectRootPath: string,
    excludes: ProjectExcludeRules = {}
): Promise<ProjectFingerprint> {
    const rootPath = path.resolve(projectRootPath);
    const mergedExcludes = Core.mergeExcludeRules(Core.DEFAULT_PROJECT_EXCLUDES, excludes);
    const relativeFilePaths = await collectIncludedFilePaths(rootPath, mergedExcludes);
    const files = await Promise.all(
        relativeFilePaths.map(async (relativePath) => {
            const content = await readFile(path.join(rootPath, relativePath));
            return Object.freeze({
                relativePath,
                sha256: createFileContentDigest(content),
                sizeBytes: content.byteLength
            });
        })
    );

    return Object.freeze({
        rootPath,
        digest: createProjectDigest(files),
        fileCount: files.length,
        files: Object.freeze(files)
    });
}

function mapFingerprintFiles(fingerprint: ProjectFingerprint): Map<string, ProjectFileFingerprint> {
    return new Map(fingerprint.files.map((file) => [file.relativePath, file]));
}

/**
 * Collect a deterministic changed-file summary between two project
 * fingerprints.
 *
 * @param before Baseline project fingerprint.
 * @param after Current project fingerprint.
 * @returns Added, modified, and removed relative paths.
 */
export function collectProjectChangeSummary(
    before: ProjectFingerprint,
    after: ProjectFingerprint
): ProjectChangeSummary {
    const beforeFiles = mapFingerprintFiles(before);
    const afterFiles = mapFingerprintFiles(after);
    const added: Array<string> = [];
    const modified: Array<string> = [];
    const removed: Array<string> = [];

    for (const [relativePath, afterFile] of afterFiles.entries()) {
        const beforeFile = beforeFiles.get(relativePath);
        if (!beforeFile) {
            added.push(relativePath);
            continue;
        }
        if (beforeFile.sha256 !== afterFile.sha256 || beforeFile.sizeBytes !== afterFile.sizeBytes) {
            modified.push(relativePath);
        }
    }

    for (const relativePath of beforeFiles.keys()) {
        if (!afterFiles.has(relativePath)) {
            removed.push(relativePath);
        }
    }

    return Object.freeze({
        added: Object.freeze(added.toSorted((left, right) => left.localeCompare(right))),
        modified: Object.freeze(modified.toSorted((left, right) => left.localeCompare(right))),
        removed: Object.freeze(removed.toSorted((left, right) => left.localeCompare(right)))
    });
}

/**
 * Format a project change summary for assertion failure messages.
 *
 * @param summary Project change summary.
 * @returns Stable single-line summary.
 */
export function formatProjectChangeSummary(summary: ProjectChangeSummary): string {
    return [
        `added=${summary.added.length}${summary.added.length > 0 ? ` [${summary.added.join(", ")}]` : ""}`,
        `modified=${summary.modified.length}${summary.modified.length > 0 ? ` [${summary.modified.join(", ")}]` : ""}`,
        `removed=${summary.removed.length}${summary.removed.length > 0 ? ` [${summary.removed.join(", ")}]` : ""}`
    ].join("; ");
}

function extractJsonPayloadText(outputText: string): string {
    const trimmed = outputText.trim();
    const objectStart = trimmed.indexOf("{");
    const arrayStart = trimmed.indexOf("[");
    const payloadStart =
        objectStart === -1 ? arrayStart : arrayStart === -1 ? objectStart : Math.min(objectStart, arrayStart);

    if (payloadStart === -1) {
        throw new Error(`CLI output does not contain a JSON payload: ${trimmed.slice(0, 200)}`);
    }

    return trimmed.slice(payloadStart);
}

/**
 * Parse a JSON payload from CLI stdout that may contain command-runner prefixes.
 *
 * @param outputText CLI stdout text.
 * @returns Parsed JSON object or array.
 */
export function parseJsonCliPayload(outputText: string): JsonCliPayload {
    const payload = JSON.parse(extractJsonPayloadText(outputText)) as unknown;
    if (!payload || (typeof payload !== "object" && !Array.isArray(payload))) {
        throw new TypeError("CLI JSON payload must be an object or array.");
    }

    return payload as JsonCliPayload;
}

/**
 * Parse and assert that a CLI JSON payload is an object.
 *
 * @param outputText CLI stdout text.
 * @returns Parsed JSON object.
 */
export function assertJsonCliPayload(outputText: string): Record<string, unknown> {
    const payload = parseJsonCliPayload(outputText);
    if (Array.isArray(payload)) {
        throw new TypeError("Expected CLI JSON payload to be an object, received an array.");
    }

    return payload as Record<string, unknown>;
}

function createAvailablePortServer(host: string): Promise<Server> {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.once("error", (error) => {
            reject(error);
        });
        server.listen(0, host, () => {
            resolve(server);
        });
    });
}

function closeAvailablePortServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(new Error(`Failed to close temporary port server: ${error.message}`, { cause: error }));
                return;
            }

            resolve();
        });
    });
}

/**
 * Reserve and release a batch of currently available TCP ports.
 *
 * @param count Number of ports to allocate.
 * @param host Host address to bind while probing for ports.
 * @returns Distinct available port numbers.
 */
export async function findAvailablePorts(count: number, host = "127.0.0.1"): Promise<Array<number>> {
    const servers = await Promise.all(Array.from({ length: count }, async () => await createAvailablePortServer(host)));

    try {
        return servers.map((server) => {
            const address = server.address();
            if (!address || typeof address === "string") {
                throw new Error("Failed to resolve test port.");
            }

            return address.port;
        });
    } finally {
        await Promise.all(servers.map(async (server) => await closeAvailablePortServer(server)));
    }
}

/**
 * Fetch a JSON object payload from an HTTP endpoint.
 *
 * @param endpointUrl Absolute endpoint URL.
 * @returns Parsed JSON object payload.
 */
export async function fetchJsonEndpointPayload<TPayload extends JsonEndpointPayload>(
    endpointUrl: string
): Promise<TPayload> {
    const response = await fetch(endpointUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch JSON endpoint ${endpointUrl}: ${response.status}`);
    }

    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError(`JSON endpoint ${endpointUrl} did not return an object payload.`);
    }

    return payload as TPayload;
}

/**
 * Poll a JSON endpoint until its payload satisfies a predicate.
 *
 * @param endpointUrl Absolute endpoint URL.
 * @param predicate Predicate that reports whether polling is complete.
 * @param timeoutMs Maximum wait time.
 * @param pollIntervalMs Delay between attempts.
 * @returns The first payload accepted by the predicate.
 */
export async function waitForJsonEndpointPayload<TPayload extends JsonEndpointPayload>(
    endpointUrl: string,
    predicate: (payload: TPayload) => boolean,
    timeoutMs = DEFAULT_JSON_ENDPOINT_TIMEOUT_MS,
    pollIntervalMs = DEFAULT_JSON_ENDPOINT_POLL_INTERVAL_MS
): Promise<TPayload> {
    const deadline = Date.now() + timeoutMs;

    async function poll(): Promise<TPayload> {
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for JSON endpoint ${endpointUrl}.`);
        }

        try {
            const payload = await fetchJsonEndpointPayload<TPayload>(endpointUrl);
            if (predicate(payload)) {
                return payload;
            }
        } catch {
            // Endpoint polling intentionally tolerates transient startup failures.
        }

        await createDelay(pollIntervalMs);
        return await poll();
    }

    return await poll();
}
