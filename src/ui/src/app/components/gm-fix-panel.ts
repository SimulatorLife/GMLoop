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
        const logLines =
            this.state.fixLogLines.length > 0
                ? this.state.fixLogLines
                : ["No fix run has been started from this UI session."];

        return html`
            <section id="fix-page" class=${activeClassName}>
                <div class="fix-hero">
                    <div>
                        <p class="docs-meta">Run the opened project's gmloop-configured repair workflow.</p>
                        <h2>Apply Project Fixes</h2>
                        <p>
                            This runs configured refactor codemods first, then lint auto-fixes, then formatter output
                            against the active GameMaker project.
                        </p>
                    </div>
                    <div class="fix-action-card" role="status" aria-live="polite">
                        <span class=${`fix-status-chip ${this.state.fixStatus}`}>
                            ${getFixStatusLabel(this.state)}
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

                <div class="fix-stage-grid" aria-label="Fix workflow stages">
                    <gm-card class="fix-stage-card" .heading=${"1. Refactor"}>
                        <p>Applies enabled codemods from the project gmloop configuration.</p>
                    </gm-card>
                    <gm-card class="fix-stage-card" .heading=${"2. Lint"}>
                        <p>Runs fixable GML lint rules using the configured ruleset.</p>
                    </gm-card>
                    <gm-card class="fix-stage-card" .heading=${"3. Format"}>
                        <p>Formats changed GML files with the project formatter options.</p>
                    </gm-card>
                </div>

                ${this.state.fixErrorMessage
                    ? html`<gm-error-banner .message=${this.state.fixErrorMessage}></gm-error-banner>`
                    : null}

                <gm-card class="fix-log-card" .heading=${"Run Log"}>
                    <pre class="fix-log" aria-live="polite">${logLines.join("\n")}</pre>
                </gm-card>
            </section>
        `;
    }
}
