import { html, type PropertyValues } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Reusable dismissable error banner primitive.
 *
 * Fires a `gm-error-banner-dismiss` event when the user dismisses the banner.
 * The event bubbles and is not composed. Host components can still clear the
 * `message` prop themselves after handling the event.
 */
export class GmErrorBanner extends LightDomLitElement {
    public static override properties = {
        dismissLabel: { type: String },
        message: { type: String }
    };

    public accessor dismissLabel = "Dismiss";

    public accessor message = "";

    #dismissedMessage: string | null = null;

    #onDismiss = (): void => {
        this.#dismissedMessage = this.message;
        this.requestUpdate();
        this.dispatchEvent(
            new CustomEvent("gm-error-banner-dismiss", {
                bubbles: true
            })
        );
    };

    protected override willUpdate(changedProperties: PropertyValues<this>): void {
        if (changedProperties.has("message") && this.message === "") {
            this.#dismissedMessage = null;
        }
    }

    protected override render() {
        if (!this.message || this.message === this.#dismissedMessage) {
            return null;
        }

        return html`
            <div class="gm-error-banner" role="alert" tabindex="-1">
                <span class="gm-error-banner__message">${this.message}</span>
                <button
                    class="gm-error-banner__dismiss"
                    type="button"
                    aria-label=${this.dismissLabel}
                    @click=${this.#onDismiss}
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                    >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                </button>
            </div>
        `;
    }
}
