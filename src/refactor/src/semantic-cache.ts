/**
 * Caching layer for semantic analyzer queries during refactoring operations.
 *
 * During batch renames and impact analysis, the refactor engine often queries
 * the same semantic data repeatedly (e.g., symbol occurrences, dependencies,
 * file symbols). This cache layer optimizes those operations by memoizing
 * results within a refactoring session, reducing redundant semantic analysis.
 *
 * The cache is session-scoped and provides methods to clear stale entries
 * when the underlying source files change.
 */

import { Core } from "@gmloop/core";

import type {
    DependentSymbol,
    FileSymbol,
    PartialSemanticAnalyzer,
    SymbolLocation,
    SymbolLookupResult,
    SymbolOccurrence
} from "./types.js";

/**
 * Cache entry with TTL tracking.
 */
interface CacheEntry<T> {
    value: T;
    timestamp: number;
}

/**
 * Configuration for the semantic query cache.
 */
export interface SemanticCacheConfig {
    /**
     * Maximum number of entries to store per cache type.
     * When exceeded, least-recently-used entries are evicted (LRU).
     * A value of `0` keeps the cache active but gives it zero capacity, so
     * fetched results are returned without being retained.
     * Default: 100
     */
    maxSize?: number;

    /**
     * Time-to-live for cached entries in milliseconds.
     * Entries older than this are considered stale.
     * Default: 60000 (1 minute)
     */
    ttlMs?: number;

    /**
     * Whether to enable the cache.
     * When false, all queries pass through to the semantic analyzer.
     * Default: true
     */
    enabled?: boolean;

    /**
     * Custom policy for deciding whether an occurrence result is cache-worthy.
     * When omitted, the cache constructs a {@link DefaultOccurrenceCachePolicy}
     * with a default threshold of `10_000`.
     *
     * Prefer providing a custom policy when you need to test the cache-storage
     * decision in isolation or want per-symbol thresholds.
     */
    occurrenceCachePolicy?: OccurrenceCachePolicy;
}

/**
 * Policy interface for deciding whether an occurrence array is cache-worthy.
 *
 * Separating this from the cache mechanism allows the threshold check to be
 * unit-tested independently from the cache's storage/eviction logic, and lets
 * callers inject alternative policies (e.g., always cache, never cache, or
 * per-symbol thresholds) without changing the cache implementation.
 */
export interface OccurrenceCachePolicy {
    /**
     * Return `true` when the given array is too large to be retained in-cache.
     * The cache will still return the value to callers; it simply omits the
     * store step, causing every subsequent query for the same key to re-fetch
     * from the semantic analyzer.
     *
     * @param occurrences - The result array that would be stored.
     */
    shouldCacheOccurrences(occurrences: ReadonlyArray<SymbolOccurrence>): boolean;
}

/**
 * Default occurrence cache policy backed by a configurable entry-count threshold.
 *
 * Rationale: very large occurrence sets are expensive to deduplicate and merge on
 * every cache hit, and consume disproportionate memory relative to the benefit of
 * caching a single result. Skipping the store for oversized results trades a
 * guaranteed re-fetch on the next lookup for consistent performance and memory
 * bounds on large codebases.
 */
export class DefaultOccurrenceCachePolicy implements OccurrenceCachePolicy {
    private readonly maxEntries: number;

    constructor(maxEntries: number) {
        this.maxEntries = maxEntries;
    }

    shouldCacheOccurrences(occurrences: ReadonlyArray<SymbolOccurrence>): boolean {
        return occurrences.length > this.maxEntries;
    }
}

/**
 * Policy that never skips caching — useful in tests or when the caller already
 * controls result size upstream.
 */
export class PermissiveOccurrenceCachePolicy implements OccurrenceCachePolicy {
    shouldCacheOccurrences(_occurrences: ReadonlyArray<SymbolOccurrence>): boolean {
        return false;
    }
}

/**
 * Statistics about cache performance.
 */
export interface CacheStats {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
}

/**
 * Internal config type with all fields resolved to non-optional defaults.
 * Separated from `SemanticCacheConfig` to avoid making `occurrenceCachePolicy`
 * a mandatory field on the public API surface.
 */
interface ResolvedSemanticCacheConfig {
    maxSize: number;
    ttlMs: number;
    enabled: boolean;
}

