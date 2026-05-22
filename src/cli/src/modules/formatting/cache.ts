/**
 * Formatting cache module for the GML CLI format command.
 *
 * Provides caching functionality to avoid re-formatting identical files with
 * identical options. Uses content hashing to prevent memory bloat while still
 * providing effective deduplication across large formatting runs.
 */

import { createHash } from "node:crypto";

import type { Options as PrettierOptions } from "prettier";

import { getDefaultMaxFormattingCacheEntries } from "../../runtime-options/format-memory-cache.js";

/**
 * Internal cache storing formatted output keyed by content hash and options.
 * Uses LRU eviction when the cache exceeds the configured max-entry cap.
 */
const formattingCache = new Map<string, string>();

/**
 * Trims the formatting cache to the specified limit using LRU eviction.
 * If limit is not finite, the cache is left unchanged.
 * If limit is 0 or negative, the cache is cleared entirely.
 */
export function trimFormattingCache(limit = getDefaultMaxFormattingCacheEntries()): void {
    if (!Number.isFinite(limit)) {
        return;
    }

    if (limit <= 0) {
        formattingCache.clear();
        return;
    }

    while (formattingCache.size > limit) {
        const { value: oldestKey, done } = formattingCache.keys().next();
        if (done) {
            break;
        }

        formattingCache.delete(oldestKey);
    }
}

/**
 * Retrieves a cached formatted string for the given cache key.
 * Implements LRU by moving the entry to the end of the map when accessed.
 * Returns undefined if the key is not in the cache.
 */
export function getFormattingCacheEntry(cacheKey: string): string | undefined {
    const cached = formattingCache.get(cacheKey);
    if (cached !== undefined) {
        formattingCache.delete(cacheKey);
        formattingCache.set(cacheKey, cached);
    }
    return cached;
}

/**
 * Stores a formatted string in the cache and trims if necessary.
 */
export function storeFormattingCacheEntry(cacheKey: string, formatted: string): void {
    formattingCache.set(cacheKey, formatted);
    trimFormattingCache();
}

/**
 * Estimates the total memory usage of the formatting cache in bytes.
 * Counts both keys and values.
 */
export function estimateFormattingCacheBytes(): number {
    let total = 0;
    for (const [key, value] of formattingCache.entries()) {
        total += Buffer.byteLength(key, "utf8");
        total += Buffer.byteLength(value, "utf8");
    }

    return total;
}

/**
 * Converts a cache component value to a string for use in cache key construction.
 * Returns empty string for null/undefined, string representation for primitives,
 * and JSON stringification for objects.
 */
function stringifyCacheComponent(value: unknown): string {
    if (value === undefined || value === null) {
        return "";
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    return JSON.stringify(value);
}

/**
 * Creates a cache key from file content and Prettier options.
 * Uses SHA-256 hashing of file content to prevent memory bloat while ensuring
 * uniqueness. The cache key includes formatting options to ensure that changes
 * to options invalidate cached results.
 */
export function createFormattingCacheKey(data: string, formattingOptions: PrettierOptions): string {
    const { parser, tabWidth, printWidth, semi, useTabs, plugins } = formattingOptions;
    const pluginKey = Array.isArray(plugins) ? plugins.map(String).toSorted().join(",") : "";
    // Use a hash of the file content instead of the full content to prevent memory bloat.
    // The cache key previously included the entire file content, which caused unbounded
    // memory growth when formatting large projects with many large files.
    const contentHash = createHash("sha256").update(data, "utf8").digest("hex");
    return [
        stringifyCacheComponent(parser),
        stringifyCacheComponent(tabWidth),
        stringifyCacheComponent(printWidth),
        stringifyCacheComponent(semi),
        stringifyCacheComponent(useTabs),
        pluginKey,
        contentHash
    ].join("|");
}

/**
 * Returns current cache statistics for monitoring and testing.
 */
export function getFormattingCacheStats(): {
    size: number;
    estimatedBytes: number;
    maxEntries: number;
} {
    const maxEntries = getDefaultMaxFormattingCacheEntries();
    return {
        size: formattingCache.size,
        estimatedBytes: estimateFormattingCacheBytes(),
        maxEntries
    };
}

/**
 * Returns all cache keys for testing purposes.
 */
export function getFormattingCacheKeys(): string[] {
    return [...formattingCache.keys()];
}

/**
 * Clears the entire formatting cache.
 */
export function clearFormattingCache(): void {
    formattingCache.clear();
}
