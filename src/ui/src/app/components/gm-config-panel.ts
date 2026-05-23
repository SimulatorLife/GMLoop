import { html } from "lit";

import type {
    GraphVisualizationExternalToolParameter,
    GraphVisualizationGameMakerCliCommandEntry,
    GraphVisualizationGameMakerCliMcpToolEntry,
    GraphVisualizationProjectConfigurationEntry,
    GraphVisualizationProjectConfigurationLintRuleEntry,
    GraphVisualizationProjectConfigurationLintRulesetEntry,
    GraphVisualizationProjectConfigurationRefactorCodemodEntry
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import { getLintFixableBadgeLabel } from "./lint-rule-labels.js";

type ConfigViewMode = "raw" | "rendered";
type LintLevelFilter = "all" | GraphVisualizationProjectConfigurationLintRuleEntry["level"];

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

function getLintLevelLabel(level: GraphVisualizationProjectConfigurationLintRuleEntry["level"]): string {
    if (level === "error") {
        return "Error";
    }

    if (level === "warn") {
        return "Warn";
    }

    return "Off";
}

function renderConfigHelp(summary: string, body: string) {
    return html`
        <details class="config-help">
            <summary aria-label=${summary}>?</summary>
            <p>${body}</p>
        </details>
    `;
}

function renderLintRuleEntry(entry: GraphVisualizationProjectConfigurationLintRuleEntry) {
    const hasOptions = Object.keys(entry.options).length > 0;
    const fixableBadgeLabel = getLintFixableBadgeLabel(entry.fixable);

    return html`
        <li class="config-item">
            <strong>${entry.ruleId}</strong>
            <span>${entry.description}</span>
            <div class="config-badge-row">
                <gm-badge
                    class=${`config-severity-badge ${entry.level}`}
                    .label=${getLintLevelLabel(entry.level)}
                ></gm-badge>
                ${fixableBadgeLabel === null ? null : html`<gm-badge .label=${fixableBadgeLabel}></gm-badge>`}
            </div>
            ${hasOptions ? html`<pre class="config-value">${serializeConfigurationValue(entry.options)}</pre>` : null}
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

function renderExternalToolParameter(entry: GraphVisualizationExternalToolParameter) {
    return html`
        <li class="config-item">
            <strong>${entry.syntax}</strong>
            <span>${entry.description || "No description provided by the source tool."}</span>
            <div class="config-badge-row">
                <gm-badge .label=${entry.kind}></gm-badge>
                <gm-badge .label=${entry.required ? "required" : "optional"}></gm-badge>
                <gm-badge .label=${entry.multiple ? "multiple" : entry.valueType}></gm-badge>
                ${entry.choices.map((choice) => html`<gm-badge .label=${`choice:${choice}`}></gm-badge>`)}
            </div>
        </li>
    `;
}

function renderGameMakerCliCommandEntry(entry: GraphVisualizationGameMakerCliCommandEntry) {
    return html`
        <li class="config-item">
            <strong>${entry.displayName}</strong>
            <span>${entry.description || "No description provided by gm-cli."}</span>
            <pre class="config-value">${entry.usageLines.join("\n")}</pre>
            ${entry.parameters.length === 0
                ? null
                : html`<ul class="config-list">
                      ${entry.parameters.map((parameter) => renderExternalToolParameter(parameter))}
                  </ul>`}
        </li>
    `;
}

function renderGameMakerCliMcpToolEntry(entry: GraphVisualizationGameMakerCliMcpToolEntry) {
    return html`
        <li class="config-item">
            <strong>${entry.name}</strong>
            <span>${entry.description || "No description provided by ResourceTool MCP."}</span>
            ${entry.fields.length === 0
                ? html`<div class="config-badge-row"><gm-badge .label=${"no-input-fields"}></gm-badge></div>`
                : html`<ul class="config-list">
                      ${entry.fields.map((field) => renderExternalToolParameter(field))}
                  </ul>`}
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
    #lintLevelFilter: LintLevelFilter = "all";
    #lintRulesetFilter = "all";

    #setConfigViewMode(nextConfigViewMode: ConfigViewMode): void {
        this.#configViewMode = nextConfigViewMode;
        this.requestUpdate();
    }

    #setLintLevelFilter = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }

        const nextValue = target.value;
        if (nextValue !== "all" && nextValue !== "error" && nextValue !== "off" && nextValue !== "warn") {
            return;
        }

        this.#lintLevelFilter = nextValue;
        this.requestUpdate();
    };

    #setLintRulesetFilter = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }

        this.#lintRulesetFilter = target.value.length > 0 ? target.value : "all";
        this.requestUpdate();
    };

    #resetLintFilters = (): void => {
        this.#lintLevelFilter = "all";
        this.#lintRulesetFilter = "all";
        this.requestUpdate();
    };

    #isLintFilterResetDisabled(): boolean {
        return this.#lintLevelFilter === "all" && this.#lintRulesetFilter === "all";
    }

    #filterLintRules(
        lintRules: ReadonlyArray<GraphVisualizationProjectConfigurationLintRuleEntry>,
        rulesets: ReadonlyArray<GraphVisualizationProjectConfigurationLintRulesetEntry>
    ): ReadonlyArray<GraphVisualizationProjectConfigurationLintRuleEntry> {
        const selectedRuleset = rulesets.find((ruleset) => ruleset.name === this.#lintRulesetFilter);
        const rulesetRuleIds =
            this.#lintRulesetFilter === "all" || selectedRuleset === undefined
                ? null
                : new Set(selectedRuleset.ruleIds);

        return lintRules.filter((rule) => {
            const matchesRuleset = rulesetRuleIds === null || rulesetRuleIds.has(rule.ruleId);
            const matchesLevel = this.#lintLevelFilter === "all" || rule.level === this.#lintLevelFilter;
            return matchesRuleset && matchesLevel;
        });
    }

    #renderLintFilters(rulesets: ReadonlyArray<GraphVisualizationProjectConfigurationLintRulesetEntry>) {
        return html`
            <div class="config-filter-row" aria-label="Lint rule filters">
                <label class="config-filter-field">
                    <span>
                        Ruleset
                        ${renderConfigHelp(
                            "Ruleset filter help",
                            "Filter the lint list to rules included by one ruleset. All rules is the default catalog view."
                        )}
                    </span>
                    <select @change=${this.#setLintRulesetFilter}>
                        <option value="all" ?selected=${this.#lintRulesetFilter === "all"}>All Rules</option>
                        ${rulesets.map(
                            (ruleset) => html`
                                <option value=${ruleset.name} ?selected=${this.#lintRulesetFilter === ruleset.name}>
                                    ${ruleset.name}
                                </option>
                            `
                        )}
                    </select>
                </label>
                <label class="config-filter-field">
                    <span>
                        Level
                        ${renderConfigHelp(
                            "Lint level filter help",
                            "Filter by the effective lint severity after gmloop.json ruleset and rule overrides are applied."
                        )}
                    </span>
                    <select @change=${this.#setLintLevelFilter}>
                        <option value="all" ?selected=${this.#lintLevelFilter === "all"}>All Levels</option>
                        <option value="error" ?selected=${this.#lintLevelFilter === "error"}>Error</option>
                        <option value="warn" ?selected=${this.#lintLevelFilter === "warn"}>Warn</option>
                        <option value="off" ?selected=${this.#lintLevelFilter === "off"}>Off</option>
                    </select>
                </label>
                <button
                    type="button"
                    class="config-filter-reset"
                    @click=${this.#resetLintFilters}
                    ?disabled=${this.#isLintFilterResetDisabled()}
                >
                    Reset Filters
                </button>
            </div>
        `;
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
                    <p id="config-meta" class="docs-meta">Project settings are not available right now.</p>
                    <div id="config-content" class="config-stack"></div>
                </section>
            `;
        }

        const formatEntries = configCatalog.format.entries;
        const gameMakerCliCatalog = configCatalog.gameMakerCli;
        const lintRules = configCatalog.lint.rules;
        const lintRulesets = configCatalog.lint.rulesets;
        const filteredLintRules = this.#filterLintRules(lintRules, lintRulesets);
        const codemods = configCatalog.refactor.codemods;

        return html`
            <section id="config-page" class=${configPageClassName}>
                <p id="config-meta" class="docs-meta">
                    Project Root: <strong>${configCatalog.gmloop.projectRoot}</strong>
                    ${configCatalog.gmloop.configPath
                        ? html` • Config Path: <strong>${configCatalog.gmloop.configPath}</strong>`
                        : html` • Config Path: <strong>Not found</strong>`}
                </p>
                <div class="config-view-selector view-selector" role="group" aria-label="Configuration view selector">
                    <button
                        id="config-view-rendered"
                        type="button"
                        aria-pressed=${this.#configViewMode === "rendered"}
                        class=${this.#configViewMode === "rendered" ? "view-option active" : "view-option"}
                        @click=${() => this.#setConfigViewMode("rendered")}
                    >
                        Rendered
                    </button>
                    <button
                        id="config-view-raw"
                        type="button"
                        aria-pressed=${this.#configViewMode === "raw"}
                        class=${this.#configViewMode === "raw" ? "view-option active" : "view-option"}
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
                              <gm-card class="config-card" .heading=${`Format (${String(formatEntries.length)})`}>
                                  <ul class="config-list">
                                      ${formatEntries.map((entry) => renderConfigEntry(entry))}
                                  </ul>
                              </gm-card>
                              <gm-card class="config-card" .heading=${`Lint (${String(filteredLintRules.length)})`}>
                                  <p>
                                      Active ruleset: ${configCatalog.lint.ruleset ?? "none"}. Filters affect this view
                                      only.
                                  </p>
                                  ${this.#renderLintFilters(lintRulesets)}
                                  <ul class="config-list">
                                      ${filteredLintRules.length === 0
                                          ? html`<li class="config-empty">No lint rules match these filters.</li>`
                                          : filteredLintRules.map((entry) => renderLintRuleEntry(entry))}
                                  </ul>
                              </gm-card>
                              <gm-card class="config-card" .heading=${`Refactor (${String(codemods.length)})`}>
                                  <ul class="config-list">
                                      ${codemods.map((entry) => renderCodemodEntry(entry))}
                                  </ul>
                              </gm-card>
                              <gm-card
                                  class="config-card"
                                  .heading=${`GameMaker CLI (${String(gameMakerCliCatalog.cliCommands.length)})`}
                              >
                                  <p>
                                      ${gameMakerCliCatalog.available
                                          ? `Live gm-cli metadata sourced directly from ${gameMakerCliCatalog.invocation ?? "the detected gm-cli executable"}${gameMakerCliCatalog.version ? ` (v${gameMakerCliCatalog.version})` : ""}.`
                                          : (gameMakerCliCatalog.error ?? "gm-cli metadata is unavailable.")}
                                  </p>
                                  ${gameMakerCliCatalog.available
                                      ? html`
                                            <ul class="config-list">
                                                <li class="config-item">
                                                    <strong>Invocation</strong>
                                                    <span>${gameMakerCliCatalog.invocation ?? "Unavailable"}</span>
                                                </li>
                                                <li class="config-item">
                                                    <strong>Version</strong>
                                                    <span>${gameMakerCliCatalog.version ?? "Unknown"}</span>
                                                </li>
                                            </ul>
                                            <ul class="config-list">
                                                ${gameMakerCliCatalog.cliCommands.map((entry) =>
                                                    renderGameMakerCliCommandEntry(entry)
                                                )}
                                            </ul>
                                        `
                                      : null}
                              </gm-card>
                              <gm-card
                                  class="config-card"
                                  .heading=${`GameMaker MCP (${String(gameMakerCliCatalog.mcpTools.length)})`}
                              >
                                  <p>
                                      ${gameMakerCliCatalog.mcpServer.available
                                          ? `${gameMakerCliCatalog.mcpServer.name ?? "ResourceTool"} v${gameMakerCliCatalog.mcpServer.version ?? "unknown"} tool metadata sourced directly from ${gameMakerCliCatalog.mcpServer.serverId ? `the configured MCP server "${gameMakerCliCatalog.mcpServer.serverId}"` : "gm-cli resourcetool mcp"}${gameMakerCliCatalog.mcpServer.sourcePath ? ` in ${gameMakerCliCatalog.mcpServer.sourcePath}` : ""}${gameMakerCliCatalog.mcpServer.projectPath ? ` for ${gameMakerCliCatalog.mcpServer.projectPath}` : ""}.`
                                          : (gameMakerCliCatalog.mcpServer.error ??
                                            "ResourceTool MCP metadata is unavailable.")}
                                  </p>
                                  ${gameMakerCliCatalog.mcpServer.available
                                      ? html`
                                            <ul class="config-list">
                                                ${gameMakerCliCatalog.mcpTools.map((entry) =>
                                                    renderGameMakerCliMcpToolEntry(entry)
                                                )}
                                            </ul>
                                        `
                                      : null}
                              </gm-card>
                          `}
                </div>
            </section>
        `;
    }
}