/**
 * Caching wrapper for semantic analyzer queries.
 *
 * Provides transparent caching of expensive semantic operations during
 * refactoring sessions. The cache is designed to be short-lived and scoped
 * to a single refactoring workflow (e.g., a batch rename operation).
 *
 * @example
 * ```typescript
 * const cache = new SemanticQueryCache(semantic, { maxSize: 50, ttlMs: 30000 });
 *
 * // First call queries semantic analyzer
 * const occurrences1 = await cache.getSymbolOccurrences("player_hp");
 *
 * // Second call returns cached result
 * const occurrences2 = await cache.getSymbolOccurrences("player_hp");
 *
 * // Clear cache when source changes
 * cache.invalidateAll();
 * ```
 */
export class SemanticQueryCache {
    private readonly semantic: PartialSemanticAnalyzer | null;
    private readonly config: ResolvedSemanticCacheConfig;

    private occurrenceCache = new Map<string, CacheEntry<Array<SymbolOccurrence>>>();
    private fileSymbolsCache = new Map<string, CacheEntry<Array<FileSymbol>>>();
    private dependentsCache = new Map<string, CacheEntry<Array<DependentSymbol>>>();
    private existenceCache = new Map<string, CacheEntry<boolean>>();
    private symbolLookupCache = new Map<string, CacheEntry<SymbolLookupResult | null>>();
    private symbolLocationCache = new Map<string, CacheEntry<SymbolLocation | null>>();
    private symbolIdCache = new Map<string, CacheEntry<string | null>>();

    /**
     * Tracks occurrence cache keys whose stored array has already been deduplicated
     * by the caller (via {@link primeOccurrenceCache}).  A hit on a primed key means
     * the returned array needs no further deduplication work.
     *
     * Entries are cleared alongside the occurrence cache entry itself — on
     * {@link invalidateAll}, {@link invalidateFile}, cache eviction, and TTL expiry.
     */
    private primedOccurrenceKeys = new Set<string>();

    /**
     * Reverse index mapping file paths to the set of occurrence cache keys that
     * reference them.  Maintained on cache insert and eviction so that
     * {@link invalidateFile} can locate affected entries in O(k) where k is the
     * number of cache keys referencing that file, instead of scanning all
     * occurrence cache entries O(n×m).
     */
    private occurrenceFileIndex = new Map<string, Set<string>>();

    private stats = {
        hits: 0,
        misses: 0,
        evictions: 0
    };

    /**
     * Extracted policy for occurrence cache-worthiness decisions.
     * Replaces the inline `shouldSkipOccurrenceCacheStore` heuristic.
     */
    private readonly occurrenceCachePolicy: OccurrenceCachePolicy;

    constructor(semantic: PartialSemanticAnalyzer | null, config: SemanticCacheConfig = {}) {
        this.semantic = semantic;

        this.occurrenceCachePolicy = config.occurrenceCachePolicy ?? new DefaultOccurrenceCachePolicy(10_000);

        this.config = {
            maxSize: config.maxSize ?? 100,
            ttlMs: config.ttlMs ?? 60_000,
            enabled: config.enabled ?? true
        };
    }

    /**
     * Get all occurrences of a symbol, using cached results if available.
     */
    getSymbolOccurrences(symbolName: string, symbolId: string | null = null): Promise<Array<SymbolOccurrence>> {
        const cacheKey = symbolId === null ? symbolName : `${symbolId}::${symbolName}`;
        return this.getOrFetch(this.occurrenceCache, cacheKey, () => this.fetchSymbolOccurrences(symbolName, symbolId));
    }

    /**
     * Replace the occurrence cache entry for the given symbol with an already-processed
     * (deduplicated and range-merged) array. This prevents repeated deduplication work
     * on every subsequent cache hit for the same symbol.
     *
     * Call this once after the first `getSymbolOccurrences` fetch has been deduplicated
     * so that all future lookups in the same session return the clean array directly.
     *
     * Entries the policy considers non-cache-worthy are silently skipped, matching the
     * same skip-cache policy that `getOrFetch` applies on the initial miss.
     */
    primeOccurrenceCache(symbolName: string, symbolId: string | null, deduplicated: Array<SymbolOccurrence>): void {
        if (!this.config.enabled) {
            return;
        }

        if (this.occurrenceCachePolicy.shouldCacheOccurrences(deduplicated)) {
            return;
        }

        const cacheKey = symbolId === null ? symbolName : `${symbolId}::${symbolName}`;
        this.setCached(this.occurrenceCache, cacheKey, deduplicated);
        this.primedOccurrenceKeys.add(cacheKey);
    }

