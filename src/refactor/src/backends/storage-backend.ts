import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Runtime counters for spill backend activity.
 */
export type StorageBackendStats = {
    writes: number;
    reads: number;
    cacheHits: number;
    cacheMisses: number;
    spilledEntries: number;
};

/**
 * Abstraction for spill storage used by memory-bounded codemod overlays.
 */
export interface StorageBackend {
    writeEntry(key: string, content: string): Promise<void>;
    readEntry(key: string): Promise<string | null>;
    deleteEntry(key: string): Promise<void>;
    dispose(): Promise<void>;
    getStats(): StorageBackendStats;
}

type TempFileStorageBackendOptions = {
    readCacheMaxEntries?: number;
    tempDirectoryPrefix?: string;
};

/**
 * Configuration accepted by {@link createTempFileStorageBackend}.
 */
export type TempFileStorageBackendConfig = TempFileStorageBackendOptions;

type ReadCacheEntry = {
    content: string;
};

const DEFAULT_READ_CACHE_MAX_ENTRIES = 32;

function normalizeCacheLimit(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return DEFAULT_READ_CACHE_MAX_ENTRIES;
    }

    return Math.floor(value);
}

function sanitizeKeyForFileName(key: string): string {
    return key.replaceAll(/[^a-zA-Z0-9_.-]/g, "_");
}

function createStableKeyDigest(value: string): string {
    return createHash("sha1").update(value).digest("hex").slice(0, 16);
}

function createStorageFileName(key: string): string {
    const sanitizedPrefix = sanitizeKeyForFileName(key).slice(0, 48);
    const digest = createStableKeyDigest(key);
    return `${sanitizedPrefix}-${digest}.txt`;
}

/**
 * Resolves the temp directory path to clean up during disposal by awaiting
 * an in-flight {@link mkdtemp} promise when the synchronously captured
 * {@link rootPath} is still null. Returns the path to remove, or null
 * when no directory was ever created (e.g. if mkdtemp itself failed).
 */
async function resolveInflightTempPath(
    pendingPromise: Promise<string> | null,
    rootPath: string | null
): Promise<string | null> {
    if (rootPath) {
        return rootPath;
    }

    if (pendingPromise === null) {
        return null;
    }

    try {
        return await pendingPromise;
    } catch {
        // mkdtemp failed — no directory was created, nothing to clean up.
        return null;
    }
}

/**
 * Temp-file storage backend with bounded read-through cache.
 */
export class TempFileStorageBackend implements StorageBackend {
    private readonly readCacheMaxEntries: number;
    private readonly tempDirectoryPrefix: string;
    private readonly pathByKey = new Map<string, string>();
    private readonly readCacheByKey = new Map<string, ReadCacheEntry>();
    private readonly stats: StorageBackendStats = {
        writes: 0,
        reads: 0,
        cacheHits: 0,
        cacheMisses: 0,
        spilledEntries: 0
    };
    private tempRootPath: string | null = null;
    private tempRootPathPromise: Promise<string> | null = null;
    private disposed = false;

    constructor(options: TempFileStorageBackendOptions = {}) {
        this.readCacheMaxEntries = normalizeCacheLimit(options.readCacheMaxEntries);
        this.tempDirectoryPrefix = options.tempDirectoryPrefix ?? "gmloop-refactor-overlay-";
    }

    async writeEntry(key: string, content: string): Promise<void> {
        if (this.disposed) {
            throw new Error("TempFileStorageBackend cannot write after dispose");
        }

        const rootPath = await this.ensureRootPath();
        const filePath = this.resolveEntryPath(key, rootPath);
        await writeFile(filePath, content, "utf8");
        this.stats.writes += 1;
        this.stats.spilledEntries = this.pathByKey.size;
        // Reuse the just-written string for the next read so dry-run overlays do
        // not immediately allocate a second copy by round-tripping through disk.
        this.promoteReadCacheEntry(key, { content });
    }

