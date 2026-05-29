import fs from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { resolveFromRepoRoot } from "../../shared/index.js";
import {
    HOT_RELOAD_DIR_NAME,
    LIVE_RELOAD_ASSET_ROOT_RELATIVE_PATH,
    LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH,
    LIVE_RELOAD_BOOTSTRAP_ENTRY_RELATIVE_PATH,
    type LiveReloadAssetSyncResult,
    type LiveReloadBootstrapConfig,
    RUNTIME_WRAPPER_ASSET_MANIFEST_FILE_NAME
} from "./config.js";

const { cloneObjectEntries, parseJsonWithContext, safeStat } = Core;

interface RuntimeWrapperAssetManifestEntry {
    relativePath: string;
    size: number;
    mtimeMs: number;
}

interface RuntimeWrapperAssetManifest {
    version: number;
    entries: ReadonlyArray<RuntimeWrapperAssetManifestEntry>;
}

const HOT_RELOAD_ASSET_MANIFEST_VERSION = 3;
const DEFAULT_RUNTIME_WRAPPER_DIST_ROOT = resolveFromRepoRoot("src", "runtime-wrapper", "dist");
const PUBLIC_RUNTIME_WRAPPER_ASSET_DIRECTORIES = Object.freeze(["browser"]);

export interface SyncLiveReloadAssetsOptions {
    outputRoot: string;
    bootstrapConfig: LiveReloadBootstrapConfig;
    runtimeWrapperDistRoot?: string;
}

function shouldCopyRuntimeWrapperAsset(assetPath: string): boolean {
    return !assetPath.endsWith(".d.ts") && !assetPath.endsWith(".d.ts.map");
}

async function ensureDirectoryExists(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
}

function createRuntimeWrapperAssetManifest(
    entries: Array<RuntimeWrapperAssetManifestEntry>
): RuntimeWrapperAssetManifest {
    return Object.freeze({
        version: HOT_RELOAD_ASSET_MANIFEST_VERSION,
        entries: Object.freeze(entries)
    });
}

function isRuntimeWrapperAssetManifestEntry(value: unknown): value is RuntimeWrapperAssetManifestEntry {
    if (!Core.isObjectLike(value)) {
        return false;
    }

    const record = value as Record<string, unknown>;
    return (
        typeof record.relativePath === "string" &&
        typeof record.size === "number" &&
        Number.isFinite(record.size) &&
        typeof record.mtimeMs === "number" &&
        Number.isFinite(record.mtimeMs)
    );
}

function parseRuntimeWrapperAssetManifest(manifestContents: string): RuntimeWrapperAssetManifest | null {
    const parsed = parseJsonWithContext(manifestContents, {
        description: "runtime wrapper asset manifest"
    });
    if (!Core.isObjectLike(parsed)) {
        return null;
    }

    if (parsed.version !== HOT_RELOAD_ASSET_MANIFEST_VERSION) {
        return null;
    }

    if (!Array.isArray(parsed.entries) || !parsed.entries.every(isRuntimeWrapperAssetManifestEntry)) {
        return null;
    }

    return createRuntimeWrapperAssetManifest(cloneObjectEntries(parsed.entries));
}

async function readRuntimeWrapperAssetManifest(manifestPath: string): Promise<RuntimeWrapperAssetManifest | null> {
    const manifestContents = await fs.readFile(manifestPath, "utf8").catch((error) => {
        const maybeFsError = error as NodeJS.ErrnoException;
        if (maybeFsError.code === "ENOENT") {
            return null;
        }

        throw error;
    });

    if (!manifestContents) {
        return null;
    }

    return parseRuntimeWrapperAssetManifest(manifestContents);
}

function areRuntimeWrapperAssetManifestsEqual(
    left: RuntimeWrapperAssetManifest,
    right: RuntimeWrapperAssetManifest
): boolean {
    if (left.version !== right.version || left.entries.length !== right.entries.length) {
        return false;
    }

    return left.entries.every((entry, index) => {
        const candidate = right.entries[index];
        return (
            entry.relativePath === candidate.relativePath &&
            entry.size === candidate.size &&
            entry.mtimeMs === candidate.mtimeMs
        );
    });
}

async function collectRuntimeWrapperAssetManifestEntries(
    runtimeWrapperDistRoot: string
): Promise<Array<RuntimeWrapperAssetManifestEntry>> {
    async function scanAssetDirectory(currentDirectory: string): Promise<Array<RuntimeWrapperAssetManifestEntry>> {
        const entries = await fs.readdir(currentDirectory, { withFileTypes: true });
        const nestedResults = await Promise.all(
            entries.map(async (entry) => {
                const entryPath = path.join(currentDirectory, entry.name);
                if (entry.isDirectory()) {
                    return scanAssetDirectory(entryPath);
                }

                if (!entry.isFile() || !shouldCopyRuntimeWrapperAsset(entryPath)) {
                    return [];
                }

                const stats = await fs.stat(entryPath);
                return [
                    Object.freeze({
                        relativePath: path.relative(runtimeWrapperDistRoot, entryPath),
                        size: stats.size,
                        mtimeMs: stats.mtimeMs
                    })
                ];
            })
        );

        return nestedResults.flat();
    }

    const directoryEntries = await Promise.all(
        PUBLIC_RUNTIME_WRAPPER_ASSET_DIRECTORIES.map(async (relativeDirectory) => {
            const sourceDirectory = path.join(runtimeWrapperDistRoot, relativeDirectory);
            const directoryStats = await safeStat(sourceDirectory);
            if (!directoryStats?.isDirectory()) {
                throw new Error(`Expected runtime wrapper asset directory '${sourceDirectory}' to exist.`);
            }

            return scanAssetDirectory(sourceDirectory);
        })
    );

    const manifestEntries = directoryEntries.flat();
    manifestEntries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return manifestEntries;
}

