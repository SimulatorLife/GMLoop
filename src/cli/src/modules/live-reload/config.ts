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
export const LIVE_RELOAD_BOOTSTRAP_ENTRY_RELATIVE_PATH = path.posix.join("runtime-wrapper", "browser", "index.js");
export const LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH = path.posix.join("runtime-wrapper", "browser", "config.js");
export const LIVE_RELOAD_ASSET_ROOT_RELATIVE_PATH = "runtime-wrapper";

export type LiveReloadLogLevel = "quiet" | "normal" | "debug";

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
