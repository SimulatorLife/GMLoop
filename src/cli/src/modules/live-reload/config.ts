import path from "node:path";

export const DEFAULT_GM_TEMP_ROOT = "/private/tmp/GameMakerStudio2/GMS2TEMP";
export const DEFAULT_LIVE_RELOAD_WEBSOCKET_HOST = "127.0.0.1";
export const DEFAULT_LIVE_RELOAD_WEBSOCKET_PORT = 17_890;
export const DEFAULT_LIVE_RELOAD_STATUS_HOST = "127.0.0.1";
export const DEFAULT_LIVE_RELOAD_STATUS_PORT = 17_891;
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

export type LiveReloadLogLevel = "quiet" | "normal" | "debug";

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
