import { html } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Shared inline badge primitive.
 */
export class GmBadge extends LightDomLitElement {
    public static properties = {
        label: { type: String }
    };

    public accessor label = "";

    protected render() {
        return html`<span class="gm-badge">${this.label}</span>`;
    }
}
