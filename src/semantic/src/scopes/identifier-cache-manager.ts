import { Core } from "@gmloop/core";

import type { ScopeSymbolMetadata } from "./types.js";

/**
 * Read-only access to a single cached identifier resolution.
 *
 * Provides the ability to look up a previously-written metadata value
 * (or the negative `null` cached absence, or `undefined` to signal no
 * entry yet) without coupling to the storage, invalidation, or
 * diagnostic operations the cache also exposes.
 *
 * Callers that only need lookups — for example a follow-up resolution
 * path that consults the cache before recomputing — depend on this role
 * alone to keep their contract honest.
 */
export interface IdentifierCacheReader {
    /**
     * Attempts to read a resolution result from the cache for a given identifier name in a specific scope.
     *
     * @param name - The name of the identifier to look up.
     * @param scopeId - The ID of the scope to look in.
     * @returns The cached metadata, null if cached as non-existent, or undefined if no cache entry exists.
     */
    read(name: string, scopeId: string): ScopeSymbolMetadata | null | undefined;
}

/**
 * Single-entry write access for cached identifier resolutions.
 *
 * Provides the ability to populate the cache without coupling to the
 * lookup, invalidation, or diagnostic operations the cache also exposes.
 * Pair with {@link IdentifierCacheReader} when wiring a cache
 * implementation that needs the look-then-store pattern.
 */
export interface IdentifierCacheWriter {
    /**
     * Writes a resolution result to the cache for a given identifier name in a specific scope.
     *
     * @param name - The name of the identifier.
     * @param scopeId - The ID of the scope.
     * @param declaration - The metadata to cache, or null if the identifier was not found.
     */
    write(name: string, scopeId: string, declaration: ScopeSymbolMetadata | null): void;
}

/**
 * Cache invalidation operations.
 *
 * Combines the two invalidation strategies the cache exposes:
 * - {@link IdentifierCacheInvalidator.invalidate} drops entries that match
 *   a single name (across the supplied subset of scopes, or every scope).
 * - {@link IdentifierCacheInvalidator.invalidateScopes} drops every entry
 *   that originated in the supplied set of scope IDs.
 *
 * Both forms share the cache's internal bookkeeping, so consumers that need
 * one form almost always need the other. Splitting them apart here would
 * force callers to depend on the wider composite without a real win, so
 * the role groups them.
 */
export interface IdentifierCacheInvalidator {
    /**
     * Invalidates cached results for a specific identifier name and set of scope IDs.
     *
     * @param name - The name of the identifier to invalidate.
     * @param scopeIds - An optional iterable of scope IDs to remove from the cache.
     *                  If omitted or null, all cached results for this identifier name are cleared.
     */
    invalidate(name: string, scopeIds?: Iterable<string> | null): void;

    /**
     * Invalidates every cached resolution result that started from one of the given scopes.
     *
     * Uses the scope-to-names reverse index to touch only the entries affected
     * by the removed scopes, rather than scanning the entire cache — this keeps
     * per-edit invalidation cost proportional to the edit, not to cache size.
     *
     * @param scopeIds - Scope IDs whose cached resolution entries should be removed.
     */
    invalidateScopes(scopeIds: Iterable<string>): void;
}

/**
 * Cache diagnostics surface.
 *
 * Provides counters for diagnostic reporters and regression tests without
 * coupling to lookup, storage, or invalidation operations. Callers that
 * only surface cache health should depend on this role alone.
 */
export interface IdentifierCacheDiagnostics {
    /**
     * Counts retained cached name/scope resolution entries for diagnostics and regression tests.
     *
     * @returns Total number of cached resolution entries currently retained.
     */
    countRetainedEntries(): number;
}

/**
 * Composite identifier cache contract.
 *
 * Combines every role interface so consumers that genuinely need every
 * capability can declare a single dependency. Consumers that only need a
 * subset should depend on the matching role interface directly
 * (see {@link IdentifierCacheReader}, {@link IdentifierCacheWriter},
 * {@link IdentifierCacheInvalidator}, and
 * {@link IdentifierCacheDiagnostics}) to keep their contracts honest.
 *
 * Each role models one cohesive responsibility and exposes only the
 * members its consumers require, which is the Interface Segregation
 * Principle in practice.
 */
export type IdentifierCacheContract = IdentifierCacheReader &
    IdentifierCacheWriter &
    IdentifierCacheInvalidator &
    IdentifierCacheDiagnostics;

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
 *
 * The class implements each role interface separately so callers can depend
 * on the narrow role they actually use; see {@link IdentifierCacheContract}
 * for the full composite shape.
 */

/**
 * Resolve the per-name scope cap, preserving `Infinity` as the documented
 * "disable per-name eviction" sentinel.
 *
 * `Core.coercePositiveIntegerOption` collapses any non-finite input — including
 * `Infinity` — back to the default, which silently re-enabled eviction for
 * callers who followed the documented contract. This helper explicitly returns
 * `Infinity` when the caller passed it so the `write()` cap check
 * (`scopeResults.size >= this.maxScopesPerName`) never triggers, matching the
 * "disable per-name eviction entirely" promise above. Non-positive numbers
 * still fall back to the supplied default; `NaN`, objects, and other invalid
 * inputs also fall back to the default to mirror the surrounding helpers.
 */
