import {
    GmAppHeader,
    GmAppShell,
    GmAutoGamePanel,
    GmBadge,
    GmButton,
    GmCard,
    GmConfigPanel,
    GmCopyButton,
    GmDocsPanel,
    GmErrorBanner,
    GmFixPanel,
    GmGraphPanel,
    GmGraphToolbar,
    GmLiveReloadPanel,
    GmPlaygroundPanel,
    GmStatusChip
} from "../app/components/index.js";

function defineCustomElementOnce(name: string, constructorValue: CustomElementConstructor): void {
    if (!customElements.get(name)) {
        customElements.define(name, constructorValue);
    }
}

/**
 * Register all graph visualization custom elements.
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
    defineCustomElementOnce("gm-live-reload-panel", GmLiveReloadPanel);
    defineCustomElementOnce("gm-playground-panel", GmPlaygroundPanel);
    defineCustomElementOnce("gm-docs-panel", GmDocsPanel);
    defineCustomElementOnce("gm-fix-panel", GmFixPanel);
    defineCustomElementOnce("gm-config-panel", GmConfigPanel);
    defineCustomElementOnce("gm-auto-game-panel", GmAutoGamePanel);
    defineCustomElementOnce("gm-app-shell", GmAppShell);
}
