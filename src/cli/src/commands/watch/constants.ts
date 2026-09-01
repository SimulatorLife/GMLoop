import { Core } from "@gmloop/core";

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
 * Generated or dependency-managed directories that should never participate in
 * live-reload source discovery.
 *
 * These paths do not represent author-owned game source and create noisy,
 * misleading patch streams when watched recursively.
 */
export const DEFAULT_WATCH_IGNORED_DIRECTORY_NAMES = Core.DEFAULT_PROJECT_EXCLUDES.directoryNames;

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

/**
 * Watch mode intentionally tracks only GameMaker source files and room metadata.
 *
 * `.gml` drives transpilation/hot reload, while `.yy` room metadata keeps room
 * macro hydration current. This is an internal command default rather than a
 * user-facing extension knob; GameMaker does not support arbitrary source
 * suffixes, and accepting them would create misleading watch behavior.
 */
export const WATCHED_GAME_MAKER_EXTENSIONS = [".gml", ".yy"] as const;

/** File extension for GameMaker Language sources consumed by watch mode. */
export const WATCHED_GML_EXTENSION = ".gml";

/** File extension for GameMaker resource metadata consumed by watch mode. */
export const WATCHED_YY_EXTENSION = ".yy";
