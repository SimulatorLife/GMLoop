import { html } from "lit";

import { writeValueToClipboard } from "../copy-clipboard.js";
import { CopyFeedbackController, type CopyFeedbackStatus } from "../copy-feedback-controller.js";
import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Default label rendered on the button before any copy has happened.
 */
const DEFAULT_LABEL = "Copy to clipboard";
/**
 * Label rendered on the button after a successful copy.
 */
const SUCCESS_LABEL = "Copied";
/**
 * Label rendered on the button after a failed copy attempt.
 */
const ERROR_LABEL = "Copy failed";

/**
 * Reusable "copy text to clipboard" primitive.
 *
 * Accepts the text to copy through the `value` property so the parent
 * component keeps ownership of the source payload and the button stays a
 * presentation-only collaborator. The primitive writes through the
 * asynchronous Clipboard API when available and falls back to a hidden
 * textarea + `document.execCommand("copy")` so older browsers and
 * non-secure-context test environments still receive the value.
 *
 * The feedback state machine (idle / success / error) and the badge reset
 * timer are delegated to an injected {@link CopyFeedbackController}, so
 * the primitive only needs to override {@link GmCopyButton.render} rather
 * than a tangle of `connectedCallback` / `disconnectedCallback` /
 * `willUpdate` overrides that used to mix presentation, lifecycle wiring,
 * and state transitions in a single subclass.
 */
export class GmCopyButton extends LightDomLitElement {
    public static properties = {
        label: { type: String },
        value: { type: String }
    };

    public accessor label = DEFAULT_LABEL;

    public accessor value = "";

    #feedback: CopyFeedbackController;

    public constructor() {
        super();
        this.#feedback = new CopyFeedbackController(this, {
            callbacks: {
                getValue: () => this.value,
                onChange: () => this.requestUpdate()
            },
            copy: writeValueToClipboard
        });
    }

    protected render() {
        const status = this.#feedback.status;
        const buttonLabel = this.#resolveButtonLabel(status);
        const feedbackMessage = this.#resolveFeedbackMessage(status);
        const isDisabled = this.value.length === 0;

        // The feedback line is rendered as its own single-line template to keep
        // Lit from inserting whitespace text nodes inside the button.
        return html`
            <button
                class=${`gm-copy-button gm-copy-button--${status}`}
                type="button"
                ?disabled=${isDisabled}
                aria-label=${buttonLabel}
                title=${buttonLabel}
                data-status=${status}
                @click=${() => void this.#feedback.trigger()}
            >
                <span class="gm-copy-button__icon" aria-hidden="true">${this.#renderIcon(status)}</span>
                <span class="gm-copy-button__label">${buttonLabel}</span>
            </button>
            <span class="gm-copy-button__feedback" role="status" aria-live="polite">${feedbackMessage}</span>
        `;
    }

    #resolveButtonLabel(status: CopyFeedbackStatus): string {
        if (status === "success") {
            return SUCCESS_LABEL;
        }
        if (status === "error") {
            return ERROR_LABEL;
        }
        return this.label;
    }

    #resolveFeedbackMessage(status: CopyFeedbackStatus): string {
        if (status === "success") {
            return `${this.value.length} characters copied to clipboard.`;
        }
        if (status === "error") {
            return "The browser blocked the copy attempt.";
        }
        return "";
    }

    #renderIcon(status: CopyFeedbackStatus) {
        if (status === "success") {
            return html`<svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.25"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <polyline points="5,12 10,17 19,7"></polyline>
            </svg>`;
        }
        if (status === "error") {
            return html`<svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.25"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <line x1="6" y1="6" x2="18" y2="18"></line>
                <line x1="6" y1="18" x2="18" y2="6"></line>
            </svg>`;
        }
        return html`<svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
        >
            <rect x="9" y="9" width="11" height="11" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>`;
    }
}
