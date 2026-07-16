import { html, nothing, type TemplateResult } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/** Content options shared by buttons that launch asynchronous host processes. */
export type ProcessButtonContentOptions = Readonly<{
    idleVisual?: TemplateResult;
    label: string;
    pending: boolean;
    visuallyHiddenLabel?: boolean;
}>;

/** Render stable, accessible process-button content with a shared loading indicator. */
export function renderProcessButtonContent(options: ProcessButtonContentOptions): TemplateResult {
    return html`
        <span class="button-content">
            ${
                options.pending
                    ? html`<span class="button-spinner" aria-hidden="true"></span>`
                    : (options.idleVisual ?? nothing)
            }
            <span class=${options.visuallyHiddenLabel === true ? "sr-only" : "button-label"}>${options.label}</span>
        </span>
    `;
}

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
            <button
                class="gm-btn gm-button"
                ?disabled=${this.disabled || this.pending}
                aria-busy=${this.pending ? "true" : "false"}
            >
                ${renderProcessButtonContent({ label: this.label, pending: this.pending })}
            </button>
        `;
    }
}
