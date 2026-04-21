/**
 * Default number of in-memory snapshots retained for `format --on-parse-error=revert`.
 *
 * This limits fallback snapshot memory when disk snapshot writes fail.
 */
export const DEFAULT_MAX_IN_MEMORY_SNAPSHOTS = 50;

/**
 * Environment variable that tunes the in-memory snapshot cap for format reverts.
 */
export const MAX_IN_MEMORY_SNAPSHOTS_ENV_VAR = "PRETTIER_PLUGIN_GML_MAX_IN_MEMORY_SNAPSHOTS";

/**
 * Number of processed files between periodic memory cleanups during formatting.
 */
export const PERIODIC_CLEANUP_INTERVAL = 10;

/**
 * Number of formatting-cache entries retained after periodic cleanup.
 */
export const PERIODIC_CLEANUP_CACHE_RETAINED_ENTRIES = 5;
