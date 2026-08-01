import type { GraphVisualizationLiveReloadModel } from "../graph/index.js";

/**
 * Stable browser target used for the GameMaker runtime page opened by Live Reload.
 */
export const LIVE_RELOAD_RUNTIME_TAB_TARGET = "gmloop-live-reload-runtime";

export type LiveReloadRuntimeTab = Readonly<{
    close: () => void;
    focus: () => void;
    location: {
        href: string;
    };
}>;

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

/**
 * Open the runtime URL in a tab named `LIVE_RELOAD_RUNTIME_TAB_TARGET`.
 * The caller must invoke this only after the host has finished build/startup
 * sequencing and returned a concrete runtime URL; opening an empty placeholder
 * tab regresses the Live Reload flow back to visible `about:blank` windows.
 */
export function openLiveReloadRuntimeTab(
    runtimeUrl: string,
    openRuntimeTab: ((url: string, target: string) => LiveReloadRuntimeTab | null) | null = typeof globalThis.open ===
    "function"
        ? globalThis.open.bind(globalThis)
        : null
): void {
    try {
        if (openRuntimeTab !== null) {
            openRuntimeTab(runtimeUrl, LIVE_RELOAD_RUNTIME_TAB_TARGET)?.focus();
        }
    } catch {
        // Popup blockers should not turn a successful live-reload start into a UI failure.
    }
}
