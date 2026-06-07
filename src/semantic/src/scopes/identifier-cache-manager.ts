import { Core } from "@gmloop/core";

import type { ScopeSymbolMetadata } from "./types.js";

/**
 * Bounded, LRU-style cache for symbol metadata collected during scope tracking.
 *
 * The cache is keyed by (name, scopeId) so that the same symbol name in different
 * scopes occupies separate entries — each scope may declare or reference a name
 * independently.
 *
 * Two independent limits govern eviction:
 * - `maxTrackedNames` — global ceiling on distinct symbol names retained.
 *   Pass `0` (or any non-positive value) to fall back to the default of 4000.
 *   There is no "disable entirely" sentinel here; use a sufficiently large value
 *   if unbounded growth is acceptable for the session.
 * - `maxScopesPerName` — how many scope-entries may accumulate for a single
 *   name before the per-name entry is pruned.  Pass `0` (or any non-positive
 *   value) to fall back to the default of 64.  Pass `Infinity` to disable
 *   per-name eviction entirely.
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
            this.cache.delete(name);
            this.cache.set(name, scopeResults);
        } else {
            const newScopeResults = new Map<string, ScopeSymbolMetadata | null>();
            this.cache.set(name, newScopeResults);
            scopeResults = newScopeResults;
        }

        if (!scopeResults.has(scopeId) && scopeResults.size >= this.maxScopesPerName) {
            const oldestScopeIdIter = scopeResults.keys();
            const oldestScopeId = oldestScopeIdIter.next().value;
            if (oldestScopeId !== undefined) {
                scopeResults.delete(oldestScopeId);
            }
        }

        scopeResults.set(scopeId, declaration);

        if (this.cache.size > this.maxTrackedNames) {
            const oldestNameIter = this.cache.keys();
            const oldestName = oldestNameIter.next().value;
            if (oldestName !== undefined) {
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

    /**
     * Invalidates every cached resolution result that started from one of the given scopes.
     *
     * @param scopeIds - Scope IDs whose cached resolution entries should be removed.
     */
    public invalidateScopes(scopeIds: Iterable<string>): void {
        const scopeIdsToRemove = new Set(scopeIds);
        if (scopeIdsToRemove.size === 0) {
            return;
        }

        for (const [name, scopeResults] of this.cache) {
            for (const scopeId of scopeResults.keys()) {
                if (scopeIdsToRemove.has(scopeId)) {
                    scopeResults.delete(scopeId);
                }
            }

            if (scopeResults.size === 0) {
                this.cache.delete(name);
            }
        }
    }

    /**
     * Counts retained cached name/scope resolution entries for diagnostics and regression tests.
     *
     * @returns Total number of cached resolution entries currently retained.
     */
    public countRetainedEntries(): number {
        let retainedEntries = 0;
        for (const scopeResults of this.cache.values()) {
            retainedEntries += scopeResults.size;
        }
        return retainedEntries;
    }
}
