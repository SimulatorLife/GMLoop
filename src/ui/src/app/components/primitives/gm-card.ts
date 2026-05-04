import { html } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Shared card primitive used by docs and config surfaces.
 */
export class GmCard extends LightDomLitElement {
    public static properties = {
        heading: { type: String }
    };

    public accessor heading = "";

    protected render() {
        return html`
            <article class="gm-card">
                ${this.heading ? html`<h3>${this.heading}</h3>` : null}
                <slot></slot>
            </article>
        `;
    }
}
