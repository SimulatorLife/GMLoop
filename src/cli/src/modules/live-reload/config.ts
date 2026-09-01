import path from "node:path";

import type { LiveReloadLogLevel as RuntimeLiveReloadLogLevel } from "@gmloop/runtime-wrapper";

/**
 * Canonical live-reload bootstrap log level. Defined and centralised inside
 * `@gmloop/runtime-wrapper` so the bootstrap config rendered by the CLI and the
 * browser-side dispatcher that consumes it cannot drift out of sync. Re-exported
 * here so internal CLI callers keep importing from the live-reload module.
 */
export type LiveReloadLogLevel = RuntimeLiveReloadLogLevel;

export const DEFAULT_GM_TEMP_ROOT = "/private/tmp/GameMakerStudio2/GMS2TEMP";
export const DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST = "127.0.0.1";
export const DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT = 17_890;
export const DEFAULT_LIVE_RELOAD_STATUS_HOST = "127.0.0.1";
export const DEFAULT_LIVE_RELOAD_STATUS_PORT = 17_891;

/**
 * Default total wait time (milliseconds) for the `live-reload wait-for-patch`
 * subcommand before it gives up and reports a structured timeout error.
 *
 * The same value is used by both the CLI option default (so `--help` and
 * un-flagged invocations agree) and the runtime fallback that applies when
 * the command is invoked programmatically with an undefined `timeoutMs`.
 * Centralising the number here keeps the CLI surface and the in-process
 * handler in lock-step so tests and downstream tooling have a single source
 * of truth to import.
 */
export const DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS = 10_000;

/**
 * Default polling interval (milliseconds) between status-server checks while
 * the `live-reload wait-for-patch` subcommand is waiting for a new patch.
 *
 * Mirrors {@link DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS}: the value is
 * shared between the Commander `--poll-interval-ms` default and the runtime
 * fallback inside `runLiveReloadWaitForPatchCommand`. Keep them aligned so
 * the CLI never advertises a different polling cadence than it actually
 * uses when invoked from `runCliTestCommand` and similar entry points.
 */
export const DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS = 250;

/**
 * Default time (milliseconds) `live-reload session` waits for a newly spawned
 * worker to register itself before treating startup as failed.
 */
export const DEFAULT_LIVE_RELOAD_SESSION_STARTUP_TIMEOUT_MS = 600_000;

/**
 * Default time (milliseconds) `live-reload session` waits for a registered
 * worker to exit gracefully (after `SIGTERM`) before reporting a stop
 * failure.
 *
 * Exposed as the `--stop-timeout-ms` option on `live-reload session` because
 * a project's shutdown work (flushing save data, closing native handles,
 * etc.) can legitimately take longer than the built-in default on some
 * machines or projects, and force-restart must only proceed after a graceful
 * shutdown actually completes or is confirmed to have timed out.
 */
export const DEFAULT_LIVE_RELOAD_SESSION_STOP_TIMEOUT_MS = 5000;

/**
 * Polling cadence (milliseconds) used while `live-reload session` waits for
 * worker startup or shutdown to be reflected in the session registry.
 */
export const DEFAULT_LIVE_RELOAD_SESSION_POLL_INTERVAL_MS = 100;

/**
 * Grace period (milliseconds) during which a freshly created session lock
 * file is treated as active even if it has not yet had its owning process id
 * written to it, avoiding a race where a second `live-reload session`
 * invocation deletes a lock that is still being initialized.
 */
export const DEFAULT_LIVE_RELOAD_SESSION_LOCK_INITIALIZATION_GRACE_MS = 1000;

export const HOT_RELOAD_DIR_NAME = ".gml-hot-reload";
export const HOT_RELOAD_MARKER_START = "<!-- gml-hot-reload:start -->";
export const HOT_RELOAD_MARKER_END = "<!-- gml-hot-reload:end -->";
export const RUNTIME_WRAPPER_ASSET_MANIFEST_FILE_NAME = "runtime-wrapper-assets.manifest.json";
export const LIVE_RELOAD_BOOTSTRAP_ENTRY_RELATIVE_PATH = path.posix.join(
    "runtime-wrapper",
    "src",
    "browser",
    "index.js"
);
export const LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH = path.posix.join(
    "runtime-wrapper",
    "src",
    "browser",
    "config.js"
);
export const LIVE_RELOAD_ASSET_ROOT_RELATIVE_PATH = "runtime-wrapper";

