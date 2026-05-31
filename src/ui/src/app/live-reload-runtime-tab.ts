import type { GraphVisualizationLiveReloadModel } from "../graph/types.js";

/**
 * Stable browser target used for the GameMaker runtime page opened by Live Reload.
 */
export const LIVE_RELOAD_RUNTIME_TAB_TARGET = "gmloop-live-reload-runtime";

/**
 * Resolve the browser-openable GameMaker runtime URL from a live-reload model.
 */
export function resolveLiveReloadRuntimeUrl(liveReload: GraphVisualizationLiveReloadModel | null): string | null {
    const runtimeUrl = liveReload?.endpoints.runtimeUrl ?? null;
    if (runtimeUrl === null || runtimeUrl.trim().length === 0) {
        return null;
    }

    return runtimeUrl;
}