    /**
     * Return `true` when the occurrence cache entry for the given symbol was stored
     * via {@link primeOccurrenceCache} and is therefore already deduplicated.
     *
     * Callers can use this to skip the deduplication step on subsequent cache hits,
     * avoiding redundant O(n) iteration over an already-clean occurrence array.
     */
    isOccurrencePrimed(symbolName: string, symbolId: string | null): boolean {
        const cacheKey = symbolId === null ? symbolName : `${symbolId}::${symbolName}`;
        return this.primedOccurrenceKeys.has(cacheKey);
    }

    /**
     * Get symbols defined in a file, using cached results if available.
     */
    getFileSymbols(filePath: string): Promise<Array<FileSymbol>> {
        return this.getOrFetch(this.fileSymbolsCache, filePath, () => this.fetchFileSymbols(filePath));
    }

    /**
     * Get symbols that depend on the given symbols, using cached results if available.
     */
    getDependents(symbolIds: Array<string>): Promise<Array<DependentSymbol>> {
        if (symbolIds.length === 0) {
            return Promise.resolve<Array<DependentSymbol>>([]);
        }

        // Use sorted, joined symbolIds as cache key to ensure consistent lookup
        const cacheKey = [...symbolIds].toSorted().join(",");
        return this.getOrFetch(this.dependentsCache, cacheKey, () => this.fetchDependents(symbolIds));
    }

    /**
     * Check if a symbol exists, using cached results if available.
     */
    hasSymbol(symbolId: string): Promise<boolean> {
        return this.getOrFetch(this.existenceCache, symbolId, () => this.fetchHasSymbol(symbolId));
    }

    /**
     * Batch query for file symbols across multiple files.
     * Optimized for hot reload scenarios where multiple files need to be queried at once.
     * Uses cache when possible and only fetches uncached files from the semantic analyzer.
     */
    async getFileSymbolsBatch(filePaths: ReadonlyArray<string>): Promise<Map<string, Array<FileSymbol>>> {
        const results = new Map<string, Array<FileSymbol>>();

        if (filePaths.length === 0) {
            return results;
        }

        const uncachedPaths: Array<string> = [];

        for (const filePath of filePaths) {
            if (!this.config.enabled) {
                uncachedPaths.push(filePath);
                continue;
            }

            const cached = this.getCached(this.fileSymbolsCache, filePath);
            if (cached === null) {
                uncachedPaths.push(filePath);
            } else {
                this.stats.hits++;
                results.set(filePath, cached);
            }
        }

        if (uncachedPaths.length > 0) {
            const fetchedResults = await Promise.all(
                uncachedPaths.map(async (filePath) => {
                    this.stats.misses++;
                    const symbols = await this.fetchFileSymbols(filePath);
                    if (this.config.enabled) {
                        this.setCached(this.fileSymbolsCache, filePath, symbols);
                    }
                    return { filePath, symbols };
                })
            );

            for (const { filePath, symbols } of fetchedResults) {
                results.set(filePath, symbols);
            }
        }

        return results;
    }

    /**
     * Look up a symbol in the semantic analyzer.
     * Uses cached results if available.
     */
    lookup(name: string, scopeId?: string): Promise<SymbolLookupResult | null> {
        const cacheKey = scopeId ? `${scopeId}::${name}` : name;
        return this.getOrFetch(this.symbolLookupCache, cacheKey, () => this.fetchLookup(name, scopeId));
    }

    /**
     * Find the symbol at a specific location in a file.
     * Uses cached results if available.
     */
    getSymbolAtPosition(filePath: string, offset: number): Promise<SymbolLocation | null> {
        const cacheKey = `${filePath}:${offset}`;
        return this.getOrFetch(this.symbolLocationCache, cacheKey, () => this.fetchSymbolAtPosition(filePath, offset));
    }

    /**
     * Resolve a symbol ID from an identifier name.
     * Uses cached results if available.
     */
    resolveSymbolId(identifierName: string): Promise<string | null> {
        return this.getOrFetch(this.symbolIdCache, identifierName, () => this.fetchResolveSymbolId(identifierName));
    }

    /**
     * Invalidate all cached entries.
     * Should be called when source files change during a refactoring session.
     */
    invalidateAll(): void {
        this.occurrenceCache.clear();
        this.fileSymbolsCache.clear();
        this.dependentsCache.clear();
        this.existenceCache.clear();
        this.symbolLookupCache.clear();
        this.symbolLocationCache.clear();
        this.symbolIdCache.clear();
        this.primedOccurrenceKeys.clear();
        this.occurrenceFileIndex.clear();
    }

