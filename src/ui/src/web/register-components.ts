import { GmAppHeader } from "../app/components/gm-app-header.js";
import { GmAppShell } from "../app/components/gm-app-shell.js";
import { GmAutoGamePanel } from "../app/components/gm-auto-game-panel.js";
import { GmConfigPanel } from "../app/components/gm-config-panel.js";
import { GmDocsPanel } from "../app/components/gm-docs-panel.js";
import { GmFixPanel } from "../app/components/gm-fix-panel.js";
import { GmGraphPanel } from "../app/components/gm-graph-panel.js";
import { GmGraphToolbar } from "../app/components/gm-graph-toolbar.js";
import { GmLiveReloadPanel } from "../app/components/gm-live-reload-panel.js";
import { GmPlaygroundPanel } from "../app/components/gm-playground-panel.js";
import { GmBadge } from "../app/components/primitives/gm-badge.js";
import { GmButton } from "../app/components/primitives/gm-button.js";
import { GmCard } from "../app/components/primitives/gm-card.js";
import { GmCollapsible } from "../app/components/primitives/gm-collapsible.js";
import { GmCopyButton } from "../app/components/primitives/gm-copy-button.js";
import { GmErrorBanner } from "../app/components/primitives/gm-error-banner.js";
import { GmJsonViewer } from "../app/components/primitives/gm-json-viewer.js";
import { GmStatusChip } from "../app/components/primitives/gm-status-chip.js";

function defineCustomElementOnce(name: string, constructorValue: CustomElementConstructor): void {
    if (!customElements.get(name)) {
        customElements.define(name, constructorValue);
    }
}

/**
 * Register every graph visualization custom element.
 *
 * All component modules are imported statically at the top level so their
 * dependency graph is fully typed and resolved at build time, per the
 * repository's static-import contract. Every panel therefore ships in the
 * single startup bundle rather than as separately fetched chunks; registration
 * is synchronous, so all page surfaces are defined before the app shell mounts.
 */
export function registerGraphVisualizationCustomElements(): void {
    defineCustomElementOnce("gm-button", GmButton);
    defineCustomElementOnce("gm-card", GmCard);
    defineCustomElementOnce("gm-collapsible", GmCollapsible);
    defineCustomElementOnce("gm-badge", GmBadge);
    defineCustomElementOnce("gm-copy-button", GmCopyButton);
    defineCustomElementOnce("gm-error-banner", GmErrorBanner);
    defineCustomElementOnce("gm-status-chip", GmStatusChip);
    defineCustomElementOnce("gm-app-header", GmAppHeader);
    defineCustomElementOnce("gm-page-toolbar", GmGraphToolbar);
    defineCustomElementOnce("gm-graph-panel", GmGraphPanel);
    defineCustomElementOnce("gm-app-shell", GmAppShell);
    defineCustomElementOnce("gm-json-viewer", GmJsonViewer);
    defineCustomElementOnce("gm-live-reload-panel", GmLiveReloadPanel);
    defineCustomElementOnce("gm-playground-panel", GmPlaygroundPanel);
    defineCustomElementOnce("gm-docs-panel", GmDocsPanel);
    defineCustomElementOnce("gm-fix-panel", GmFixPanel);
    defineCustomElementOnce("gm-config-panel", GmConfigPanel);
    defineCustomElementOnce("gm-auto-game-panel", GmAutoGamePanel);
}
