import { html, nothing } from "lit";

import type {
    GraphVisualizationProjectConfigurationCatalog,
    GraphVisualizationProjectConfigurationEntry,
    GraphVisualizationProjectConfigurationLintRuleEntry,
    GraphVisualizationProjectConfigurationRefactorCodemodEntry
} from "../../graph/types.js";
import type { GraphVisualizationUiModel } from "../contracts.js";
import { getUiErrorMessage } from "../error-message.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import {
    GRAPH_UI_EVENT_CLEAR_PAGE_ERROR,
    GRAPH_UI_EVENT_CONFIG_DRAFT_CHANGED,
    GRAPH_UI_EVENT_SAVE_CONFIG,
    GRAPH_UI_EVENT_TRIGGER_CREATE_CONFIG,
    type GraphUiSaveConfigDetail
} from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import { getLintFixableBadgeLabel } from "./lint-rule-labels.js";
import {
    isLintLevel,
    isLintLevelFilter,
    LINT_LEVEL_LABELS,
    LINT_LEVELS,
    type LintLevel,
    type LintLevelFilter
} from "./lint-rule-levels.js";
import type { GmBadgeTone } from "./primitives/gm-badge.js";
import { renderProcessButtonContent } from "./primitives/gm-button.js";

type ConfigJsonObject = Record<string, unknown>;
type DraftParseResult = Readonly<
    { config: ConfigJsonObject; error: null; ok: true } | { config: null; error: string; ok: false }
>;

const FORMAT_BUILDER_OPTION_NAMES = new Set([
    "allowInlineControlFlowBlocks",
    "logicalOperatorsStyle",
    "printWidth",
    "semi",
    "tabWidth"
]);

function serializeConfigurationValue(value: unknown): string {
    return JSON.stringify(value, null, 2);
}

function parseDraftConfig(text: string): DraftParseResult {
    try {
        const parsed = JSON.parse(text) as unknown;
        if (!isConfigJsonObject(parsed)) {
            return { config: null, error: "Config JSON must be an object.", ok: false };
        }
        return { config: parsed, error: null, ok: true };
    } catch (error) {
        return { config: null, error: getUiErrorMessage(error, "Invalid JSON."), ok: false };
    }
}

function isConfigJsonObject(value: unknown): value is ConfigJsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneConfigObject(config: Readonly<Record<string, unknown>>): ConfigJsonObject {
    return structuredClone(config);
}

function getInputValue(value: unknown): string {
    if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return String(value);
    }
    return "";
}

function createEditableConfigFromCatalog(catalog: GraphVisualizationProjectConfigurationCatalog): ConfigJsonObject {
    if (Object.keys(catalog.gmloop.rawConfig).length > 0) {
        return cloneConfigObject(catalog.gmloop.rawConfig);
    }

    const config: ConfigJsonObject = {};
    for (const entry of catalog.format.entries) {
        if (FORMAT_BUILDER_OPTION_NAMES.has(entry.name)) {
            config[entry.name] = entry.value;
        }
    }
    if (catalog.lint.ruleset !== null) {
        config.lintRuleset = catalog.lint.ruleset;
    }

    const codemods: ConfigJsonObject = {};
    for (const codemod of catalog.refactor.codemods) {
        if (codemod.enabled) {
            codemods[codemod.id] = codemod.config ?? {};
        }
    }
    if (Object.keys(codemods).length > 0) {
        config.refactor = { codemods };
    }

    return config;
}

function readConfigObjectField(config: ConfigJsonObject, fieldName: string): ConfigJsonObject {
    const value = config[fieldName];
    if (isConfigJsonObject(value)) {
        return value;
    }
    const nextValue: ConfigJsonObject = {};
    config[fieldName] = nextValue;
    return nextValue;
}

function readNestedConfigObjectField(config: ConfigJsonObject, firstFieldName: string, secondFieldName: string) {
    return readConfigObjectField(readConfigObjectField(config, firstFieldName), secondFieldName);
}

function readRawLintRuleLevel(config: ConfigJsonObject, ruleId: string): LintLevel | null {
    const lintRules = config.lintRules;
    if (!isConfigJsonObject(lintRules)) {
        return null;
    }
    const rawLevel = lintRules[ruleId];
    return isLintLevel(rawLevel) ? rawLevel : null;
}