/**
 * Canonical output format values accepted by the `live-reload session`
 * subcommand's `--format` option.
 *
 * Exposing these values as a frozen object (instead of inlining the strings in
 * the CLI option definition, the runtime branch, and any future tests) makes
 * the valid set easy to enumerate, share, and evolve without touching call
 * sites that compare against the canonical values.
 */
export const LIVE_RELOAD_SESSION_OUTPUT_FORMATS = Object.freeze({
    json: "json",
    pretty: "pretty"
} as const);

/**
 * Union type covering every valid `live-reload session --format` value.
 */
export type LiveReloadSessionOutputFormat =
    (typeof LIVE_RELOAD_SESSION_OUTPUT_FORMATS)[keyof typeof LIVE_RELOAD_SESSION_OUTPUT_FORMATS];

/**
 * Default value used when the `live-reload session --format` option is not
 * supplied on the command line.
 */
export const DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT: LiveReloadSessionOutputFormat =
    LIVE_RELOAD_SESSION_OUTPUT_FORMATS.json;

/**
 * Render a comma-separated list of every valid `live-reload session --format`
 * value. Used by the validator's error message so the allowed set stays in
 * sync with {@link LIVE_RELOAD_SESSION_OUTPUT_FORMATS}.
 */
function listLiveReloadSessionOutputFormats(): string {
    return Object.values(LIVE_RELOAD_SESSION_OUTPUT_FORMATS).join(", ");
}

/**
 * Coerce an arbitrary CLI-supplied value into a
 * {@link LiveReloadSessionOutputFormat}.
 *
 * Throws an `Error` with a descriptive message when the value is not a string
 * or is a string that does not match one of the canonical format values. The
 * CLI layer wraps this function with `wrapInvalidArgumentResolver` so the
 * resulting error becomes a Commander `InvalidArgumentError`, while tests and
 * any other consumers can invoke the raw function directly.
 *
 * @param {unknown} value Raw value supplied by Commander (or a test).
 * @returns {LiveReloadSessionOutputFormat} The canonical format string.
 */
export function coerceLiveReloadSessionOutputFormat(value: unknown): LiveReloadSessionOutputFormat {
    if (typeof value !== "string") {
        throw new TypeError(
            `Invalid --format value: expected a string, received ${value === null ? "null" : typeof value}.`
        );
    }

    const candidate = value.trim();
    if (
        candidate === LIVE_RELOAD_SESSION_OUTPUT_FORMATS.json ||
        candidate === LIVE_RELOAD_SESSION_OUTPUT_FORMATS.pretty
    ) {
        return candidate;
    }

    throw new Error(`Invalid --format value: "${value}". Allowed values: ${listLiveReloadSessionOutputFormats()}.`);
}

export interface LiveReloadTarget {
    outputRoot: string;
    indexHtmlPath: string;
}

export interface LiveReloadBootstrapConfig {
    websocketUrl: string;
    statusUrl?: string;
    logLevel?: LiveReloadLogLevel;
}

export interface LiveReloadAssetSyncResult {
    targetRoot: string;
    copiedAssets: boolean;
    manifestPath: string;
    bootstrapEntryPath: string;
}

export function createWebSocketUrl(
    host = DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST,
    port = DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT
): string {
    return `ws://${host}:${String(port)}`;
}

export function createStatusUrl(
    host = DEFAULT_LIVE_RELOAD_STATUS_HOST,
    port = DEFAULT_LIVE_RELOAD_STATUS_PORT
): string {
    return `http://${host}:${String(port)}/status`;
}

export function resolveLiveReloadAssetRoot(outputRoot: string): string {
    return path.join(outputRoot, HOT_RELOAD_DIR_NAME);
}

export function resolveLiveReloadBootstrapScriptPath(outputRoot: string): string {
    return path.join(resolveLiveReloadAssetRoot(outputRoot), LIVE_RELOAD_BOOTSTRAP_ENTRY_RELATIVE_PATH);
}

export function resolveLiveReloadBootstrapScriptSrc(): string {
    return `./${HOT_RELOAD_DIR_NAME}/${LIVE_RELOAD_BOOTSTRAP_ENTRY_RELATIVE_PATH}`;
}
