/**
 * Shared baseline defaults for project-index related settings.
 *
 * This module exists to keep option metadata consumers decoupled from
 * project-index runtime implementations (cache/concurrency state machines).
 */
export const PROJECT_INDEX_CACHE_MAX_SIZE_BASELINE = 8 * 1024 * 1024; // 8 MiB
export const PROJECT_INDEX_GML_CONCURRENCY_BASELINE = 4;
export const PROJECT_INDEX_GML_MAX_CONCURRENCY_BASELINE = 16;
