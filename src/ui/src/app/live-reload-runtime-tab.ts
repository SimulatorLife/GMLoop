import type { GraphVisualizationLiveReloadModel } from "../graph/types.js";

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
 * Navigate a reserved runtime tab to the given URL and focus it.
 */
export function navigateLiveReloadRuntimeTab(runtimeTab: LiveReloadRuntimeTab, runtimeUrl: string): void {
    runtimeTab.location.href = runtimeUrl;
    runtimeTab.focus();
}

/**
 * Open a tab named `LIVE_RELOAD_RUNTIME_TAB_TARGET` at the given URL.
 * When a custom `openRuntimeTab` is provided (e.g. in tests), that function
 * is used directly; the `globalThis.frames` check is skipped so tests can
 * mock the opener without the production frame-reuse logic interfering.
 */
export function reserveLiveReloadRuntimeTab(
    openRuntimeTab: ((url: string, target: string) => LiveReloadRuntimeTab | null) | null = typeof globalThis.open ===
    "function"
        ? globalThis.open.bind(globalThis)
        : null
): LiveReloadRuntimeTab | null {
    if (openRuntimeTab === null) {
        return null;
    }

    try {
        const runtimeTab = openRuntimeTab("", LIVE_RELOAD_RUNTIME_TAB_TARGET);
        runtimeTab?.focus();
        return runtimeTab;
    } catch {
        return null;
    }
}

/**
 * Open the runtime URL in a tab named `LIVE_RELOAD_RUNTIME_TAB_TARGET`.
 */
export function openLiveReloadRuntimeTab(
    runtimeUrl: string | null,
    openRuntimeTab: ((url: string, target: string) => LiveReloadRuntimeTab | null) | null = typeof globalThis.open ===
    "function"
        ? globalThis.open.bind(globalThis)
        : null
): void {
    if (runtimeUrl === null || runtimeUrl.trim().length === 0) {
        return;
    }

    try {
        if (openRuntimeTab !== null) {
            openRuntimeTab(runtimeUrl, LIVE_RELOAD_RUNTIME_TAB_TARGET)?.focus();
        }
    } catch {
        // Popup blockers should not turn a successful live-reload start into a UI failure.
    }
}
