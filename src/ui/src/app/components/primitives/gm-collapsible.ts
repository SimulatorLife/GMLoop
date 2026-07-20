import { html, nothing } from "lit";
import type { TemplateResult } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Shared disclosure primitive backing every collapsible panel across the UI, so all
 * panels share one native `<details>` structure and one expand/collapse arrow treatment.
 */
export class GmCollapsible extends LightDomLitElement {
    public static properties = {
        summary: { attribute: false },
        content: { attribute: false },
        labelledBy: { attribute: "labelled-by" }
    };

    public accessor summary: TemplateResult | string = "";

    public accessor content: TemplateResult | string = "";

    public accessor labelledBy = "";

    protected render() {
        return html`
            <details class="gm-collapsible" aria-labelledby=${this.labelledBy || nothing}>
                <summary class="gm-collapsible__summary">${this.summary}</summary>
                <div class="gm-collapsible__body">${this.content}</div>
            </details>
        `;
    }
}
