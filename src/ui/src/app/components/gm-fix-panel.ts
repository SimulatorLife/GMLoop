import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "../events/events.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { EventBusManager } from "./event-bus-mixin.js";
import { LifecycleParticipantsController } from "./lifecycle-participants-controller.js";
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
 *
 * Lifecycle wiring is delegated to injected collaborators so this class
 * does not deepen the {@link LightDomLitElement} subclass with
 * `connectedCallback` / `disconnectedCallback` overrides. The
 * `gm-error-banner-dismiss` subscription is owned by an
 * {@link EventBusManager} registered through a
 * {@link LifecycleParticipantsController}, matching the pattern used by
 * `GmGraphToolbar`, `GmLiveReloadPanel`, and `GmConfigPanel`. The class
 * therefore keeps only the `render` override that Lit requires, and the
 * public connect/disconnect behaviour is identical to the previous
 * hand-rolled lifecycle methods.
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

    public constructor() {
        super();
        new LifecycleParticipantsController(this, [
            new EventBusManager(this, [{ event: "gm-error-banner-dismiss", handler: this.#onDismissErrorBanner }])
        ]);
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName = this.state.activePage === "fix" ? "page content-page active" : "page content-page";
        const logLines = getEffectiveFixLogLines(this.model, this.state);

        const logText = logLines.join("\n");

        return html`
            <section id="fix-page" class=${activeClassName}>
                ${
                    this.state.fixErrorMessage
                        ? html`<gm-error-banner .message=${this.state.fixErrorMessage}></gm-error-banner>`
                        : null
                }

                <section class="fix-log-section" aria-labelledby="fix-log-heading">
                    <div class="fix-log-header">
                        <h2 id="fix-log-heading">Run Log</h2>
                        <gm-copy-button
                            class="fix-log-copy-button"
                            .value=${logText}
                            accessibleLabel="Copy fix run log to clipboard"
                            label="Copy Log"
                            hideLabel
                        ></gm-copy-button>
                    </div>
                    <pre class="fix-log" aria-live="polite">${logText}</pre>
                </section>
            </section>
        `;
    }
}
