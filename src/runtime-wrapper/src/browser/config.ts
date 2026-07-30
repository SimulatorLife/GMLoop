import { DEFAULT_WEBSOCKET_URL } from "./websocket/client.js";

export type LiveReloadLogLevel = "quiet" | "normal" | "debug";

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
