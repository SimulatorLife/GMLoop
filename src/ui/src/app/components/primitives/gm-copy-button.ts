import { html, type PropertyValues } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Closed set of feedback states the copy button reports after a copy attempt.
 *
 * The primitive only surfaces its own outcome to keep screen readers and
 * visual feedback aligned with a small, predictable set of strings.
 */
type CopyStatus = "idle" | "success" | "error";

const COPY_FEEDBACK_DURATION_MS = 1500;
const DEFAULT_LABEL = "Copy to clipboard";
const SUCCESS_LABEL = "Copied";
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
 */
export class GmCopyButton extends LightDomLitElement {
    public static properties = {
        label: { type: String },
        value: { type: String }
    };

    public accessor label = DEFAULT_LABEL;

    public accessor value = "";

    #status: CopyStatus = "idle";

    #feedbackResetTimer: ReturnType<typeof setTimeout> | null = null;

    #onClick = (): void => {
        void this.#copyValue();
    };

    public override connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("click", this.#onClick);
    }

    public override disconnectedCallback(): void {
        this.removeEventListener("click", this.#onClick);
        this.#clearFeedbackTimer();
        super.disconnectedCallback();
    }

    protected override willUpdate(changedProperties: PropertyValues<this>): void {
        if (changedProperties.has("value")) {
            this.#clearFeedbackTimer();
            this.#status = "idle";
        }
    }

    async #copyValue(): Promise<void> {
        if (this.value.length === 0) {
            return;
        }

        const copied = await writeToClipboard(this.value);
        this.#status = copied ? "success" : "error";
        this.requestUpdate();
        this.#clearFeedbackTimer();
        this.#feedbackResetTimer = setTimeout(() => {
            this.#status = "idle";
            this.#feedbackResetTimer = null;
            this.requestUpdate();
        }, COPY_FEEDBACK_DURATION_MS);
    }

    #clearFeedbackTimer(): void {
        if (this.#feedbackResetTimer === null) {
            return;
        }
        clearTimeout(this.#feedbackResetTimer);
        this.#feedbackResetTimer = null;
    }

    #resolveButtonLabel(): string {
        if (this.#status === "success") {
            return SUCCESS_LABEL;
        }
        if (this.#status === "error") {
            return ERROR_LABEL;
        }
        return this.label;
    }

    #resolveFeedbackMessage(): string {
        if (this.#status === "success") {
            return `${this.value.length} characters copied to clipboard.`;
        }
        if (this.#status === "error") {
            return "The browser blocked the copy attempt.";
        }
        return "";
    }

    protected render() {
        const buttonLabel = this.#resolveButtonLabel();
        const feedbackMessage = this.#resolveFeedbackMessage();
        const isDisabled = this.value.length === 0;

        // The feedback line is rendered as its own single-line template to keep
        // Lit from inserting whitespace text nodes inside the button.
        return html`
            <button
                class=${`gm-copy-button gm-copy-button--${this.#status}`}
                type="button"
                ?disabled=${isDisabled}
                aria-label=${buttonLabel}
                title=${buttonLabel}
                data-status=${this.#status}
                @click=${this.#onClick}
            >
                <span class="gm-copy-button__icon" aria-hidden="true">${this.#renderIcon()}</span>
                <span class="gm-copy-button__label">${buttonLabel}</span>
            </button>
            <span class="gm-copy-button__feedback" role="status" aria-live="polite">${feedbackMessage}</span>
        `;
    }

    #renderIcon() {
        if (this.#status === "success") {
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
        if (this.#status === "error") {
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

async function writeToClipboard(value: string): Promise<boolean> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText !== undefined) {
        try {
            await navigator.clipboard.writeText(value);
            return true;
        } catch {
            // Fall through to the legacy fallback below.
        }
    }

    return writeToClipboardLegacy(value);
}

function writeToClipboardLegacy(value: string): boolean {
    if (typeof document === "undefined") {
        return false;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "absolute";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.append(textarea);
    textarea.select();
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        textarea.remove();
    }
}
