import { html } from "lit";

import type {
    GraphVisualizationProjectConfigurationEntry,
    GraphVisualizationProjectConfigurationLintRuleEntry,
    GraphVisualizationProjectConfigurationRefactorCodemodEntry
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

type ConfigViewMode = "raw" | "rendered";

function serializeConfigurationValue(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function renderConfigEntry(entry: GraphVisualizationProjectConfigurationEntry) {
    return html`
        <li class="config-item">
            <strong>${entry.name}</strong>
            <span>${entry.description}</span>
            <div class="config-badge-row">
                <gm-badge .label=${entry.source}></gm-badge>
            </div>
            <pre class="config-value">${serializeConfigurationValue(entry.value)}</pre>
        </li>
    `;
}

function renderLintRuleEntry(entry: GraphVisualizationProjectConfigurationLintRuleEntry) {
    return html`
        <li class="config-item">
            <strong>${entry.ruleId}</strong>
            <span>${entry.description}</span>
            <div class="config-badge-row">
                <gm-badge .label=${entry.level}></gm-badge>
                ${entry.fixable ? html`<gm-badge .label=${`fixable:${entry.fixable}`}></gm-badge>` : null}
            </div>
            <pre class="config-value">${serializeConfigurationValue(entry.options)}</pre>
        </li>
    `;
}

function renderCodemodEntry(entry: GraphVisualizationProjectConfigurationRefactorCodemodEntry) {
    return html`
        <li class="config-item">
            <strong>${entry.id}</strong>
            <span>${entry.description}</span>
            <div class="config-badge-row">
                <gm-badge .label=${entry.enabled ? "enabled" : "disabled"}></gm-badge>
                <gm-badge
                    .label=${entry.requiresSemanticProjectIndex ? "needs-semantic" : "semantic-optional"}
                ></gm-badge>
            </div>
            <pre class="config-value">${serializeConfigurationValue(entry.config)}</pre>
        </li>
    `;
}

/**
 * Config surface that renders active workspace configuration catalogs.
 */
export class GmConfigPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #configViewMode: ConfigViewMode = "rendered";

    #setConfigViewMode(nextConfigViewMode: ConfigViewMode): void {
        this.#configViewMode = nextConfigViewMode;
        this.requestUpdate();
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const configPageClassName = this.state.activePage === "config" ? "page docs-page active" : "page docs-page";
        const configCatalog = this.model.projectConfigurationCatalog;

        if (!configCatalog) {
            return html`
                <section id="config-page" class=${configPageClassName}>
                    <p id="config-meta" class="docs-meta">No project configuration catalog was provided by the host.</p>
                    <div id="config-content" class="config-stack"></div>
                </section>
            `;
        }

        const formatEntries = configCatalog.format.entries;
        const lintRules = configCatalog.lint.rules;
        const codemods = configCatalog.refactor.codemods;

        return html`
            <section id="config-page" class=${configPageClassName}>
                <p id="config-meta" class="docs-meta">
                    Project root ${configCatalog.gmloop.projectRoot} • ${formatEntries.length} format entries •
                    ${lintRules.length} lint rules • ${codemods.length} refactor codemods
                </p>
                <div class="config-toggle-row" role="group" aria-label="Configuration view selector">
                    <button
                        id="config-view-rendered"
                        aria-pressed=${this.#configViewMode === "rendered"}
                        class=${this.#configViewMode === "rendered" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#setConfigViewMode("rendered")}
                    >
                        Rendered
                    </button>
                    <button
                        id="config-view-raw"
                        aria-pressed=${this.#configViewMode === "raw"}
                        class=${this.#configViewMode === "raw" ? "top-nav-button active" : "top-nav-button"}
                        @click=${() => this.#setConfigViewMode("raw")}
                    >
                        Raw gmloop.json
                    </button>
                </div>
                <div id="config-content" class="config-stack">
                    ${this.#configViewMode === "raw"
                        ? html`
                              <gm-card class="config-card" heading="gmloop.json">
                                  <p>
                                      ${configCatalog.gmloop.configPath ?? "No gmloop.json file is currently loaded."}
                                  </p>
                                  <pre class="config-raw">
${serializeConfigurationValue(configCatalog.gmloop.rawConfig)}</pre
                                  >
                              </gm-card>
                          `
                        : html`
                              <gm-card class="config-card" heading="Project Metadata">
                                  <p>Active project root used by graph, lint, format, and refactor workflows.</p>
                                  <ul class="config-list">
                                      <li class="config-item">
                                          <strong>Config path</strong>
                                          <span>${configCatalog.gmloop.configPath ?? "Not found"}</span>
                                      </li>
                                      <li class="config-item">
                                          <strong>Configuration exists</strong>
                                          <span>${configCatalog.gmloop.exists ? "Yes" : "No"}</span>
                                      </li>
                                  </ul>
                              </gm-card>
                              <gm-card class="config-card" heading="Format">
                                  <ul class="config-list">
                                      ${formatEntries.map((entry) => renderConfigEntry(entry))}
                                  </ul>
                              </gm-card>
                              <gm-card class="config-card" heading="Lint Rules">
                                  <p>Ruleset: ${configCatalog.lint.ruleset ?? "none"}</p>
                                  <ul class="config-list">
                                      ${lintRules.map((entry) => renderLintRuleEntry(entry))}
                                  </ul>
                              </gm-card>
                              <gm-card class="config-card" heading="Refactor Codemods">
                                  <ul class="config-list">
                                      ${codemods.map((entry) => renderCodemodEntry(entry))}
                                  </ul>
                              </gm-card>
                          `}
                </div>
            </section>
        `;
    }
}
