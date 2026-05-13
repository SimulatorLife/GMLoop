export type LiveReloadLogLevel = "quiet" | "normal" | "debug";

export interface LiveReloadBootstrapConfig {
    websocketUrl: string;
    statusUrl?: string;
    logLevel?: LiveReloadLogLevel;
}

// The CLI overwrites the copied browser config asset with the deployment-specific
// runtime values before injecting the browser bootstrap entry.
export const liveReloadBootstrapConfig: LiveReloadBootstrapConfig = Object.freeze({
    websocketUrl: "ws://127.0.0.1:17890",
    logLevel: "normal"
});
