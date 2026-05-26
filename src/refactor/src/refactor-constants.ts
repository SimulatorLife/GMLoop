/**
 * Tunable constants for the refactor engine and related subsystems.
 *
 * These values control performance characteristics, cache sizing, and
 * concurrency limits. They are intentionally separated from the main
 * refactor-engine module so that they can be referenced, overridden, or
 * extended without modifying core logic.
 *
 * Do not add arbitrary configuration here — only values that represent
 * real performance or correctness trade-offs that developers may need to tune.
 */

/**
 * Maximum number of entries in the rename-validation cache.
 * The cache evicts the least-recently-used entry when this limit is reached.
 * Higher values increase memory usage but reduce redundant validation queries
 * during interactive rename sessions (e.g., IDE rename dialogs).
 *
 * @default 4096
 */
export const RENAME_VALIDATION_CACHE_MAX_SIZE = 4096;

/**
 * Maximum number of concurrent I/O operations when applying workspace edits.
 * Higher values improve throughput on fast storage but may saturate file
 * descriptors or disk queues on slower systems.
 *
 * @default 8
 */
export const APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT = 8;

/**
 * Minimum number of file entries to allocate in the codemod read-through cache.
 * The cache size is dynamically sized based on the project file count, but
 * will never fall below this floor to ensure meaningful caching for small projects.
 *
 * @default 256
 */
export const CODEMOD_READ_THROUGH_CACHE_MIN_ENTRIES = 256;

/**
 * Maximum number of file entries in the codemod read-through cache.
 * Caps memory usage for large projects even when many files exist.
 *
 * @default 2048
 */
export const CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES = 2048;

/**
 * Maximum number of edits tracked in the duplicate-detection set for a single
 * workspace edit batch. When the edit count exceeds this threshold, duplicate
 * detection is skipped to avoid O(n²) overhead on very large edit sets.
 * The actual duplicate-check limit is this value squared.
 *
 * @default 1024
 */
export const DUPLICATE_EDIT_CHECK_MAX_SET_SIZE = 1024;