    /**
     * Invalidate cached entries for a specific file.
     * Useful when a file changes but others remain valid.
     */
    invalidateFile(filePath: string): void {
        const cachedSymbols = this.getCached(this.fileSymbolsCache, filePath, false);
        this.fileSymbolsCache.delete(filePath);

        if (cachedSymbols) {
            const symbolIds = new Set(cachedSymbols.map((symbol) => symbol.id));

            for (const symbolId of symbolIds) {
                this.existenceCache.delete(symbolId);
            }

            if (symbolIds.size > 0) {
                for (const key of this.dependentsCache.keys()) {
                    const dependencyIds = key.split(",");
                    if (dependencyIds.some((dependencyId) => symbolIds.has(dependencyId))) {
                        this.dependentsCache.delete(key);
                    }
                }
            }
        }

        // Clear occurrence cache entries that reference this file using the
        // reverse index for O(k) lookup instead of scanning all entries.
        const affectedKeys = this.occurrenceFileIndex.get(filePath);
        if (affectedKeys) {
            for (const key of affectedKeys) {
                this.removeOccurrenceCacheEntry(key);
            }
            this.occurrenceFileIndex.delete(filePath);
        }
    }

    /**
     * Get cache performance statistics.
     */
    getStats(): CacheStats {
        return {
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            size:
                this.occurrenceCache.size +
                this.fileSymbolsCache.size +
                this.dependentsCache.size +
                this.existenceCache.size +
                this.symbolLookupCache.size +
                this.symbolLocationCache.size +
                this.symbolIdCache.size
        };
    }

