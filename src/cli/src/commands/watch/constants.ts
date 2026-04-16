/**
 * Default polling interval (milliseconds) used by the watch command.
 */
export const DEFAULT_WATCH_POLLING_INTERVAL_MS = 1000;

/**
 * Default debounce delay (milliseconds) for coalescing rapid file change events.
 */
export const DEFAULT_WATCH_DEBOUNCE_DELAY_MS = 100;

/**
 * Default max concurrent directory scan workers during startup and unknown-event scans.
 */
export const DEFAULT_WATCH_MAX_CONCURRENT_DIRS = 4;

/**
 * Default max in-memory patch history retained by the watch command.
 */
export const DEFAULT_WATCH_MAX_PATCH_HISTORY = 100;

/**
 * Number of attempts used when retrying transient empty-file reads.
 *
 * Editors that use truncate-then-write save behavior can briefly expose a file
 * as empty even though content arrives a few milliseconds later.
 */
export const DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT = 4;

/**
 * Delay (milliseconds) between transient empty-file read attempts.
 */
export const DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS = 25;
