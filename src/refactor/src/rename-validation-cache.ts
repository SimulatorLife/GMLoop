/**
 * Rename validation cache for the refactor engine.
 * Caches validation results to optimize interactive rename workflows where
 * the same symbol-to-name combinations are validated repeatedly (e.g., as
 * users type new names in IDE rename dialogs).
 *
 * ## Policy and Mechanism Separation
 *
 * The cache delegates all policy decisions to a pluggable {@link ValidationCachePolicy}.
 * This separation allows the eviction strategy, TTL rules, and enablement logic to be:
 *
 * - Unit-tested in isolation without constructing full cache instances
 * - Swapped with alternative policies without modifying the cache implementation
 * - Documented and reasoned about independently from storage mechanics
 */

import type { HotReloadSafetySummary, ValidationSummary } from "./types.js";

/**
 * Policy interface for the rename validation cache.
 *
 * Encapsulates all policy decisions: eviction strategy, TTL handling, and enablement.
 * Implementations can provide custom policies for testing or alternative caching strategies.
 */
export interface ValidationCachePolicy {
    /**
     * Whether caching is enabled globally.
     */
    readonly enabled: boolean;

    /**
     * Maximum number of entries the cache may hold.
     */
    readonly maxSize: number;

    /**
     * Time-to-live for cache entries in milliseconds.
     */
    readonly ttlMs: number;

    /**
     * Return `true` when the given entry age (in ms) indicates the entry has expired.
     *
     * @param entryAgeMs - Age of the cache entry in milliseconds
     */
    isExpired(entryAgeMs: number): boolean;

    /**
     * Return `true` when a newly computed result should be stored in the cache.
     *
     * @param currentSize - Current number of entries in the cache
     */
    shouldStore(currentSize: number): boolean;

    /**
     * Return `true` when the cache should evict entries before storing a new one.
     *
     * @param currentSize - Current number of entries in the cache
     */
    shouldEvict(currentSize: number): boolean;
}

/**
 * Default validation cache policy implementing LRU eviction with TTL expiry.
 *
 * This policy uses a simple LRU approach: when the cache exceeds maxSize,
 * the oldest entry (earliest insertion order) is removed. Entries older than
 * ttlMs are considered stale and evicted on access.
 */
export class DefaultValidationCachePolicy implements ValidationCachePolicy {
    public readonly enabled: boolean;
    public readonly maxSize: number;
    public readonly ttlMs: number;

    constructor(enabled = true, maxSize = 50, ttlMs = 30_000) {
        this.enabled = enabled;
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
    }

    isExpired(entryAgeMs: number): boolean {
        return entryAgeMs >= this.ttlMs;
    }

    shouldStore(_currentSize: number): boolean {
        return this.enabled && this.maxSize > 0;
    }

    shouldEvict(currentSize: number): boolean {
        return this.enabled && this.maxSize > 0 && currentSize >= this.maxSize;
    }
}

/**
 * Policy that disables all caching — useful in tests or when caching is
 * explicitly not desired.
 */
export class DisabledValidationCachePolicy implements ValidationCachePolicy {
    public readonly enabled = false;
    public readonly maxSize = 0;
    public readonly ttlMs = 0;

    isExpired(_entryAgeMs: number): boolean {
        return true;
    }

    shouldStore(_currentSize: number): boolean {
        return false;
    }

    shouldEvict(_currentSize: number): boolean {
        return false;
    }
}

/**
 * Configuration for the rename validation cache.
 */
export interface RenameValidationCacheConfig {
    /**
     * Maximum number of cached validation results.
     * When exceeded, the least-recently-used entry is evicted.
     * @default 50
     */
    maxSize?: number;

    /**
     * Time-to-live for cache entries in milliseconds.
     * Entries older than this are considered stale and evicted.
     * @default 30000 (30 seconds)
     */
    ttlMs?: number;

    /**
     * Enable or disable caching globally.
     * @default true
     */
    enabled?: boolean;

    /**
     * Custom policy for cache behavior.
     * When provided, takes precedence over maxSize, ttlMs, and enabled options.
     */
    policy?: ValidationCachePolicy;
}

/**
 * Extended validation summary that includes hot reload metadata.
 */
export interface CachedValidationResult extends ValidationSummary {
    symbolName?: string;
    occurrenceCount?: number;
    hotReload?: HotReloadSafetySummary;
}

/**
 * Cache entry metadata.
 */
interface CacheEntry {
    result: CachedValidationResult;
    timestamp: number;
}

/**
 * Performance statistics for the cache.
 */
export interface ValidationCacheStats {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
}

/**
 * Cache for rename validation results.
 *
 * During interactive rename sessions (e.g., IDE rename dialogs), the same
 * symbol-to-name combination is often validated repeatedly as users type.
 * This cache reduces redundant semantic queries and conflict detection,
 * providing faster feedback for IDE integrations.
 *
 * @example
 * ```typescript
 * const cache = new RenameValidationCache({ maxSize: 50, ttlMs: 30000 });
 *
 * // First call: performs full validation
 * const result1 = await cache.getOrCompute(
 *   "gml/script/scr_player",
 *   "scr_hero",
 *   async () => engine.validateRenameRequest({ symbolId: "gml/script/scr_player", newName: "scr_hero" })
 * );
 *
 * // Second call within TTL: returns cached result (no validation)
 * const result2 = await cache.getOrCompute(
 *   "gml/script/scr_player",
 *   "scr_hero",
 *   async () => engine.validateRenameRequest({ symbolId: "gml/script/scr_player", newName: "scr_hero" })
 * );
 *
 * // Clear cache when source files change
 * cache.invalidateAll();
 * ```
 */