    /**
     * Reset cache statistics.
     */
    resetStats(): void {
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0
        };
    }

    /**
     * Return a cached value if available, otherwise fetch, cache, and return it.
     * Handles cache-enabled checks, hit/miss tracking, and storage in one place.
     * @private
     */
    private async getOrFetch<T>(cache: Map<string, CacheEntry<T>>, key: string, fetcher: () => Promise<T>): Promise<T> {
        if (!this.config.enabled) {
            return fetcher();
        }

        const cached = this.getCached(cache, key);
        if (cached !== null) {
            this.stats.hits++;
            return cached;
        }

        this.stats.misses++;
        const result = await fetcher();
        if (
            cache === this.occurrenceCache &&
            this.occurrenceCachePolicy.shouldCacheOccurrences(result as Array<SymbolOccurrence>)
        ) {
            return result;
        }
        this.setCached(cache, key, result);
        return result;
    }

    private getOrFetchOccurrence(
        key: string,
        fetcher: () => Promise<Array<SymbolOccurrence>>
    ): Promise<Array<SymbolOccurrence>> {
        return this.getOrFetch(this.occurrenceCache, key, fetcher);
    }

    /**
     * Get a cached value if it exists and hasn't expired.
     * @private
     */
    private getCached<T>(cache: Map<string, CacheEntry<T>>, key: string, promoteOnHit = true): T | null {
        const entry = cache.get(key);
        if (!entry) {
            return null;
        }

        const age = Date.now() - entry.timestamp;
        if (age > this.config.ttlMs) {
            cache.delete(key);
            // Keep primed status and reverse index in sync: a re-fetched (raw) entry is no longer deduped.
            if (cache === this.occurrenceCache) {
                this.removeOccurrenceIndexEntries(key);
            }
            return null;
        }

        if (promoteOnHit) {
            this.promoteCacheEntry(cache, key, entry);
        }

        return entry.value;
    }

    /**
     * Store a value in the cache while respecting the configured capacity.
     * @private
     */
    private setCached<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
        if (this.config.maxSize <= 0) {
            this.stats.evictions++;
            return;
        }

        // Evict least-recently-used entry if cache is full (Map preserves insertion order;
        // `getCached` promotes entries on hit by deleting + re-inserting them).
        if (cache.size >= this.config.maxSize) {
            const firstKey = cache.keys().next().value as string | undefined;
            if (firstKey !== undefined) {
                cache.delete(firstKey);
                this.stats.evictions++;
                // Clear primed status and reverse index for the evicted occurrence
                // entry so a future re-fetch goes through deduplication before being
                // re-primed.
                if (cache === this.occurrenceCache) {
                    this.removeOccurrenceIndexEntries(firstKey);
                }
            }
        }

        cache.set(key, {
            value,
            timestamp: Date.now()
        });

        // Populate the reverse index so invalidateFile can locate affected entries
        // in O(k) instead of scanning all occurrence cache values.
        if (cache === this.occurrenceCache && Array.isArray(value)) {
            this.addOccurrenceIndexEntries(key, value as Array<SymbolOccurrence>);
        }
    }

    private promoteCacheEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, entry: CacheEntry<T>): void {
        cache.delete(key);
        cache.set(key, entry);
    }

    /**
     * Remove an occurrence cache entry and its associated primed status.
     * Does **not** update the reverse index ({@link occurrenceFileIndex}) —
     * callers are responsible for cleaning up index entries.
     * {@link invalidateFile} handles this by deleting the filePath's index
     * set after iterating its affected keys.
     * @private
     */
    private removeOccurrenceCacheEntry(key: string): void {
        this.occurrenceCache.delete(key);
        this.primedOccurrenceKeys.delete(key);
    }

    /**
     * Populate the reverse index for the given occurrence cache key.
     * Extracts distinct file paths from the occurrence array and records
     * the cache key under each path so {@link invalidateFile} can find it.
     * @private
     */
    private addOccurrenceIndexEntries(cacheKey: string, occurrences: ReadonlyArray<SymbolOccurrence>): void {
        for (const occurrence of occurrences) {
            if (occurrence.path === undefined) {
                continue;
            }
            let keys = this.occurrenceFileIndex.get(occurrence.path);
            if (!keys) {
                keys = new Set();
                this.occurrenceFileIndex.set(occurrence.path, keys);
            }
            keys.add(cacheKey);
        }
    }

    /**
     * Remove a cache key from the primed set and from every reverse-index entry
     * that references it.  Called on eviction, TTL expiry, and explicit invalidation.
     * @private
     */
    private removeOccurrenceIndexEntries(cacheKey: string): void {
        this.primedOccurrenceKeys.delete(cacheKey);
        const entry = this.occurrenceCache.get(cacheKey);
        if (!entry) {
            return;
        }
        for (const occurrence of entry.value) {
            if (occurrence.path === undefined) {
                continue;
            }
            const keys = this.occurrenceFileIndex.get(occurrence.path);
            if (keys) {
                keys.delete(cacheKey);
                if (keys.size === 0) {
                    this.occurrenceFileIndex.delete(occurrence.path);
                }
            }
        }
    }

    /**
     * Fetch symbol occurrences from the semantic analyzer.
     * @private
     */
    private fetchSymbolOccurrences(symbolName: string, symbolId: string | null): Promise<Array<SymbolOccurrence>> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "getSymbolOccurrences")) {
            return Promise.resolve<Array<SymbolOccurrence>>([]);
        }

        return Promise.resolve(this.semantic.getSymbolOccurrences(symbolName, symbolId));
    }

    /**
     * Fetch file symbols from the semantic analyzer.
     * @private
     */
    private async fetchFileSymbols(filePath: string): Promise<Array<FileSymbol>> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "getFileSymbols")) {
            return [];
        }
        return (await this.semantic.getFileSymbols(filePath)) ?? [];
    }

    /**
     * Fetch dependents from the semantic analyzer.
     * @private
     */
    private async fetchDependents(symbolIds: Array<string>): Promise<Array<DependentSymbol>> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "getDependents")) {
            return [];
        }
        return (await this.semantic.getDependents(symbolIds)) ?? [];
    }

    /**
     * Check symbol existence via the semantic analyzer.
     * @private
     */
    private fetchHasSymbol(symbolId: string): Promise<boolean> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "hasSymbol")) {
            return Promise.resolve(true);
        }
        return Promise.resolve(this.semantic.hasSymbol(symbolId));
    }

    /**
     * Fetch symbol lookup result from the semantic analyzer.
     * @private
     */
    private fetchLookup(name: string, scopeId?: string): Promise<SymbolLookupResult | null> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "lookup")) {
            return Promise.resolve<SymbolLookupResult | null>(null);
        }
        return Promise.resolve(this.semantic.lookup(name, scopeId) ?? null);
    }

    /**
     * Fetch symbol location from the semantic analyzer.
     * @private
     */
    private async fetchSymbolAtPosition(filePath: string, offset: number): Promise<SymbolLocation | null> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "getSymbolAtPosition")) {
            return null;
        }
        return (await this.semantic.getSymbolAtPosition(filePath, offset)) ?? null;
    }

    /**
     * Fetch resolved symbol ID from the semantic analyzer.
     * @private
     */
    private fetchResolveSymbolId(identifierName: string): Promise<string | null> {
        if (!this.semantic || !Core.hasMethods(this.semantic, "resolveSymbolId")) {
            return Promise.resolve<string | null>(null);
        }
        return Promise.resolve(this.semantic.resolveSymbolId(identifierName) ?? null);
    }
}
