import { html } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Reusable button primitive that supports pending and disabled states.
 */
export class GmButton extends LightDomLitElement {
    public static properties = {
        disabled: { reflect: true, type: Boolean },
        label: { type: String },
        pending: { reflect: true, type: Boolean }
    };

    public accessor disabled = false;

    public accessor label = "";

    public accessor pending = false;

    protected render() {
        return html`
            <button class="gm-button" ?disabled=${this.disabled || this.pending}>
                <span class="button-content">
                    ${this.pending ? html`<span class="button-spinner" aria-hidden="true"></span>` : null}
                    <span class="button-label">${this.label}</span>
                </span>
            </button>
        `;
    }
}
