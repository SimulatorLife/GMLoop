import { GmAppHeader } from "../app/components/gm-app-header.js";
import { GmAppShell } from "../app/components/gm-app-shell.js";
import { GmGraphPanel } from "../app/components/gm-graph-panel.js";
import { GmGraphToolbar } from "../app/components/gm-graph-toolbar.js";
import { GmBadge } from "../app/components/primitives/gm-badge.js";
import { GmButton } from "../app/components/primitives/gm-button.js";
import { GmCard } from "../app/components/primitives/gm-card.js";
import { GmCopyButton } from "../app/components/primitives/gm-copy-button.js";
import { GmErrorBanner } from "../app/components/primitives/gm-error-banner.js";
import { GmStatusChip } from "../app/components/primitives/gm-status-chip.js";

function defineCustomElementOnce(name: string, constructorValue: CustomElementConstructor): void {
    if (!customElements.get(name)) {
        customElements.define(name, constructorValue);
    }
}

async function registerDeferredGraphVisualizationCustomElements(): Promise<void> {
    const [
        { GmAutoGamePanel },
        { GmConfigPanel },
        { GmDocsPanel },
        { GmFixPanel },
        { GmLiveReloadPanel },
        { GmPlaygroundPanel },
        { GmJsonViewer }
    ] = await Promise.all([
        import("../app/components/gm-auto-game-panel.js"),
        import("../app/components/gm-config-panel.js"),
        import("../app/components/gm-docs-panel.js"),
        import("../app/components/gm-fix-panel.js"),
        import("../app/components/gm-live-reload-panel.js"),
        import("../app/components/gm-playground-panel.js"),
        import("../app/components/primitives/gm-json-viewer.js")
    ]);

    defineCustomElementOnce("gm-json-viewer", GmJsonViewer);
    defineCustomElementOnce("gm-live-reload-panel", GmLiveReloadPanel);
    defineCustomElementOnce("gm-playground-panel", GmPlaygroundPanel);
    defineCustomElementOnce("gm-docs-panel", GmDocsPanel);
    defineCustomElementOnce("gm-fix-panel", GmFixPanel);
    defineCustomElementOnce("gm-config-panel", GmConfigPanel);
    defineCustomElementOnce("gm-auto-game-panel", GmAutoGamePanel);
}

/**
 * Register the graph visualization shell and startup-critical custom elements.
 *
 * Inactive page surfaces are loaded asynchronously so their modules do not
 * inflate the startup chunk or delay the initial Graph Index render.
 */
export function registerGraphVisualizationCustomElements(): void {
    defineCustomElementOnce("gm-button", GmButton);
    defineCustomElementOnce("gm-card", GmCard);
    defineCustomElementOnce("gm-badge", GmBadge);
    defineCustomElementOnce("gm-copy-button", GmCopyButton);
    defineCustomElementOnce("gm-error-banner", GmErrorBanner);
    defineCustomElementOnce("gm-status-chip", GmStatusChip);
    defineCustomElementOnce("gm-app-header", GmAppHeader);
    defineCustomElementOnce("gm-page-toolbar", GmGraphToolbar);
    defineCustomElementOnce("gm-graph-panel", GmGraphPanel);
    defineCustomElementOnce("gm-app-shell", GmAppShell);

    void registerDeferredGraphVisualizationCustomElements().catch((error: unknown) => {
        console.error("Failed to load deferred graph visualization UI components:", error);
    });
}
