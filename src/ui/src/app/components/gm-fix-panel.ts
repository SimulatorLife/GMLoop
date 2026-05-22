import { html } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import { hasLoadedGraphProject } from "../graph-availability.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { GRAPH_UI_EVENT_TRIGGER_FIX } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

function getFixStatusLabel(state: GraphVisualizationUiState): string {
    if (state.isFixPending) {
        return "Running";
    }

    if (state.fixStatus === "success") {
        return "Completed";
    }

    if (state.fixStatus === "error") {
        return "Needs Review";
    }

    return "Ready";
}

function getEffectiveFixStatus(
    model: GraphVisualizationUiModel,
    state: GraphVisualizationUiState
): GraphVisualizationUiState["fixStatus"] {
    if (state.fixStatus === "idle" && state.fixLogLines.length === 0 && hasCurrentProjectFixRun(model)) {
        return model.lastFixRun.status;
    }

    return state.fixStatus;
}

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

    #emitRunFix(): void {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_FIX, {
                bubbles: true,
                composed: true
            })
        );
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName = this.state.activePage === "fix" ? "page docs-page active" : "page docs-page";
        const hasProject = hasLoadedGraphProject(this.model);
        const canRunFix = hasProject && this.model.isServerMode;
        const effectiveFixStatus = getEffectiveFixStatus(this.model, this.state);
        const logLines = getEffectiveFixLogLines(this.model, this.state);

        return html`
            <section id="fix-page" class=${activeClassName}>
                <div class="fix-action-bar">
                    <div class="fix-action-card" role="status" aria-live="polite">
                        <span class=${`fix-status-chip ${effectiveFixStatus}`}>
                            ${getFixStatusLabel({ ...this.state, fixStatus: effectiveFixStatus })}
                        </span>
                        <button
                            id="run-fix"
                            class="fix-run-button"
                            ?disabled=${this.state.isFixPending || !canRunFix}
                            @click=${() => this.#emitRunFix()}
                        >
                            <span class="button-content">
                                ${this.state.isFixPending
                                    ? html`<span class="button-spinner" aria-hidden="true"></span>`
                                    : null}
                                <span class="button-label"
                                    >${this.state.isFixPending ? "Applying Fixes..." : "Apply Fixes"}</span
                                >
                            </span>
                        </button>
                        ${hasProject
                            ? html`<span class="fix-target"
                                  >${this.model.isServerMode
                                      ? this.model.loadedTarget?.projectRoot
                                      : "Serve mode is required to apply fixes."}</span
                              >`
                            : html`<span class="fix-target is-empty">Open a project before running fixes.</span>`}
                    </div>
                </div>

                ${this.state.fixErrorMessage
                    ? html`<gm-error-banner .message=${this.state.fixErrorMessage}></gm-error-banner>`
                    : null}

                <section class="fix-log-section" aria-labelledby="fix-log-heading">
                    <h2 id="fix-log-heading">Run Log</h2>
                    <gm-card class="fix-log-card">
                        <pre class="fix-log" aria-live="polite">${logLines.join("\n")}</pre>
                    </gm-card>
                </section>
            </section>
        `;
    }
}
