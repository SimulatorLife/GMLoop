import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

function getEffectiveFixLogLines(
    model: GraphVisualizationUiModel,
    state: GraphVisualizationUiState
): ReadonlyArray<string> {
    if (state.fixLogLines.length > 0) {
        return state.fixLogLines;
    }

    return hasCurrentProjectFixRun(model)
        ? model.lastFixRun.logLines
        : ["No fix run has been started from this UI session."];
}

function hasCurrentProjectFixRun(
    model: GraphVisualizationUiModel
): model is GraphVisualizationUiModel & Readonly<{ lastFixRun: NonNullable<GraphVisualizationUiModel["lastFixRun"]> }> {
    return model.lastFixRun !== null && model.lastFixRun.projectRoot === model.loadedTarget?.projectRoot;
}

/**
 * Project fix workflow surface for running configured refactor, lint, and format steps.
 */
export class GmFixPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #onDismissErrorBanner = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "fix" }
            })
        );
    };

    public connectedCallback(): void {
        super.connectedCallback();
        this.addEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
    }

    public disconnectedCallback(): void {
        this.removeEventListener("gm-error-banner-dismiss", this.#onDismissErrorBanner);
        super.disconnectedCallback();
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName = this.state.activePage === "fix" ? "page content-page active" : "page content-page";
        const logLines = getEffectiveFixLogLines(this.model, this.state);

        return html`
            <section id="fix-page" class=${activeClassName}>
                ${
                    this.state.fixErrorMessage
                        ? html`<gm-error-banner .message=${this.state.fixErrorMessage}></gm-error-banner>`
                        : null
                }

                <section class="fix-log-section" aria-labelledby="fix-log-heading">
                    <h2 id="fix-log-heading">Run Log</h2>
                    <pre class="fix-log" aria-live="polite">${logLines.join("\n")}</pre>
                </section>
            </section>
        `;
    }
}