export class RenameValidationCache {
    private readonly cache: Map<string, CacheEntry>;
    private readonly inFlight: Map<string, Promise<CachedValidationResult>>;
    private readonly policy: ValidationCachePolicy;
    private hits = 0;
    private misses = 0;
    private evictions = 0;

    constructor(config: RenameValidationCacheConfig = {}) {
        this.cache = new Map();
        this.inFlight = new Map();

        const customPolicy = config.policy;
        const hasCustomPolicy = customPolicy !== undefined;
        if (hasCustomPolicy) {
            this.policy = customPolicy;
        } else {
            const enabled = config.enabled ?? true;
            const maxSize = config.maxSize ?? 50;
            const ttlMs = config.ttlMs ?? 30_000;
            this.policy = new DefaultValidationCachePolicy(enabled, maxSize, ttlMs);
        }
    }

    /**
     * Get or compute a validation result.
     * If a valid cached result exists, return it immediately and promote it so
     * frequently-used validations stay resident. Otherwise, compute the result
     * and cache it using least-recently-used eviction.
     *
     * @param symbolId - Symbol being renamed
     * @param newName - Proposed new name
     * @param compute - Function to compute validation if not cached
     * @returns Cached or computed validation result
     */
    async getOrCompute(
        symbolId: string,
        newName: string,
        compute: () => Promise<CachedValidationResult>
    ): Promise<CachedValidationResult> {
        if (!this.policy.enabled) {
            return compute();
        }

        const key = `${symbolId}::${newName}`;
        const cached = this.cache.get(key);

        if (cached) {
            const entryAgeMs = Date.now() - cached.timestamp;
            if (this.policy.isExpired(entryAgeMs)) {
                // Entry expired – evict it
                if (this.cache.delete(key)) {
                    this.evictions++;
                }
            } else {
                this.hits++;
                this.promoteCachedEntry(key, cached);
                return cached.result;
            }
        }

        const inFlightValidation = this.inFlight.get(key);
        if (inFlightValidation !== undefined) {
            this.hits++;
            return inFlightValidation;
        }

        this.misses++;

        const validationPromise = (async (): Promise<CachedValidationResult> => {
            const result = await compute();

            if (this.policy.shouldStore(this.cache.size)) {
                // Evict the least-recently-used entry before adding the new one
                if (this.policy.shouldEvict(this.cache.size)) {
                    const oldestKey = this.cache.keys().next().value as string | undefined;
                    if (oldestKey !== undefined) {
                        this.cache.delete(oldestKey);
                        this.evictions++;
                    }
                }
                this.cache.set(key, { result, timestamp: Date.now() });
            } else {
                // Policy says don't store – count as an immediate eviction
                this.evictions++;
            }

            return result;
        })();

        this.inFlight.set(key, validationPromise);

        try {
            return await validationPromise;
        } finally {
            this.inFlight.delete(key);
        }
    }

    private promoteCachedEntry(key: string, entry: CacheEntry): void {
        this.cache.delete(key);
        this.cache.set(key, entry);
    }

    /**
     * Read a fresh cached validation result without affecting hit/miss counters.
     *
     * This is used by internal planning paths that can safely reuse a validation
     * computed earlier in the same refactor session without treating the lookup as
     * a user-visible cache hit.
     */
    peek(symbolId: string, newName: string): CachedValidationResult | null {
        if (!this.policy.enabled) {
            return null;
        }

        const key = `${symbolId}::${newName}`;
        const cached = this.cache.get(key);
        if (cached) {
            const entryAgeMs = Date.now() - cached.timestamp;
            if (this.policy.isExpired(entryAgeMs)) {
                this.cache.delete(key);
                this.evictions++;
                return null;
            }
            return cached.result;
        }

        return null;
    }

    /**
     * Invalidate cached validation for a specific symbol-name pair.
     *
     * @param symbolId - Symbol being renamed
     * @param newName - Proposed new name
     */
    invalidate(symbolId: string, newName: string): void {
        const key = `${symbolId}::${newName}`;
        this.cache.delete(key);
        this.inFlight.delete(key);
    }

    /**
     * Invalidate all cached validation results for a specific symbol.
     * Useful when a symbol's definition or dependencies change.
     *
     * @param symbolId - Symbol whose validation results should be cleared
     */
    invalidateSymbol(symbolId: string): void {
        const prefix = `${symbolId}::`;
        const keysToDelete = [...this.cache.keys()].filter((k) => k.startsWith(prefix));
        for (const key of keysToDelete) {
            this.cache.delete(key);
            this.inFlight.delete(key);
        }
    }

    /**
     * Clear all cached validation results.
     * Should be called when source files change to prevent stale results.
     */
    invalidateAll(): void {
        this.cache.clear();
        this.inFlight.clear();
    }

    /**
     * Get cache performance statistics.
     *
     * @returns Current cache statistics
     */
    getStats(): Readonly<ValidationCacheStats> {
        return Object.freeze({
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            size: this.cache.size
        });
    }

    /**
     * Reset cache performance counters.
     */
    resetStats(): void {
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }
}
