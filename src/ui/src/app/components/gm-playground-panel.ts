import { SyntaxHighlight } from "@gmloop/syntax-highlight";
import { diffLines } from "diff";
import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

import type { GraphVisualizationUiModel } from "../contracts.js";
import { getUiErrorMessage } from "../error-message.js";
import type { GraphVisualizationUiState } from "../state/types.js";
import { EventBusManager } from "./event-bus-mixin.js";
import { GRAPH_UI_EVENT_CLEAR_PAGE_ERROR } from "./events.js";
import { LightDomLitElement } from "./light-dom-lit-element.js";
import { PlaygroundSessionController } from "./playground-session-controller.js";

interface PlaygroundFixture {
    caseId: string;
    kind: string;
    inputGml: string;
    expectedGml: string | null;
    config: Record<string, unknown>;
}

export class GmPlaygroundPanel extends LightDomLitElement {
    public static properties = {
        model: { attribute: false },
        state: { attribute: false }
    };

    public accessor model: GraphVisualizationUiModel | null = null;

    public accessor state: GraphVisualizationUiState | null = null;

    public constructor() {
        super();
    }

    // The session controller is declared before the callbacks it references
    // so the arrow-function callbacks close over `this` and resolve their
    // target members lazily (the methods themselves are defined further
    // below).
    #sessionController = new PlaygroundSessionController(this, {
        callbacks: {
            onInputChanged: () => this.requestUpdate(),
            onModelChanged: () => this.#onModelChange(),
            onProcessInput: () => this.#processInput()
        },
        getModel: () => this.model,
        getState: () => this.state
    });

    #onDismissErrorBanner = (): void => {
        this.dispatchEvent(
            new CustomEvent(GRAPH_UI_EVENT_CLEAR_PAGE_ERROR, {
                bubbles: true,
                composed: true,
                detail: { page: "playground" }
            })
        );
    };

    #eventBus = new EventBusManager(this, [{ event: "gm-error-banner-dismiss", handler: this.#onDismissErrorBanner }]);

    public connectedCallback(): void {
        super.connectedCallback();
        this.#eventBus.connect();
        void this.#loadFixtures();
    }

    public disconnectedCallback(): void {
        this.#eventBus.disconnect();
        super.disconnectedCallback();
    }

    #fixtures: ReadonlyArray<PlaygroundFixture> = [];

    #selectedFixtureId = "";

    #expectedGml: string | null = null;

    #loadingFixtures = false;

    async #loadFixtures(): Promise<void> {
        if (this.#fixtures.length > 0 || this.#loadingFixtures) {
            return;
        }
        this.#loadingFixtures = true;
        try {
            const response = await fetch("/api/playground/fixtures");
            if (response.ok) {
                const data = await response.json();
                this.#fixtures = data.fixtures ?? [];
            }
        } catch (error) {
            console.error("Failed to load playground fixtures:", error);
        } finally {
            this.#loadingFixtures = false;
            this.requestUpdate();
        }
    }

    #gmlOutput = "";

    #astJson = "";

    #viewMode: "code" | "ast" = "code";

    #transpileMode: "none" | "patch" | "expression" = "none";

    #error: string | null = null;

    #enabledLintRules = new Map<string, boolean>();

    #enabledFormatOptions = new Map<string, boolean>();

    #enabledCodemods = new Map<string, boolean>();

    #syncEnabledFormatOptionsFromModel(model: GraphVisualizationUiModel | null): void {
        const formatOptions = this.#resolveFormatOptionsForModel(model);
        for (const option of formatOptions) {
            if (!this.#enabledFormatOptions.has(option.name)) {
                this.#enabledFormatOptions.set(option.name, false);
            }
        }
    }

    #syncEnabledLintRulesFromModel(model: GraphVisualizationUiModel | null): void {
        const lintRules = this.#resolveLintRulesForModel(model);
        for (const rule of lintRules) {
            if (!this.#enabledLintRules.has(rule.ruleId)) {
                this.#enabledLintRules.set(rule.ruleId, false);
            }
        }
    }

    #syncEnabledCodemodsFromModel(model: GraphVisualizationUiModel | null): void {
        const codemods = this.#resolveCodemodsForModel(model);
        for (const codemod of codemods) {
            if (!this.#enabledCodemods.has(codemod.id)) {
                this.#enabledCodemods.set(codemod.id, false);
            }
        }
    }

    #onModelChange = (): void => {
        this.#syncEnabledFormatOptionsFromModel(this.model);
        this.#syncEnabledLintRulesFromModel(this.model);
        this.#syncEnabledCodemodsFromModel(this.model);
        this.requestUpdate();
    };

    #showFormatDetails = false;

    #showLintDetails = false;

    #showCodemodDetails = false;

    #formatSearchQuery = "";

    #lintSearchQuery = "";

    #codemodSearchQuery = "";

    /**
     * Renders playground output (error, formatted code, or AST JSON).
     *
     * Lit templates are whitespace-sensitive: any indentation or newlines
     * between the opening and closing tags become text nodes in the DOM.
     * This produces unwanted visual padding in the output pane and violates
     * the test assertion that no whitespace precedes content. All templates
     * must keep their content on a single line with no leading/trailing
     * whitespace.
     */
    #renderDiff(actual: string, expected: string): unknown {
        const changes = diffLines(expected, actual);
        const linesHtml = changes.flatMap((change) => {
            const lines = change.value.split(/\r?\n/);
            if (lines.length > 0 && lines.at(-1) === "") {
                lines.pop();
            }
            return lines.map((line) => {
                const highlighted = unsafeHTML(SyntaxHighlight.highlightGml(line));
                if (change.added) {
                    return html`<div class="diff-line diff-added"><span class="diff-sign">+</span>${highlighted}</div>`;
                }
                if (change.removed) {
                    return html`<div class="diff-line diff-removed">
                        <span class="diff-sign">-</span>${highlighted}
                    </div>`;
                }
                return html`<div class="diff-line diff-unchanged"><span class="diff-sign"> </span>${highlighted}</div>`;
            });
        });
        return html`<pre class="playground-output diff-container" aria-live="polite">${linesHtml}</pre>`;
    }

    #renderOutput(message: string | null, viewMode: "code" | "ast", highlighted: string, astJson: string): unknown {
        if (message !== null) {
            return html`<div class="playground-output is-error" role="status" aria-live="polite">${message}</div>`;
        }
        if (viewMode === "code") {
            if (this.#expectedGml !== null) {
                return this.#renderDiff(this.#gmlOutput, this.#expectedGml);
            }
            return html`<div class="playground-output" aria-live="polite">${unsafeHTML(highlighted)}</div>`;
        }
        return html`<pre class="playground-output" aria-live="polite">${astJson}</pre>`;
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
        this.#sessionController.setInput(target.value);
    };

    readonly #onInputScroll = (e: Event): void => {
        const target = e.target as HTMLTextAreaElement;
        const pre = this.renderRoot.querySelector(".playground-input-highlight");
        if (pre) {
            pre.scrollTop = target.scrollTop;
            pre.scrollLeft = target.scrollLeft;
        }
    };

    #onSelectFixture(fixtureId: string): void {
        this.#selectedFixtureId = fixtureId;
        const fixture = this.#fixtures.find((f) => f.caseId === fixtureId);
        if (!fixture) {
            this.#selectedFixtureId = "";
            this.#expectedGml = null;
            this.#syncEnabledFormatOptionsFromModel(this.model);
            this.#syncEnabledLintRulesFromModel(this.model);
            this.#syncEnabledCodemodsFromModel(this.model);
            void this.#processInput();
            this.requestUpdate();
            return;
        }

        this.#expectedGml = fixture.expectedGml;

        // Apply rules configured in the fixture config
        const formatOptions = this.#resolveFormatOptions();
        for (const option of formatOptions) {
            const hasValue = fixture.config[option.name] !== undefined;
            this.#enabledFormatOptions.set(option.name, hasValue);
        }

        const lintRules = this.#resolveLintRules();
        for (const rule of lintRules) {
            this.#enabledLintRules.set(rule.ruleId, false);
        }
        if (fixture.config.lintRules && typeof fixture.config.lintRules === "object") {
            const lintRulesObj = fixture.config.lintRules as Record<string, unknown>;
            for (const [ruleId, val] of Object.entries(lintRulesObj)) {
                if (val !== "off") {
                    this.#enabledLintRules.set(ruleId, true);
                }
            }
        }

        const codemods = this.#resolveCodemods();
        for (const codemod of codemods) {
            this.#enabledCodemods.set(codemod.id, false);
        }
        if (fixture.config.refactor && typeof fixture.config.refactor === "object") {
            const refactor = fixture.config.refactor as Record<string, unknown>;
            if (refactor.codemods && typeof refactor.codemods === "object") {
                const codemodsObj = refactor.codemods as Record<string, unknown>;
                for (const codemodId of Object.keys(codemodsObj)) {
                    this.#enabledCodemods.set(codemodId, true);
                }
            }
        }

        this.#sessionController.setInput(fixture.inputGml);
        this.#sessionController.flushProcessing();
        this.requestUpdate();
    }

    #isFormatOrIntegrationFixtureSelected(): boolean {
        if (!this.#selectedFixtureId) return false;
        const fixture = this.#fixtures.find((f) => f.caseId === this.#selectedFixtureId);
        return fixture?.kind === "format" || fixture?.kind === "integration";
    }

    #isLintOrIntegrationFixtureSelected(): boolean {
        if (!this.#selectedFixtureId) return false;
        const fixture = this.#fixtures.find((f) => f.caseId === this.#selectedFixtureId);
        return fixture?.kind === "lint" || fixture?.kind === "integration";
    }

    #isRefactorOrIntegrationFixtureSelected(): boolean {
        if (!this.#selectedFixtureId) return false;
        const fixture = this.#fixtures.find((f) => f.caseId === this.#selectedFixtureId);
        return fixture?.kind === "refactor" || fixture?.kind === "integration";
    }

    async #processInput(): Promise<void> {
        this.#error = null;
        const currentInput = this.#sessionController.input;
        if (!currentInput.trim()) {
            this.#gmlOutput = "";
            this.#astJson = "";
            return;
        }

        const formatOptions = this.#resolveFormatOptions();
        const lintRules = this.#resolveLintRules();
        const codemods = this.#resolveCodemods();
        const configuredFormatOptionNames = this.#extractConfiguredFormatOptionNames();
        const enabledFormatOptionNames = this.#resolveEnabledFormatOptionNames(formatOptions).filter((optionName) =>
            configuredFormatOptionNames.has(optionName)
        );
        const enabledLintRuleIds = this.#resolveEnabledLintRuleIds(lintRules);
        const enabledCodemodIds = this.#resolveEnabledCodemodIds(codemods);

        try {
            const response = await fetch("/api/playground/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    gml: currentInput,
                    format: enabledFormatOptionNames.length > 0 || this.#isFormatOrIntegrationFixtureSelected(),
                    formatOptionNames: enabledFormatOptionNames,
                    lint: enabledLintRuleIds.length > 0 || this.#isLintOrIntegrationFixtureSelected(),
                    lintRuleIds: enabledLintRuleIds,
                    refactor: enabledCodemodIds.length > 0 || this.#isRefactorOrIntegrationFixtureSelected(),
                    codemodIds: enabledCodemodIds,
                    transpileMode: this.#transpileMode,
                    fixtureId: this.#selectedFixtureId || undefined
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
        return this.#resolveFormatOptionsForModel(this.model);
    }

    #extractConfiguredFormatOptionNames(): ReadonlySet<string> {
        if (this.#selectedFixtureId) {
            const fixture = this.#fixtures.find((f) => f.caseId === this.#selectedFixtureId);
            if (fixture && fixture.config) {
                const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
                const allFormatOptions = new Set((workspaceRules?.formatOptions ?? []).map((o) => o.name));
                const configuredEntries = this.model?.projectConfigurationCatalog?.format.entries;
                if (configuredEntries) {
                    for (const entry of configuredEntries) {
                        allFormatOptions.add(entry.name);
                    }
                }
                const fixtureConfigKeys = Object.keys(fixture.config);
                return new Set(fixtureConfigKeys.filter((key) => allFormatOptions.has(key)));
            }
        }
        const configuredEntries = this.model?.projectConfigurationCatalog?.format.entries;
        if (!configuredEntries || configuredEntries.length === 0) {
            return new Set<string>();
        }
        return new Set(configuredEntries.map((entry) => entry.name));
    }

    #resolveFormatOptionsForModel(
        model: GraphVisualizationUiModel | null
    ): ReadonlyArray<{ description: string; name: string }> {
        const workspaceRules = model?.documentationCatalogs?.workspaceRules;
        const configuredEntries = model?.projectConfigurationCatalog?.format.entries;
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

    #resolveLintRulesForModel(
        model: GraphVisualizationUiModel | null
    ): ReadonlyArray<{ description: string; ruleId: string }> {
        const workspaceRules = model?.documentationCatalogs?.workspaceRules;
        const configuredRules = model?.projectConfigurationCatalog?.lint.rules;
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

    #resolveCodemodsForModel(
        model: GraphVisualizationUiModel | null
    ): ReadonlyArray<{ description: string; id: string }> {
        const workspaceRules = model?.documentationCatalogs?.workspaceRules;
        const configuredCodemods = model?.projectConfigurationCatalog?.refactor.codemods;
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
                ${
                    parameters.expanded
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
                                  ${
                                  filteredEntries.length === parameters.entries.length
                                      ? `${parameters.entries.length} items`
                                      : `${filteredEntries.length} of ${parameters.entries.length} items`
                              }
                              </div>
                          `
                        : null
                }
            </div>
        `;
    }

    #renderRuleDetails() {
        const formatOptions = this.#resolveFormatOptions();
        const hasConfiguredFormatOptions = this.#extractConfiguredFormatOptionNames().size > 0;
        const lintRules = this.#resolveLintRules();
        const codemods = this.#resolveCodemods();
        if (formatOptions.length === 0 && lintRules.length === 0 && codemods.length === 0) {
            return html``;
        }

        return html`
            <div class="rule-details">
                ${
                    formatOptions.length > 0
                        ? html`
                              ${
                              hasConfiguredFormatOptions
                                  ? null
                                  : html`<p class="rule-details-note" role="note">
                                        Set formatter values in <code>gmloop.json</code> to apply Playground format
                                        options.
                                    </p>`
                          }
                              ${this.#renderRuleSection({
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
                          })}
                          `
                        : null
                }
                ${
                    lintRules.length > 0
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
                        : null
                }
                ${
                    codemods.length > 0
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
                        : null
                }
            </div>
        `;
    }

    #renderFixtureSelector() {
        return html`
            <div class="playground-control-section">
                <div class="playground-control-section-header">
                    <label for="playground-fixture-select">Fixture Test</label>
                    <span class="playground-control-section-note">Load test case</span>
                </div>
                <select
                    id="playground-fixture-select"
                    class="gm-select playground-fixture-select"
                    @change=${(e: Event) => {
                        const target = e.target as HTMLSelectElement;
                        this.#onSelectFixture(target.value);
                    }}
                >
                    <option value="">None (Custom Input)</option>
                    ${this.#fixtures.map(
                        (fixture) => html`
                            <option value=${fixture.caseId} ?selected=${this.#selectedFixtureId === fixture.caseId}>
                                [${fixture.kind}] ${fixture.caseId}
                            </option>
                        `
                    )}
                </select>
            </div>
        `;
    }

    #renderViewModeControls() {
        return html`
            <div class="playground-control-section">
                <div class="playground-control-section-header">
                    <span>View Mode</span>
                    <span class="playground-control-section-note">Output representation</span>
                </div>
                <div class="rule-toggles">
                    <button
                        type="button"
                        class="rule-toggle ${this.#viewMode === "code" ? "active" : ""}"
                        aria-pressed=${this.#viewMode === "code"}
                        @click=${() => this.#setViewMode("code")}
                    >
                        Output Code
                    </button>
                    <button
                        type="button"
                        class="rule-toggle ${this.#viewMode === "ast" ? "active" : ""}"
                        aria-pressed=${this.#viewMode === "ast"}
                        @click=${() => this.#setViewMode("ast")}
                    >
                        AST View
                    </button>
                </div>
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
        const isOpen = this.state?.playgroundControlsOpen === true;
        return html`
            <aside
                id="playground-controls-panel"
                class="playground-controls-panel ${isOpen ? "is-open" : "is-collapsed"}"
                aria-label="Playground controls"
            >
                <div class="playground-controls-body">
                    ${this.#renderFixtureSelector()} ${this.#renderViewModeControls()}
                    ${this.#renderTranspileControls()} ${this.#renderRuleDetails()}
                </div>
            </aside>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const isOpen = this.state.playgroundControlsOpen === true;
        const activeClassName =
            this.state.activePage === "playground" ? "page content-page active" : "page content-page";
        const controlsPanelClassName = isOpen
            ? "playground-layout controls-open"
            : "playground-layout controls-collapsed";

        return html`
            <section id="playground-page" class=${activeClassName}>
                ${
                    this.state.playgroundErrorMessage
                        ? html`<gm-error-banner .message=${this.state.playgroundErrorMessage}></gm-error-banner>`
                        : null
                }
                <div class=${controlsPanelClassName}>
                    <div class="playground-main">
                        <div class="editor-pane">
                            <div class="pane-header">
                                <span>Input GML</span>
                                <span class="pane-header-status">Writable</span>
                            </div>
                            <div class="playground-input-surface">
                                <pre class="playground-input-highlight" aria-hidden="true">
${unsafeHTML(SyntaxHighlight.highlightGml(this.#sessionController.input))}</pre>
                                <textarea
                                    class="playground-input"
                                    aria-label="Playground input GML"
                                    placeholder="Paste or write GML code here..."
                                    .value=${this.#sessionController.input}
                                    @input=${this.#onInputChange}
                                    @scroll=${this.#onInputScroll}
                                    spellcheck="false"
                                ></textarea>
                            </div>
                        </div>
                        <div class="editor-pane">
                            <div class="pane-header">
                                <span
                                    >${
                                        this.#viewMode === "code"
                                            ? this.#transpileMode === "none"
                                                ? "GML"
                                                : "JS"
                                            : "Parsed AST"
                                    }</span
                                >
                                <span class="pane-header-status">Read-only</span>
                            </div>
                            ${this.#renderOutput(
                                this.#error,
                                this.#viewMode,
                                SyntaxHighlight.highlightGml(this.#gmlOutput),
                                this.#astJson
                            )}
                        </div>
                    </div>
                    ${this.#renderControlsPanel()}
                </div>
            </section>
        `;
    }

    /** @internal */
    public setFixturesForTest(fixtures: ReadonlyArray<PlaygroundFixture>): void {
        this.#fixtures = fixtures;
        this.requestUpdate();
    }

    /** @internal */
    public syncEnabledStateFromModelForTest(): void {
        this.#onModelChange();
    }

    /** @internal */
    public selectFixtureForTest(fixtureId: string): void {
        this.#onSelectFixture(fixtureId);
    }

    /** @internal */
    public getSelectedFixtureIdForTest(): string {
        return this.#selectedFixtureId;
    }

    /** @internal */
    public setExpandedSectionsForTest(format: boolean, lint: boolean, codemod: boolean): void {
        this.#showFormatDetails = format;
        this.#showLintDetails = lint;
        this.#showCodemodDetails = codemod;
        this.requestUpdate();
    }

    /** @internal */
    public setOutputForTest(gmlOutput: string, expectedGml: string | null): void {
        this.#gmlOutput = gmlOutput;
        this.#expectedGml = expectedGml;
        this.#error = null;
        this.requestUpdate();
    }
}
