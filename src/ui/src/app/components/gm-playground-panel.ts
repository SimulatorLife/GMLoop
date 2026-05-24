import { html, type PropertyValues } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import { getUiErrorMessage } from "../error-message.js";
import { DEFAULT_PLAYGROUND_GML_SOURCE, resolveInitialPlaygroundGmlSource } from "../playground-default-gml.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";

/**
 * Interactive playground for GML parsing, formatting, and rule application.
 */
export class GmPlaygroundPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    public constructor() {
        super();
        if ("matchMedia" in globalThis && globalThis.matchMedia("(max-width: 920px)").matches) {
            this.#controlsPanelOpen = false;
        }
    }

    #gmlInput = DEFAULT_PLAYGROUND_GML_SOURCE;

    #gmlOutput = "";

    #astJson = "";

    #viewMode: "code" | "ast" = "code";

    #transpileMode: "none" | "patch" | "expression" = "none";

    #controlsPanelOpen = true;

    #error: string | null = null;

    #debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    #enabledLintRules = new Map<string, boolean>();

    #enabledFormatOptions = new Map<string, boolean>();

    #enabledCodemods = new Map<string, boolean>();

    #showFormatDetails = false;

    #showLintDetails = false;

    #showCodemodDetails = false;

    #formatSearchQuery = "";

    #lintSearchQuery = "";

    #codemodSearchQuery = "";

    public disconnectedCallback(): void {
        if (this.#debounceTimer !== null) {
            globalThis.clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }

        super.disconnectedCallback();
    }

    protected firstUpdated(): void {
        const savedInput = localStorage.getItem("gmloop-playground-input");
        this.#gmlInput = resolveInitialPlaygroundGmlSource(savedInput);
        if (savedInput !== this.#gmlInput) {
            localStorage.setItem("gmloop-playground-input", this.#gmlInput);
        }
        if (this.state?.activePage === "playground") {
            void this.#processInput();
        }
    }

    protected updated(changedProperties: PropertyValues): void {
        super.updated(changedProperties);
        if (changedProperties.has("state") && this.state?.activePage === "playground") {
            void this.#processInput();
        }
    }

    #toggleFormatOption(optionName: string): void {
        const current = this.#enabledFormatOptions.get(optionName) ?? false;
        this.#enabledFormatOptions.set(optionName, !current);
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleLintRule(ruleId: string): void {
        const current = this.#enabledLintRules.get(ruleId) ?? false;
        this.#enabledLintRules.set(ruleId, !current);
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleCodemod(codemodId: string): void {
        const current = this.#enabledCodemods.get(codemodId) ?? false;
        this.#enabledCodemods.set(codemodId, !current);
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleFormatDetails(): void {
        this.#showFormatDetails = !this.#showFormatDetails;
        this.requestUpdate();
    }

    #toggleLintDetails(): void {
        this.#showLintDetails = !this.#showLintDetails;
        this.requestUpdate();
    }

    #toggleCodemodDetails(): void {
        this.#showCodemodDetails = !this.#showCodemodDetails;
        this.requestUpdate();
    }

    #setFormatSearchQuery(value: string): void {
        this.#formatSearchQuery = value.trim().toLowerCase();
        this.requestUpdate();
    }

    #setLintSearchQuery(value: string): void {
        this.#lintSearchQuery = value.trim().toLowerCase();
        this.requestUpdate();
    }

    #setCodemodSearchQuery(value: string): void {
        this.#codemodSearchQuery = value.trim().toLowerCase();
        this.requestUpdate();
    }

    #setAllFormatOptionsEnabled(enabled: boolean, entries: ReadonlyArray<{ name: string }>): void {
        for (const entry of entries) {
            this.#enabledFormatOptions.set(entry.name, enabled);
        }
        void this.#processInput();
        this.requestUpdate();
    }

    #setAllLintRulesEnabled(enabled: boolean, entries: ReadonlyArray<{ ruleId: string }>): void {
        for (const entry of entries) {
            this.#enabledLintRules.set(entry.ruleId, enabled);
        }
        void this.#processInput();
        this.requestUpdate();
    }

    #setAllCodemodsEnabled(enabled: boolean, entries: ReadonlyArray<{ id: string }>): void {
        for (const entry of entries) {
            this.#enabledCodemods.set(entry.id, enabled);
        }
        void this.#processInput();
        this.requestUpdate();
    }

    readonly #onInputChange = (e: Event): void => {
        const target = e.target as HTMLTextAreaElement;
        this.#gmlInput = target.value;
        localStorage.setItem("gmloop-playground-input", this.#gmlInput);

        if (this.#debounceTimer !== null) {
            globalThis.clearTimeout(this.#debounceTimer);
        }

        this.#debounceTimer = globalThis.setTimeout(() => {
            void this.#processInput();
            this.requestUpdate();
        }, 300);

        this.requestUpdate();
    };

    async #processInput(): Promise<void> {
        this.#error = null;
        if (!this.#gmlInput.trim()) {
            this.#gmlOutput = "";
            this.#astJson = "";
            return;
        }

        const formatOptions = this.#resolveFormatOptions();
        const lintRules = this.#resolveLintRules();
        const codemods = this.#resolveCodemods();
        const enabledFormatOptionNames = this.#resolveEnabledFormatOptionNames(formatOptions);
        const enabledLintRuleIds = this.#resolveEnabledLintRuleIds(lintRules);
        const enabledCodemodIds = this.#resolveEnabledCodemodIds(codemods);

        try {
            const response = await fetch("/api/playground/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    gml: this.#gmlInput,
                    format: enabledFormatOptionNames.length > 0,
                    formatOptionNames: enabledFormatOptionNames,
                    lint: enabledLintRuleIds.length > 0,
                    lintRuleIds: enabledLintRuleIds,
                    refactor: enabledCodemodIds.length > 0,
                    codemodIds: enabledCodemodIds,
                    transpileMode: this.#transpileMode
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error ?? `Server error: ${response.status}`);
            }

            const data = await response.json();
            if (data.payload.error) {
                this.#error = data.payload.error;
                this.#gmlOutput = "";
                this.#astJson = "";
            } else {
                this.#astJson = data.payload.ast;
                this.#gmlOutput = data.payload.output;
            }
        } catch (error) {
            this.#error = getUiErrorMessage(error, "Unknown error");
            this.#gmlOutput = "";
            this.#astJson = "";
        }

        this.requestUpdate();
    }

    #resolveFormatOptions(): ReadonlyArray<{ description: string; name: string }> {
        const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
        const configuredEntries = this.model?.projectConfigurationCatalog?.format.entries;
        if (configuredEntries && configuredEntries.length > 0) {
            return configuredEntries.map((entry) => ({ description: entry.description, name: entry.name }));
        }
        return (workspaceRules?.formatOptions ?? []).map((entry) => ({
            description: entry.description,
            name: entry.name
        }));
    }

    #resolveLintRules(): ReadonlyArray<{ description: string; ruleId: string }> {
        const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
        const configuredRules = this.model?.projectConfigurationCatalog?.lint.rules;
        if (configuredRules && configuredRules.length > 0) {
            return configuredRules;
        }
        return workspaceRules?.lintRules ?? [];
    }

    #resolveCodemods(): ReadonlyArray<{ description: string; id: string }> {
        const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
        const configuredCodemods = this.model?.projectConfigurationCatalog?.refactor.codemods;
        if (configuredCodemods && configuredCodemods.length > 0) {
            return configuredCodemods;
        }
        return workspaceRules?.refactorCodemods ?? [];
    }

    #resolveEnabledFormatOptionNames(
        formatOptions: ReadonlyArray<{ description: string; name: string }>
    ): ReadonlyArray<string> {
        return formatOptions
            .filter((option) => this.#enabledFormatOptions.get(option.name) === true)
            .map((option) => option.name);
    }

    #resolveEnabledLintRuleIds(
        lintRules: ReadonlyArray<{ description: string; ruleId: string }>
    ): ReadonlyArray<string> {
        return lintRules.filter((rule) => this.#enabledLintRules.get(rule.ruleId) === true).map((rule) => rule.ruleId);
    }

    #resolveEnabledCodemodIds(codemods: ReadonlyArray<{ description: string; id: string }>): ReadonlyArray<string> {
        return codemods
            .filter((codemod) => this.#enabledCodemods.get(codemod.id) === true)
            .map((codemod) => codemod.id);
    }

    #setTranspileMode(mode: "patch" | "expression"): void {
        this.#transpileMode = this.#transpileMode === mode ? "none" : mode;
        void this.#processInput();
        this.requestUpdate();
    }

    #setViewMode(mode: "code" | "ast"): void {
        this.#viewMode = mode;
        this.requestUpdate();
    }

    #toggleControlsPanel(event: Event): void {
        event.preventDefault();
        this.#controlsPanelOpen = !this.#controlsPanelOpen;
        this.requestUpdate();
    }

    #renderRuleRow(parameters: { description: string; keyText: string; onToggle: () => void; selected: boolean }) {
        return html`
            <label class="rule-details-item" title=${parameters.description}>
                <input type="checkbox" .checked=${parameters.selected} @change=${parameters.onToggle} />
                <span class="rule-details-item-key">${parameters.keyText}</span>
                <span class="rule-details-item-description">${parameters.description}</span>
            </label>
        `;
    }

    #renderRuleSection(parameters: {
        entries: ReadonlyArray<{ description: string; keyText: string; onToggle: () => void; selected: boolean }>;
        expanded: boolean;
        label: string;
        searchQuery: string;
        setAllSelected: (selected: boolean) => void;
        setExpanded: () => void;
        setSearchQuery: (value: string) => void;
    }) {
        const filteredEntries =
            parameters.searchQuery.length === 0
                ? parameters.entries
                : parameters.entries.filter(
                      (entry) =>
                          entry.keyText.toLowerCase().includes(parameters.searchQuery) ||
                          entry.description.toLowerCase().includes(parameters.searchQuery)
                  );
        const selectedCount = parameters.entries.filter((entry) => entry.selected).length;
        const sectionId = parameters.label.toLowerCase().replaceAll(" ", "-");
        const entriesListId = `${sectionId}-entries`;

        return html`
            <div class="rule-details-section">
                <button
                    type="button"
                    class="rule-details-header ${parameters.expanded ? "expanded" : ""}"
                    aria-controls=${entriesListId}
                    aria-expanded=${parameters.expanded}
                    @click=${parameters.setExpanded}
                >
                    <span class="rule-details-header-icon">${parameters.expanded ? "▾" : "▸"}</span>
                    <span class="rule-details-header-label">${parameters.label}</span>
                    <span class="rule-details-count">${selectedCount}/${parameters.entries.length} enabled</span>
                </button>
                ${parameters.expanded
                    ? html`
                          <div class="rule-details-controls">
                              <input
                                  class="rule-details-search"
                                  type="text"
                                  aria-label="Search ${parameters.label}"
                                  placeholder="Search ${parameters.label.toLowerCase()}..."
                                  .value=${parameters.searchQuery}
                                  @input=${(event: Event) => {
                                      const target = event.target as HTMLInputElement;
                                      parameters.setSearchQuery(target.value);
                                  }}
                              />
                              <button
                                  type="button"
                                  class="rule-details-bulk-action"
                                  @click=${() => parameters.setAllSelected(true)}
                              >
                                  Enable all
                              </button>
                              <button
                                  type="button"
                                  class="rule-details-bulk-action"
                                  @click=${() => parameters.setAllSelected(false)}
                              >
                                  Disable all
                              </button>
                          </div>
                          <div
                              id=${entriesListId}
                              class="rule-details-list"
                              role="group"
                              aria-label=${parameters.label}
                          >
                              ${filteredEntries.map((entry) => this.#renderRuleRow(entry))}
                          </div>
                          <div class="rule-details-footer">
                              ${filteredEntries.length === parameters.entries.length
                                  ? `${parameters.entries.length} items`
                                  : `${filteredEntries.length} of ${parameters.entries.length} items`}
                          </div>
                      `
                    : null}
            </div>
        `;
    }

    #renderRuleDetails() {
        const formatOptions = this.#resolveFormatOptions();
        const lintRules = this.#resolveLintRules();
        const codemods = this.#resolveCodemods();
        if (formatOptions.length === 0 && lintRules.length === 0 && codemods.length === 0) {
            return html``;
        }

        return html`
            <div class="rule-details">
                ${formatOptions.length > 0
                    ? this.#renderRuleSection({
                          entries: formatOptions.map((option) => ({
                              description: option.description,
                              keyText: option.name,
                              onToggle: () => this.#toggleFormatOption(option.name),
                              selected: this.#enabledFormatOptions.get(option.name) === true
                          })),
                          expanded: this.#showFormatDetails,
                          label: "Format Options",
                          searchQuery: this.#formatSearchQuery,
                          setAllSelected: (enabled) => this.#setAllFormatOptionsEnabled(enabled, formatOptions),
                          setExpanded: () => this.#toggleFormatDetails(),
                          setSearchQuery: (value) => this.#setFormatSearchQuery(value)
                      })
                    : null}
                ${lintRules.length > 0
                    ? this.#renderRuleSection({
                          entries: lintRules.map((rule) => ({
                              description: rule.description,
                              keyText: rule.ruleId,
                              onToggle: () => this.#toggleLintRule(rule.ruleId),
                              selected: this.#enabledLintRules.get(rule.ruleId) === true
                          })),
                          expanded: this.#showLintDetails,
                          label: "Lint Rules",
                          searchQuery: this.#lintSearchQuery,
                          setAllSelected: (enabled) => this.#setAllLintRulesEnabled(enabled, lintRules),
                          setExpanded: () => this.#toggleLintDetails(),
                          setSearchQuery: (value) => this.#setLintSearchQuery(value)
                      })
                    : null}
                ${codemods.length > 0
                    ? this.#renderRuleSection({
                          entries: codemods.map((codemod) => ({
                              description: codemod.description,
                              keyText: codemod.id,
                              onToggle: () => this.#toggleCodemod(codemod.id),
                              selected: this.#enabledCodemods.get(codemod.id) === true
                          })),
                          expanded: this.#showCodemodDetails,
                          label: "Codemods",
                          searchQuery: this.#codemodSearchQuery,
                          setAllSelected: (enabled) => this.#setAllCodemodsEnabled(enabled, codemods),
                          setExpanded: () => this.#toggleCodemodDetails(),
                          setSearchQuery: (value) => this.#setCodemodSearchQuery(value)
                      })
                    : null}
            </div>
        `;
    }

    #renderTranspileControls() {
        return html`
            <div class="playground-control-section">
                <div class="playground-control-section-header">
                    <span>Transpile</span>
                    <span class="playground-control-section-note">Optional JS output</span>
                </div>
                <div class="rule-toggles">
                    <button
                        type="button"
                        class="rule-toggle ${this.#transpileMode === "patch" ? "active" : ""}"
                        aria-pressed=${this.#transpileMode === "patch"}
                        @click=${() => this.#setTranspileMode("patch")}
                    >
                        Patch Transpile
                    </button>
                    <button
                        type="button"
                        class="rule-toggle ${this.#transpileMode === "expression" ? "active" : ""}"
                        aria-pressed=${this.#transpileMode === "expression"}
                        @click=${() => this.#setTranspileMode("expression")}
                    >
                        Expression Transpile
                    </button>
                </div>
            </div>
        `;
    }

    #renderControlsPanel() {
        return html`
            <aside
                id="playground-controls-panel"
                class="playground-controls-panel ${this.#controlsPanelOpen ? "is-open" : "is-collapsed"}"
                aria-label="Playground controls"
            >
                <div class="playground-controls-body">
                    ${this.#renderTranspileControls()} ${this.#renderRuleDetails()}
                </div>
            </aside>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName = this.state.activePage === "playground" ? "page active" : "page";
        const controlsPanelClassName = this.#controlsPanelOpen
            ? "playground-layout controls-open"
            : "playground-layout controls-collapsed";

        return html`
            <section id="playground-page" class=${activeClassName}>
                <div class="playground-toolbar">
                    <button
                        type="button"
                        class="playground-controls-toggle ${this.#controlsPanelOpen ? "is-open" : "is-closed"}"
                        aria-controls="playground-controls-panel"
                        aria-expanded=${this.#controlsPanelOpen}
                        @click=${(event: Event) => this.#toggleControlsPanel(event)}
                    >
                        <span class="playground-controls-toggle-icon" aria-hidden="true">
                            <span></span>
                            <span></span>
                            <span></span>
                        </span>
                        <span>${this.#controlsPanelOpen ? "Hide Controls" : "Show Controls"}</span>
                    </button>
                    <div class="view-selector">
                        <button
                            type="button"
                            class="view-option ${this.#viewMode === "code" ? "active" : ""}"
                            aria-pressed=${this.#viewMode === "code"}
                            @click=${() => this.#setViewMode("code")}
                        >
                            Output Code
                        </button>
                        <button
                            type="button"
                            class="view-option ${this.#viewMode === "ast" ? "active" : ""}"
                            aria-pressed=${this.#viewMode === "ast"}
                            @click=${() => this.#setViewMode("ast")}
                        >
                            AST View
                        </button>
                    </div>
                </div>
                <div class=${controlsPanelClassName}>
                    ${this.#renderControlsPanel()}
                    <div class="playground-main">
                        <div class="editor-pane">
                            <div class="pane-header">
                                <span>Input GML</span>
                                <span class="pane-header-status">Writable</span>
                            </div>
                            <textarea
                                class="playground-input"
                                aria-label="Playground input GML"
                                placeholder="Paste or write GML code here..."
                                .value=${this.#gmlInput}
                                @input=${this.#onInputChange}
                                spellcheck="false"
                            ></textarea>
                        </div>
                        <div class="editor-pane">
                            <div class="pane-header">
                                <span
                                    >${this.#viewMode === "code"
                                        ? this.#transpileMode === "none"
                                            ? "GML"
                                            : "JS"
                                        : "Parsed AST"}</span
                                >
                                <span class="pane-header-status">Read-only</span>
                            </div>
                            ${this.#error
                                ? html`<div class="playground-output is-error" role="status" aria-live="polite">
                                      ${this.#error}
                                  </div>`
                                : this.#viewMode === "code"
                                  ? html`<pre class="playground-output" aria-live="polite">${this.#gmlOutput}</pre>`
                                  : html`<pre class="playground-output" aria-live="polite">${this.#astJson}</pre>`}
                        </div>
                    </div>
                </div>
            </section>
        `;
    }
}
