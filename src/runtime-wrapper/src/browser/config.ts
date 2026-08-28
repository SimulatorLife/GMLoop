import { type LiveReloadLogLevel } from "./log-levels.js";
import { DEFAULT_WEBSOCKET_URL } from "./websocket/client.js";

export type { LiveReloadLogLevel } from "./log-levels.js";

/**
 * Re-export every public symbol from {@link ./log-levels.ts} so consumers can
 * continue to import the level machinery from the existing
 * `liveReloadBootstrapConfig` surface without reaching into a new module.
 */
export {
    coerceLiveReloadLogLevel,
    isLiveReloadLogLevel,
    LIVE_RELOAD_LOG_LEVEL_VALUES,
    LIVE_RELOAD_LOG_LEVELS,
    parseLiveReloadLogLevel
} from "./log-levels.js";

export interface LiveReloadBootstrapConfig {
    websocketUrl: string;
    statusUrl?: string;
    logLevel?: LiveReloadLogLevel;
}

// The CLI overwrites the copied browser config asset with the deployment-specific
// runtime values before injecting the browser bootstrap entry.
export const liveReloadBootstrapConfig: LiveReloadBootstrapConfig = Object.freeze({
    websocketUrl: DEFAULT_WEBSOCKET_URL,
    logLevel: "normal"
});
