import { Core } from "@gmloop/core";

import type { ScopeSymbolMetadata } from "./types.js";

/**
 * Manages caching for identifier resolution results within a scope tracker.
 *
 * This class handles the storage, retrieval, and invalidation of cached
 * identifier resolution results to optimize repetitive lookups across
 * the scope hierarchy.
 */
export class IdentifierCacheManager {
    /**
     * Map of identifier names to a secondary map of scope IDs and their
     * associated resolution results (or null if not found in that scope).
     */
    private readonly cache = new Map<string, Map<string, ScopeSymbolMetadata | null>>();
    private readonly maxTrackedNames: number;
    private readonly maxScopesPerName: number;

    constructor(options: { maxTrackedNames?: number; maxScopesPerName?: number } = {}) {
        this.maxTrackedNames = Core.coercePositiveIntegerOption(options.maxTrackedNames, 4000);
        this.maxScopesPerName = Core.coercePositiveIntegerOption(options.maxScopesPerName, 64);
    }

    /**
     * Attempts to read a resolution result from the cache for a given identifier name in a specific scope.
     *
     * @param name - The name of the identifier to look up.
     * @param scopeId - The ID of the scope to look in.
     * @returns The cached metadata, null if cached as non-existent, or undefined if no cache entry exists.
     */
    public read(name: string, scopeId: string): ScopeSymbolMetadata | null | undefined {
        const scopeResults = this.cache.get(name);
        const value = scopeResults?.get(scopeId);
        if (!scopeResults || value === undefined) {
            return value;
        }

        // Mark as recently used by reinserting both the name and scope entry.
        scopeResults.delete(scopeId);
        scopeResults.set(scopeId, value);
        this.cache.delete(name);
        this.cache.set(name, scopeResults);
        return value;
    }

    /**
     * Writes a resolution result to the cache for a given identifier name in a specific scope.
     *
     * @param name - The name of the identifier.
     * @param scopeId - The ID of the scope.
     * @param declaration - The metadata to cache, or null if the identifier was not found.
     */
    public write(name: string, scopeId: string, declaration: ScopeSymbolMetadata | null): void {
        let scopeResults = this.cache.get(name);
        if (scopeResults) {
            // Mark as recently used at the top-level cache.
            this.cache.delete(name);
            this.cache.set(name, scopeResults);
        } else {
            scopeResults = new Map();
            this.cache.set(name, scopeResults);
        }

        if (!scopeResults.has(scopeId) && scopeResults.size >= this.maxScopesPerName) {
            const oldestScopeId = scopeResults.keys().next().value;
            if (oldestScopeId) {
                scopeResults.delete(oldestScopeId);
            }
        }

        scopeResults.set(scopeId, declaration);

        if (this.cache.size > this.maxTrackedNames) {
            const oldestName = this.cache.keys().next().value;
            if (oldestName) {
                this.cache.delete(oldestName);
            }
        }
    }

    /**
     * Invalidates cached results for a specific identifier name and set of scope IDs.
     *
     * @param name - The name of the identifier to invalidate.
     * @param scopeIds - An optional iterable of scope IDs to remove from the cache.
     *                  If omitted or null, all cached results for this identifier name are cleared.
     */
    public invalidate(name: string, scopeIds?: Iterable<string> | null): void {
        if (!scopeIds) {
            this.cache.delete(name);
            return;
        }

        const scopeResults = this.cache.get(name);
        if (!scopeResults) {
            return;
        }

        for (const scopeId of scopeIds) {
            scopeResults.delete(scopeId);
        }

        if (scopeResults.size === 0) {
            this.cache.delete(name);
        }
    }
}
