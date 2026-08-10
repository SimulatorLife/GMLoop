import { html } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Tracks which message text the user has dismissed so the banner stays
 * hidden while `message` still holds that text, and automatically re-arms
 * once the host clears `message` back to `""`.
 *
 * Composing this state machine keeps the dismissal bookkeeping out of the
 * host's lifecycle overrides: {@link GmErrorBanner} calls {@link sync}
 * directly from `render()` instead of reacting to property changes through
 * a separate `willUpdate` override.
 */
class ErrorBannerDismissalTracker {
    #dismissedMessage: string | null = null;

    /** Re-arms the tracker once the host has cleared its message. */
    public sync(message: string): void {
        if (message === "") {
            this.#dismissedMessage = null;
        }
    }

    public dismiss(message: string): void {
        this.#dismissedMessage = message;
    }

    public isDismissed(message: string): boolean {
        return message === this.#dismissedMessage;
    }
}

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

    #dismissal = new ErrorBannerDismissalTracker();

    #onDismiss = (): void => {
        this.#dismissal.dismiss(this.message);
        this.requestUpdate();
        this.dispatchEvent(
            new CustomEvent("gm-error-banner-dismiss", {
                bubbles: true
            })
        );
    };

    protected override render() {
        this.#dismissal.sync(this.message);

        if (!this.message || this.#dismissal.isDismissed(this.message)) {
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