function readRawCodemodConfig(config: ConfigJsonObject, codemodId: string): unknown {
    const refactor = config.refactor;
    if (!isConfigJsonObject(refactor)) {
        return null;
    }
    const codemods = refactor.codemods;
    if (!isConfigJsonObject(codemods)) {
        return null;
    }
    return codemods[codemodId] ?? null;
}

function getLintLevelLabel(level: LintLevel): string {
    return LINT_LEVEL_LABELS[level];
}

function renderBadge(label: string, tone: GmBadgeTone = "neutral") {
    return html`<gm-badge .label=${label} .tone=${tone}></gm-badge>`;
}

/**
 * Config surface that renders and edits active workspace configuration catalogs.
 */
export class GmConfigPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    #draftCatalogKey = "";
    #draftText = "{}";
    #lintLevelFilter: LintLevelFilter = "all";
    #lintRulesetFilter = "all";
    #lintSearchQuery = "";

    #onDismissErrorBanner = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "config" }
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

    #emitCreateConfig = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_TRIGGER_CREATE_CONFIG, {
                bubbles: true,
                composed: true
            })
        );
    };

    #emitSaveConfig(config: Readonly<Record<string, unknown>>): void {
        this.dispatchEvent(
            new CustomEvent<GraphUiSaveConfigDetail>(GRAPH_UI_EVENT_SAVE_CONFIG, {
                bubbles: true,
                composed: true,
                detail: { config }
            })
        );
    }

    #emitDraftChanged(): void {
        this.dispatchEvent(new CustomEvent(GRAPH_UI_EVENT_CONFIG_DRAFT_CHANGED, { bubbles: true, composed: true }));
    }

    #ensureDraftForCatalog(catalog: GraphVisualizationProjectConfigurationCatalog): void {
        const key = `${catalog.gmloop.configPath ?? "missing"}:${serializeConfigurationValue(catalog.gmloop.rawConfig)}`;
        if (key === this.#draftCatalogKey) {
            return;
        }
        this.#draftCatalogKey = key;
        this.#draftText = serializeConfigurationValue(createEditableConfigFromCatalog(catalog));
        this.#emitDraftChanged();
    }

    #readDraft(): DraftParseResult {
        return parseDraftConfig(this.#draftText);
    }

    #setDraftConfig(config: ConfigJsonObject): void {
        this.#draftText = serializeConfigurationValue(config);
        this.requestUpdate();
        this.#emitDraftChanged();
    }

    #updateDraftConfig(mutator: (config: ConfigJsonObject) => void): void {
        const draft = this.#readDraft();
        if (!draft.ok) {
            return;
        }
        const nextConfig = cloneConfigObject(draft.config);
        mutator(nextConfig);
        this.#setDraftConfig(nextConfig);
    }

    #onRawConfigInput = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLTextAreaElement)) {
            return;
        }
        this.#draftText = target.value;
        this.requestUpdate();
        this.#emitDraftChanged();
    };

    public get isDraftDirty(): boolean {
        if (!this.model?.projectConfigurationCatalog) {
            return false;
        }
        const initialText = serializeConfigurationValue(
            createEditableConfigFromCatalog(this.model.projectConfigurationCatalog)
        );
        return this.#draftText !== initialText;
    }

    public get isDraftValid(): boolean {
        return this.#readDraft().ok;
    }

    public get draftValidationError(): string | null {
        const result = this.#readDraft();
        return result.ok ? null : result.error;
    }

    public saveDraft(): void {
        const draft = this.#readDraft();
        if (draft.ok) {
            this.#emitSaveConfig(draft.config);
        }
    }

    public resetDraft(): void {
        if (this.model?.projectConfigurationCatalog) {
            this.#resetDraft(this.model.projectConfigurationCatalog);
        }
    }

    #setFormatEntry(entry: GraphVisualizationProjectConfigurationEntry, rawValue: string, checked: boolean): void {
        this.#updateDraftConfig((config) => {
            if (typeof entry.value === "boolean") {
                config[entry.name] = checked;
                return;
            }
            if (typeof entry.value === "number") {
                const numericValue = Number(rawValue);
                if (Number.isFinite(numericValue)) {
                    config[entry.name] = numericValue;
                }
                return;
            }
            config[entry.name] = rawValue;
        });
    }

    #setLintRuleset = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }
        this.#updateDraftConfig((config) => {
            config.lintRuleset = target.value;
        });
    };

    #setLintRuleLevel(ruleId: string, level: LintLevel): void {
        this.#updateDraftConfig((config) => {
            const lintRules = readConfigObjectField(config, "lintRules");
            lintRules[ruleId] = level;
        });
    }

    #setCodemodEnabled(codemod: GraphVisualizationProjectConfigurationRefactorCodemodEntry, enabled: boolean): void {
        this.#updateDraftConfig((config) => {
            const codemods = readNestedConfigObjectField(config, "refactor", "codemods");
            codemods[codemod.id] = enabled ? (codemod.config ?? {}) : false;
        });
    }

    #setCodemodConfig(codemodId: string, value: string): void {
        const parsed = parseDraftConfig(value);
        if (!parsed.ok) {
            return;
        }
        this.#updateDraftConfig((config) => {
            const codemods = readNestedConfigObjectField(config, "refactor", "codemods");
            codemods[codemodId] = parsed.config;
        });
    }

    #setLintLevelFilter = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) {
            return;
        }
        const nextValue = target.value;
        if (!isLintLevelFilter(nextValue)) {
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

    #setLintSearchQuery = (event: Event): void => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) {
            return;
        }
        this.#lintSearchQuery = target.value;
        this.requestUpdate();
    };

    #resetLintFilters = (): void => {
        this.#lintLevelFilter = "all";
        this.#lintRulesetFilter = "all";
        this.#lintSearchQuery = "";
        this.requestUpdate();
    };

    #resetDraft(catalog: GraphVisualizationProjectConfigurationCatalog): void {
        this.#draftCatalogKey = "";
        this.#ensureDraftForCatalog(catalog);
        this.requestUpdate();
        this.#emitDraftChanged();
    }

    #isLintFilterResetDisabled(): boolean {
        return (
            this.#lintLevelFilter === "all" && this.#lintRulesetFilter === "all" && this.#lintSearchQuery.length === 0
        );
    }

    #filterLintRules(
        lintRules: ReadonlyArray<GraphVisualizationProjectConfigurationLintRuleEntry>,
        catalog: GraphVisualizationProjectConfigurationCatalog
    ): ReadonlyArray<GraphVisualizationProjectConfigurationLintRuleEntry> {
        const selectedRuleset = catalog.lint.rulesets.find((ruleset) => ruleset.name === this.#lintRulesetFilter);
        const rulesetRuleIds =
            this.#lintRulesetFilter === "all" || selectedRuleset === undefined
                ? null
                : new Set(selectedRuleset.ruleIds);
        const normalizedSearchQuery = this.#lintSearchQuery.trim().toLowerCase();

        return lintRules.filter((rule) => {
            const matchesRuleset = rulesetRuleIds === null || rulesetRuleIds.has(rule.ruleId);
            const matchesLevel = this.#lintLevelFilter === "all" || rule.level === this.#lintLevelFilter;
            const matchesSearch =
                normalizedSearchQuery.length === 0 ||
                rule.ruleId.toLowerCase().includes(normalizedSearchQuery) ||
                rule.description.toLowerCase().includes(normalizedSearchQuery);
            return matchesRuleset && matchesLevel && matchesSearch;
        });
    }

    #renderFormatBuilder(catalog: GraphVisualizationProjectConfigurationCatalog, draftConfig: ConfigJsonObject) {
        const entries = catalog.format.entries.filter((entry) => FORMAT_BUILDER_OPTION_NAMES.has(entry.name));
        return html`
            <details class="config-builder-section" aria-labelledby="config-format-heading">
                <summary>
                    <div class="config-section-heading">
                        <h3 id="config-format-heading">Format</h3>
                        <p>Formatter-owned options saved at the top level of <code>gmloop.json</code>.</p>
                    </div>
                </summary>
                <div class="config-form-grid">
                    ${entries.map((entry) => this.#renderFormatControl(entry, draftConfig))}
                </div>
            </details>
        `;
    }

    #renderFormatControl(entry: GraphVisualizationProjectConfigurationEntry, draftConfig: ConfigJsonObject) {
        const value = draftConfig[entry.name] ?? entry.value;
        const controlId = `config-format-${entry.name}`;
        const sourceTone: GmBadgeTone = entry.source === "configured" ? "success" : "muted";

        if (typeof entry.value === "boolean") {
            return html`
                <label class="config-field config-field--toggle" for=${controlId}>
                    <span>
                        <strong>${entry.name}</strong>
                        <small>${entry.description}</small>
                    </span>
                    <input
                        id=${controlId}
                        type="checkbox"
                        ?checked=${value === true}
                        @change=${(event: Event) => {
                            const target = event.target;
                            if (target instanceof HTMLInputElement) {
                                this.#setFormatEntry(entry, target.value, target.checked);
                            }
                        }}
                    />
                    ${renderBadge(entry.source, sourceTone)}
                </label>
            `;
        }

        if (entry.name === "logicalOperatorsStyle") {
            return html`
                <label class="config-field" for=${controlId}>
                    <span>
                        <strong>${entry.name}</strong>
                        <small>${entry.description}</small>
                    </span>
                    <select
                        id=${controlId}
                        @change=${(event: Event) => {
                            const target = event.target;
                            if (target instanceof HTMLSelectElement) {
                                this.#setFormatEntry(entry, target.value, false);
                            }
                        }}
                    >
                        <option value="keywords" ?selected=${value === "keywords"}>Keywords</option>
                        <option value="symbols" ?selected=${value === "symbols"}>Symbols</option>
                    </select>
                    ${renderBadge(entry.source, sourceTone)}
                </label>
            `;
        }

        return html`
            <label class="config-field" for=${controlId}>
                <span>
                    <strong>${entry.name}</strong>
                    <small>${entry.description}</small>
                </span>
                <input
                    id=${controlId}
                    type=${typeof entry.value === "number" ? "number" : "text"}
                    .value=${getInputValue(value)}
                    min="1"
                    @input=${(event: Event) => {
                        const target = event.target;
                        if (target instanceof HTMLInputElement) {
                            this.#setFormatEntry(entry, target.value, target.checked);
                        }
                    }}
                />
                ${renderBadge(entry.source, sourceTone)}
            </label>
        `;
    }

    #renderLintBuilder(catalog: GraphVisualizationProjectConfigurationCatalog, draftConfig: ConfigJsonObject) {
        const filteredLintRules = this.#filterLintRules(catalog.lint.rules, catalog);
        const selectedRuleset =
            typeof draftConfig.lintRuleset === "string" ? draftConfig.lintRuleset : catalog.lint.ruleset;

        return html`
            <details class="config-builder-section" aria-labelledby="config-lint-heading">
                <summary>
                    <div
                        class="config-section-heading config-section-heading--split"
                        @click=${(e: Event) => e.stopPropagation()}
                    >
                        <div>
                            <h3 id="config-lint-heading">Lint</h3>
                            <p>Choose the base ruleset and override individual rule severities.</p>
                        </div>
                        <label class="config-inline-field">
                            <span>Ruleset</span>
                            <select @change=${this.#setLintRuleset}>
                                ${catalog.lint.rulesets.map(
                                    (ruleset) => html`
                                        <option value=${ruleset.name} ?selected=${selectedRuleset === ruleset.name}>
                                            ${ruleset.name}
                                        </option>
                                    `
                                )}
                            </select>
                        </label>
                    </div>
                </summary>
                ${this.#renderLintFilters(catalog)}
                <div class="config-rule-table" role="table" aria-label="Lint rule configuration">
                    <div class="config-rule-table-header" role="row">
                        <span role="columnheader">Rule</span>
                        <span role="columnheader">Severity</span>
                    </div>
                    ${filteredLintRules.length === 0
                        ? html`<p class="config-empty">No lint rules match these filters.</p>`
                        : filteredLintRules.map((entry) => this.#renderLintRuleRow(entry, draftConfig))}
                </div>
            </details>
        `;
    }

    #renderLintFilters(catalog: GraphVisualizationProjectConfigurationCatalog) {
        return html`
            <div class="config-filter-row" aria-label="Lint rule filters">
                <label class="config-filter-field">
                    <span>Search</span>
                    <input
                        type="search"
                        .value=${this.#lintSearchQuery}
                        placeholder="Rule id or description"
                        @input=${this.#setLintSearchQuery}
                    />
                </label>
                <label class="config-filter-field">
                    <span>Ruleset</span>
                    <select @change=${this.#setLintRulesetFilter}>
                        <option value="all" ?selected=${this.#lintRulesetFilter === "all"}>All Rules</option>
                        ${catalog.lint.rulesets.map(
                            (ruleset) => html`
                                <option value=${ruleset.name} ?selected=${this.#lintRulesetFilter === ruleset.name}>
                                    ${ruleset.name}
                                </option>
                            `
                        )}
                    </select>
                </label>
                <label class="config-filter-field">
                    <span>Level</span>
                    <select @change=${this.#setLintLevelFilter}>
                        <option value="all" ?selected=${this.#lintLevelFilter === "all"}>All Levels</option>
                        ${LINT_LEVELS.map(
                            (level) =>
                                html`<option value=${level} ?selected=${this.#lintLevelFilter === level}>
                                    ${getLintLevelLabel(level)}
                                </option>`
                        )}
                    </select>
                </label>
                <button
                    type="button"
                    class="gm-btn gm-btn--chip config-filter-reset"
                    @click=${this.#resetLintFilters}
                    ?disabled=${this.#isLintFilterResetDisabled()}
                >
                    Reset Filters
                </button>
            </div>
        `;
    }

    #renderLintRuleRow(entry: GraphVisualizationProjectConfigurationLintRuleEntry, draftConfig: ConfigJsonObject) {
        const effectiveLevel = readRawLintRuleLevel(draftConfig, entry.ruleId) ?? entry.level;
        const fixableBadgeLabel = getLintFixableBadgeLabel(entry.fixable);
        const hasOptions = Object.keys(entry.options).length > 0;

        return html`
            <div class="config-rule-row" role="row">
                <div class="config-rule-main" role="cell">
                    <div class="config-rule-title">
                        <strong>${entry.ruleId}</strong>
                        ${fixableBadgeLabel === null
                            ? nothing
                            : html`<gm-badge
                                  class="config-rule-fixable-badge"
                                  .label=${fixableBadgeLabel}
                                  .tone=${"neutral"}
                              ></gm-badge>`}
                    </div>
                    <span class="config-rule-description">${entry.description}</span>
                    ${hasOptions
                        ? html`<pre class="config-inline-json">${serializeConfigurationValue(entry.options)}</pre>`
                        : nothing}
                </div>
                <div
                    class="gm-view-selector config-rule-level-selector"
                    role="group"
                    aria-label=${`${entry.ruleId} severity`}
                >
                    ${LINT_LEVELS.map(
                        (level) => html`
                            <button
                                type="button"
                                class=${effectiveLevel === level
                                    ? `gm-btn--chip active config-rule-level-${level}`
                                    : `gm-btn--chip config-rule-level-${level}`}
                                aria-pressed=${effectiveLevel === level}
                                @click=${() => this.#setLintRuleLevel(entry.ruleId, level)}
                            >
                                ${getLintLevelLabel(level)}
                            </button>
                        `
                    )}
                </div>
            </div>
        `;
    }

    #renderRefactorBuilder(catalog: GraphVisualizationProjectConfigurationCatalog, draftConfig: ConfigJsonObject) {
        return html`
            <details class="config-builder-section" aria-labelledby="config-refactor-heading">
                <summary>
                    <div class="config-section-heading">
                        <h3 id="config-refactor-heading">Refactor</h3>
                        <p>Enable project codemods and inspect per-codemod JSON payloads.</p>
                    </div>
                </summary>
                <div class="config-codemod-table">
                    ${catalog.refactor.codemods.map((codemod) => this.#renderCodemodRow(codemod, draftConfig))}
                </div>
            </details>
        `;
    }

    #renderCodemodRow(
        entry: GraphVisualizationProjectConfigurationRefactorCodemodEntry,
        draftConfig: ConfigJsonObject
    ) {
        const rawCodemodConfig = readRawCodemodConfig(draftConfig, entry.id);
        const enabled = rawCodemodConfig === null ? entry.enabled : rawCodemodConfig !== false;
        const configValue =
            rawCodemodConfig === null || rawCodemodConfig === false ? (entry.config ?? {}) : rawCodemodConfig;

        return html`
            <details class="config-codemod-row">
                <summary>
                    <label class="config-toggle-label">
                        <input
                            type="checkbox"
                            ?checked=${enabled}
                            @change=${(event: Event) => {
                                const target = event.target;
                                if (target instanceof HTMLInputElement) {
                                    this.#setCodemodEnabled(entry, target.checked);
                                }
                            }}
                        />
                        <span>
                            <strong>${entry.id}</strong>
                            <small>${entry.description}</small>
                        </span>
                    </label>
                    <span class="config-badge-row">
                        ${renderBadge(enabled ? "Enabled" : "Disabled", enabled ? "success" : "muted")}
                        ${renderBadge(
                            entry.requiresSemanticProjectIndex ? "Requires semantic index" : "No semantic index",
                            entry.requiresSemanticProjectIndex ? "warning" : "muted"
                        )}
                    </span>
                </summary>
                <label class="config-json-field">
                    <span>${entry.id} config JSON</span>
                    <textarea
                        spellcheck="false"
                        .value=${serializeConfigurationValue(configValue)}
                        @change=${(event: Event) => {
                            const target = event.target;
                            if (target instanceof HTMLTextAreaElement) {
                                this.#setCodemodConfig(entry.id, target.value);
                            }
                        }}
                    ></textarea>
                </label>
            </details>
        `;
    }

    #renderRenderedConfig(catalog: GraphVisualizationProjectConfigurationCatalog, draft: DraftParseResult) {
        if (!draft.ok) {
            return html`
                <div class="config-editor-layout">
                    <section class="config-builder-section config-builder-section--invalid">
                        <h3>Rendered Config</h3>
                        <p>Fix the JSON syntax in Raw JSON before using the visual editor.</p>
                    </section>
                </div>
            `;
        }

        return html`
            <div class="config-editor-layout">
                ${this.#renderFormatBuilder(catalog, draft.config)} ${this.#renderLintBuilder(catalog, draft.config)}
                ${this.#renderRefactorBuilder(catalog, draft.config)}
            </div>
        `;
    }

    #renderRawConfig(catalog: GraphVisualizationProjectConfigurationCatalog, draft: DraftParseResult) {
        return html`
            <div class="config-editor-layout config-editor-layout--raw">
                <section class="config-builder-section config-raw-editor">
                    <div class="config-section-heading">
                        <h3>Raw JSON</h3>
                        <p>
                            Edit the exact <code>gmloop.json</code> payload. The rendered builder uses this same draft.
                        </p>
                    </div>
                    <textarea
                        id="config-raw-json"
                        class="config-raw-textarea"
                        spellcheck="false"
                        aria-describedby="config-raw-validation"
                        .value=${this.#draftText}
                        @input=${this.#onRawConfigInput}
                    ></textarea>
                    <p
                        id="config-raw-validation"
                        class=${draft.ok ? "config-validation is-valid" : "config-validation is-invalid"}
                        aria-live="polite"
                    >
                        ${draft.ok ? "JSON is valid." : draft.error}
                    </p>
                </section>
            </div>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const configPageClassName =
            this.state.activePage === "config" ? "page content-page active" : "page content-page";
        const configCatalog = this.model.projectConfigurationCatalog;

        if (!configCatalog) {
            return html`
                <section id="config-page" class=${configPageClassName}>
                    ${this.state.configErrorMessage
                        ? html`<gm-error-banner .message=${this.state.configErrorMessage}></gm-error-banner>`
                        : nothing}
                    <p id="config-meta" class="docs-meta">Project settings are not available right now.</p>
                    <div id="config-content" class="config-stack"></div>
                </section>
            `;
        }

        this.#ensureDraftForCatalog(configCatalog);
        const draft = this.#readDraft();

        return html`
            <section id="config-page" class=${configPageClassName}>
                ${this.state.configErrorMessage
                    ? html`<gm-error-banner .message=${this.state.configErrorMessage}></gm-error-banner>`
                    : nothing}
                <div id="config-content" class="config-stack">
                    ${configCatalog.gmloop.exists
                        ? nothing
                        : html`
                              <div class="config-setup-banner">
                                  <div>
                                      <h3>Configure GMLoop for your project</h3>
                                      <p>
                                          Generate a default <code>gmloop.json</code>, or edit the draft below and save
                                          it directly.
                                      </p>
                                  </div>
                                  <button
                                      type="button"
                                      class="gm-btn gm-btn--primary"
                                      ?disabled=${this.state.isRegeneratePending}
                                      aria-busy=${this.state.isRegeneratePending ? "true" : "false"}
                                      @click=${this.#emitCreateConfig}
                                  >
                                      ${renderProcessButtonContent({
                                          label: "Create Default Config",
                                          pending: this.state.isRegeneratePending
                                      })}
                                  </button>
                              </div>
                          `}
                    ${this.state.activeConfigView === "raw"
                        ? this.#renderRawConfig(configCatalog, draft)
                        : this.#renderRenderedConfig(configCatalog, draft)}
                </div>
            </section>
        `;
    }
}