    async readEntry(key: string): Promise<string | null> {
        if (this.disposed) {
            return null;
        }

        this.stats.reads += 1;
        const cached = this.readCacheByKey.get(key);
        if (cached) {
            this.stats.cacheHits += 1;
            this.promoteReadCacheEntry(key, cached);
            return cached.content;
        }

        const filePath = this.pathByKey.get(key);
        if (!filePath) {
            this.stats.cacheMisses += 1;
            return null;
        }

        try {
            const content = await readFile(filePath, "utf8");
            this.stats.cacheMisses += 1;
            this.promoteReadCacheEntry(key, { content });
            return content;
        } catch {
            // Treat missing or unreadable spill entries as absent data.
            this.pathByKey.delete(key);
            this.readCacheByKey.delete(key);
            this.stats.cacheMisses += 1;
            this.stats.spilledEntries = this.pathByKey.size;
            return null;
        }
    }

    async deleteEntry(key: string): Promise<void> {
        if (this.disposed) {
            return;
        }

        const filePath = this.pathByKey.get(key);
        this.pathByKey.delete(key);
        this.readCacheByKey.delete(key);

        if (!filePath) {
            this.stats.spilledEntries = this.pathByKey.size;
            return;
        }

        try {
            await rm(filePath, { force: true });
        } finally {
            this.stats.spilledEntries = this.pathByKey.size;
        }
    }

    async dispose(): Promise<void> {
        this.disposed = true;
        const pendingPromise = this.tempRootPathPromise;
        const rootPath = this.tempRootPath;
        this.tempRootPath = null;
        this.tempRootPathPromise = null;
        this.pathByKey.clear();
        this.readCacheByKey.clear();

        // If mkdtemp() is still in-flight, await it so the newly created
        // directory can be removed. Without this, dispose() would return
        // before the directory exists and the temp path would be orphaned.
        const resolvedPath = await resolveInflightTempPath(pendingPromise, rootPath);
        if (!resolvedPath) {
            return;
        }

        await rm(resolvedPath, { recursive: true, force: true });
    }

    getStats(): StorageBackendStats {
        return {
            ...this.stats,
            spilledEntries: this.pathByKey.size
        };
    }

    private async ensureRootPath(): Promise<string> {
        if (this.disposed) {
            throw new Error("TempFileStorageBackend cannot initialize after dispose");
        }

        if (this.tempRootPath) {
            return this.tempRootPath;
        }

        if (this.tempRootPathPromise === null) {
            this.tempRootPathPromise = mkdtemp(path.join(os.tmpdir(), this.tempDirectoryPrefix)).then((rootPath) => {
                // Guard against the race where dispose() ran while mkdtemp
                // was in-flight. dispose() awaits this same promise and will
                // handle directory removal, so skip caching the path here.
                if (!this.disposed) {
                    this.tempRootPath = rootPath;
                }
                return rootPath;
            });
        }

        const rootPath = await this.tempRootPathPromise;
        if (!rootPath) {
            throw new Error("TempFileStorageBackend failed to initialize root path");
        }

        return rootPath;
    }

    private resolveEntryPath(key: string, rootPath: string): string {
        const existing = this.pathByKey.get(key);
        if (existing) {
            return existing;
        }

        const fileName = createStorageFileName(key);
        const resolved = path.join(rootPath, fileName);
        this.pathByKey.set(key, resolved);
        return resolved;
    }

    private promoteReadCacheEntry(key: string, entry: ReadCacheEntry): void {
        this.readCacheByKey.delete(key);
        this.readCacheByKey.set(key, entry);

        while (this.readCacheByKey.size > this.readCacheMaxEntries) {
            const oldestKey = this.readCacheByKey.keys().next().value as string | undefined;
            if (oldestKey === undefined) {
                break;
            }

            this.readCacheByKey.delete(oldestKey);
        }
    }
}

/**
 * Create a temp-file spill backend instance.
 */
export function createTempFileStorageBackend(options: TempFileStorageBackendConfig = {}): TempFileStorageBackend {
    return new TempFileStorageBackend(options);
}
