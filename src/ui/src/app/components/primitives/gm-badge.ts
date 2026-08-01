import { html } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

export type GmBadgeTone = "neutral" | "success" | "warning" | "error" | "muted";

/**
 * Shared inline badge primitive.
 */
export class GmBadge extends LightDomLitElement {
    public static properties = {
        label: { type: String },
        tone: { type: String }
    };

    public accessor label = "";

    public accessor tone: GmBadgeTone = "neutral";

    protected render() {
        return html`<span class=${`gm-badge gm-badge--${this.tone}`}>${this.label}</span>`;
    }
}
