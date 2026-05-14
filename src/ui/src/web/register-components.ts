import {
    GmAppHeader,
    GmAppShell,
    GmBadge,
    GmButton,
    GmCard,
    GmConfigPanel,
    GmDocsPanel,
    GmGraphPanel,
    GmGraphToolbar,
    GmLiveReloadPanel,
    GmMcpPanel,
    GmPlaygroundPanel
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
    defineCustomElementOnce("gm-app-header", GmAppHeader);
    defineCustomElementOnce("gm-graph-toolbar", GmGraphToolbar);
    defineCustomElementOnce("gm-graph-panel", GmGraphPanel);
    defineCustomElementOnce("gm-live-reload-panel", GmLiveReloadPanel);
    defineCustomElementOnce("gm-playground-panel", GmPlaygroundPanel);
    defineCustomElementOnce("gm-docs-panel", GmDocsPanel);
    defineCustomElementOnce("gm-config-panel", GmConfigPanel);
    defineCustomElementOnce("gm-mcp-panel", GmMcpPanel);
    defineCustomElementOnce("gm-app-shell", GmAppShell);
}