function resolveMaxScopesPerName(value: unknown, defaultValue: number): number {
    if (value === Number.POSITIVE_INFINITY) {
        return Number.POSITIVE_INFINITY;
    }
    return Core.coercePositiveIntegerOption(value, defaultValue);
}

export class IdentifierCacheManager
    implements IdentifierCacheReader, IdentifierCacheWriter, IdentifierCacheInvalidator, IdentifierCacheDiagnostics
{
    /**
     * Map of identifier names to a secondary map of scope IDs and their
     * associated resolution results (or null if not found in that scope).
     */
    private readonly cache = new Map<string, Map<string, ScopeSymbolMetadata | null>>();
    /**
     * Reverse index from scope ID to the set of identifier names that have an
     * entry for that scope. This lets `invalidateScopes` — the hot path hit on
     * every scope removal during hot-reload — visit only the entries actually
     * affected instead of scanning the whole cache.
     */
    private readonly namesByScope = new Map<string, Set<string>>();
    private readonly maxTrackedNames: number;
    private readonly maxScopesPerName: number;

    constructor(options: { maxTrackedNames?: number; maxScopesPerName?: number } = {}) {
        this.maxTrackedNames = Core.coercePositiveIntegerOption(options.maxTrackedNames, 4000);
        this.maxScopesPerName = resolveMaxScopesPerName(options.maxScopesPerName, 64);
    }

    /**
     * Implementation of {@link IdentifierCacheReader.read}. Mark-as-recently-used
     * bookkeeping reorders both the name and the scope entry on every read so
     * the per-name LRU stays consistent with the global name LRU.
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
     * Implementation of {@link IdentifierCacheWriter.write}. Enforces both the
     * per-name cap and the global name cap by lazily pruning the oldest
     * sibling when a write would exceed the configured ceiling.
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

        const isNewScopeEntry = !scopeResults.has(scopeId);
        if (isNewScopeEntry && scopeResults.size >= this.maxScopesPerName) {
            const oldestScopeIdIter = scopeResults.keys();
            const oldestScopeId = oldestScopeIdIter.next().value;
            if (oldestScopeId !== undefined) {
                scopeResults.delete(oldestScopeId);
                this.unlinkNameFromScope(name, oldestScopeId);
            }
        }

        scopeResults.set(scopeId, declaration);
        if (isNewScopeEntry) {
            this.linkNameToScope(name, scopeId);
        }

        if (this.cache.size > this.maxTrackedNames) {
            const oldestNameIter = this.cache.keys();
            const oldestName = oldestNameIter.next().value;
            if (oldestName !== undefined) {
                const evictedScopeResults = this.cache.get(oldestName);
                this.cache.delete(oldestName);
                if (evictedScopeResults) {
                    for (const evictedScopeId of evictedScopeResults.keys()) {
                        this.unlinkNameFromScope(oldestName, evictedScopeId);
                    }
                }
            }
        }
    }

    /** Records that `scopeId` now has a cached entry for `name`. */
    private linkNameToScope(name: string, scopeId: string): void {
        let names = this.namesByScope.get(scopeId);
        if (!names) {
            names = new Set<string>();
            this.namesByScope.set(scopeId, names);
        }
        names.add(name);
    }

    /** Removes the record that `scopeId` has a cached entry for `name`. */
    private unlinkNameFromScope(name: string, scopeId: string): void {
        const names = this.namesByScope.get(scopeId);
        if (!names) {
            return;
        }
        names.delete(name);
        if (names.size === 0) {
            this.namesByScope.delete(scopeId);
        }
    }

    /**
     * Implementation of {@link IdentifierCacheInvalidator.invalidate}. Omitting
     * `scopeIds` invalidates every cached entry for the given name; supplying
     * the iterable prunes only the listed scopes.
     */
    public invalidate(name: string, scopeIds?: Iterable<string> | null): void {
        const scopeResults = this.cache.get(name);
        if (!scopeResults) {
            return;
        }

        if (!scopeIds) {
            for (const scopeId of scopeResults.keys()) {
                this.unlinkNameFromScope(name, scopeId);
            }
            this.cache.delete(name);
            return;
        }

        for (const scopeId of scopeIds) {
            if (scopeResults.delete(scopeId)) {
                this.unlinkNameFromScope(name, scopeId);
            }
        }

        if (scopeResults.size === 0) {
            this.cache.delete(name);
        }
    }

    /**
     * Implementation of {@link IdentifierCacheInvalidator.invalidateScopes}.
     * Walks the `namesByScope` reverse index so per-edit invalidation cost is
     * proportional to the edited scopes, not to the cache's global size.
     */
    public invalidateScopes(scopeIds: Iterable<string>): void {
        for (const scopeId of scopeIds) {
            const names = this.namesByScope.get(scopeId);
            if (!names) {
                continue;
            }

            for (const name of names) {
                const scopeResults = this.cache.get(name);
                scopeResults?.delete(scopeId);
                if (scopeResults && scopeResults.size === 0) {
                    this.cache.delete(name);
                }
            }

            this.namesByScope.delete(scopeId);
        }
    }

    /**
     * Implementation of {@link IdentifierCacheDiagnostics.countRetainedEntries}.
     * Sums the size of every per-name scope map without exposing the
     * underlying storage.
     */
    public countRetainedEntries(): number {
        let retainedEntries = 0;
        for (const scopeResults of this.cache.values()) {
            retainedEntries += scopeResults.size;
        }
        return retainedEntries;
    }
}