async function copyRuntimeWrapperAssetDirectories(runtimeWrapperDistRoot: string, targetRoot: string): Promise<void> {
    await Promise.all(
        PUBLIC_RUNTIME_WRAPPER_ASSET_DIRECTORIES.map((relativeDirectory) =>
            copyRuntimeWrapperAssetDirectory(runtimeWrapperDistRoot, targetRoot, relativeDirectory)
        )
    );
}

function renderLiveReloadBootstrapConfigModule(config: LiveReloadBootstrapConfig): string {
    return [
        "export const liveReloadBootstrapConfig = Object.freeze(",
        Core.stringifyJsonForFile(
            {
                websocketUrl: config.websocketUrl,
                ...(config.statusUrl ? { statusUrl: config.statusUrl } : {}),
                ...(config.logLevel ? { logLevel: config.logLevel } : {})
            },
            { space: 2 }
        ),
        ");"
    ].join("");
}

async function writeLiveReloadBootstrapConfig(
    targetRoot: string,
    bootstrapConfig: LiveReloadBootstrapConfig
): Promise<void> {
    const targetConfigPath = path.join(targetRoot, "browser", "config.js");
    await fs.writeFile(targetConfigPath, `${renderLiveReloadBootstrapConfigModule(bootstrapConfig)}\n`, "utf8");
}

export async function syncLiveReloadAssets({
    outputRoot,
    bootstrapConfig,
    runtimeWrapperDistRoot = DEFAULT_RUNTIME_WRAPPER_DIST_ROOT
}: SyncLiveReloadAssetsOptions): Promise<LiveReloadAssetSyncResult> {
    const resolvedDistRoot = path.resolve(runtimeWrapperDistRoot);
    const distStats = await fs.stat(resolvedDistRoot).catch((error) => {
        throw new Error(
            `Runtime wrapper assets not found at '${resolvedDistRoot}': ${Core.getErrorMessageOrFallback(error)}`
        );
    });

    if (!distStats.isDirectory()) {
        throw new Error(`Runtime wrapper asset root '${resolvedDistRoot}' is not a directory.`);
    }

    const hotReloadRoot = path.join(outputRoot, HOT_RELOAD_DIR_NAME);
    const targetRoot = path.join(hotReloadRoot, LIVE_RELOAD_ASSET_ROOT_RELATIVE_PATH);
    const manifestPath = path.join(hotReloadRoot, RUNTIME_WRAPPER_ASSET_MANIFEST_FILE_NAME);
    const sourceManifest = createRuntimeWrapperAssetManifest(
        await collectRuntimeWrapperAssetManifestEntries(resolvedDistRoot)
    );
    const existingManifest = await readRuntimeWrapperAssetManifest(manifestPath);
    const targetStats = await safeStat(targetRoot);
    const manifestUnchanged =
        targetStats?.isDirectory() &&
        existingManifest !== null &&
        areRuntimeWrapperAssetManifestsEqual(sourceManifest, existingManifest);

    await ensureDirectoryExists(hotReloadRoot);

    if (!manifestUnchanged) {
        await fs.rm(targetRoot, { recursive: true, force: true });
        await copyRuntimeWrapperAssetDirectories(resolvedDistRoot, targetRoot);
        await fs.writeFile(manifestPath, `${Core.stringifyJsonForFile(sourceManifest, { space: 2 })}\n`, "utf8");
    }

    await writeLiveReloadBootstrapConfig(targetRoot, bootstrapConfig);

    return Object.freeze({
        targetRoot,
        copiedAssets: !manifestUnchanged,
        manifestPath,
        bootstrapEntryPath: path.join(hotReloadRoot, LIVE_RELOAD_BOOTSTRAP_ENTRY_RELATIVE_PATH)
    });
}

async function copyRuntimeWrapperAssetDirectory(
    runtimeWrapperDistRoot: string,
    targetRoot: string,
    relativeDirectory: string
): Promise<void> {
    const sourceDirectory = path.join(runtimeWrapperDistRoot, relativeDirectory);
    const targetDirectory = path.join(targetRoot, relativeDirectory);

    await ensureDirectoryExists(path.dirname(targetDirectory));
    await fs.cp(sourceDirectory, targetDirectory, {
        recursive: true,
        force: true,
        filter: shouldCopyRuntimeWrapperAsset
    });
}

export const __test__ = Object.freeze({
    DEFAULT_RUNTIME_WRAPPER_DIST_ROOT,
    HOT_RELOAD_ASSET_MANIFEST_VERSION,
    LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH,
    parseRuntimeWrapperAssetManifest,
    collectRuntimeWrapperAssetManifestEntries
});
