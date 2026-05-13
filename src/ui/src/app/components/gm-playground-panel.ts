import { Core } from "@gmloop/core";
import { html, type PropertyValues } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
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

    #gmlInput = DEFAULT_PLAYGROUND_GML_SOURCE;

    #gmlOutput = "";

    #astJson = "";

    #viewMode: "code" | "ast" = "code";

    #isFormatEnabled = true;

    #isLintEnabled = true;

    #isRefactorEnabled = true;

    #transpileMode: "none" | "patch" | "expression" = "none";

    #error: string | null = null;

    #debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    #enabledLintRules = new Map<string, boolean>();

    #enabledFormatOptions = new Map<string, boolean>();

    #enabledCodemods = new Map<string, boolean>();

    #showFormatDetails = false;

    #showLintDetails = false;

    #showCodemodDetails = false;

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
        void this.#processInput();
    }

    protected updated(changedProperties: PropertyValues): void {
        super.updated(changedProperties);
        if (changedProperties.has("state") && this.state?.activePage === "playground") {
            void this.#processInput();
        }
    }

    #toggleFormatOption(optionName: string): void {
        const current = this.#enabledFormatOptions.get(optionName) ?? true;
        this.#enabledFormatOptions.set(optionName, !current);
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleLintRule(ruleId: string): void {
        const current = this.#enabledLintRules.get(ruleId) ?? true;
        this.#enabledLintRules.set(ruleId, !current);
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleCodemod(codemodId: string): void {
        const current = this.#enabledCodemods.get(codemodId) ?? true;
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
                    format: this.#isFormatEnabled,
                    formatOptionNames: enabledFormatOptionNames,
                    lint: this.#isLintEnabled,
                    lintRuleIds: enabledLintRuleIds,
                    refactor: this.#isRefactorEnabled,
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
            this.#error = Core.getErrorMessage(error, { fallback: "Unknown error" });
            this.#gmlOutput = "";
            this.#astJson = "";
        }

        this.requestUpdate();
    }

    #resolveFormatOptions(): ReadonlyArray<{ description: string; name: string }> {
        const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
        return this.model?.projectConfigurationCatalog?.format.entries ?? workspaceRules?.formatOptions ?? [];
    }

    #resolveLintRules(): ReadonlyArray<{ description: string; ruleId: string }> {
        const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
        return this.model?.projectConfigurationCatalog?.lint.rules ?? workspaceRules?.lintRules ?? [];
    }

    #resolveCodemods(): ReadonlyArray<{ description: string; id: string }> {
        const workspaceRules = this.model?.documentationCatalogs?.workspaceRules;
        return this.model?.projectConfigurationCatalog?.refactor.codemods ?? workspaceRules?.refactorCodemods ?? [];
    }

    #resolveEnabledFormatOptionNames(
        formatOptions: ReadonlyArray<{ description: string; name: string }>
    ): ReadonlyArray<string> {
        return formatOptions
            .filter((option) => this.#enabledFormatOptions.get(option.name) ?? true)
            .map((option) => option.name);
    }

    #resolveEnabledLintRuleIds(
        lintRules: ReadonlyArray<{ description: string; ruleId: string }>
    ): ReadonlyArray<string> {
        return lintRules.filter((rule) => this.#enabledLintRules.get(rule.ruleId) ?? true).map((rule) => rule.ruleId);
    }

    #resolveEnabledCodemodIds(codemods: ReadonlyArray<{ description: string; id: string }>): ReadonlyArray<string> {
        return codemods.filter((codemod) => this.#enabledCodemods.get(codemod.id) ?? true).map((codemod) => codemod.id);
    }

    #toggleFormat(): void {
        this.#isFormatEnabled = !this.#isFormatEnabled;
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleLint(): void {
        this.#isLintEnabled = !this.#isLintEnabled;
        void this.#processInput();
        this.requestUpdate();
    }

    #toggleRefactor(): void {
        this.#isRefactorEnabled = !this.#isRefactorEnabled;
        void this.#processInput();
        this.requestUpdate();
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

    #renderFormatOptionToggle(formatOption: { description: string; name: string }) {
        const isEnabled = this.#enabledFormatOptions.get(formatOption.name) ?? true;
        return html`
            <button
                type="button"
                class="rule-toggle ${isEnabled ? "active" : ""}"
                aria-pressed=${isEnabled}
                title=${formatOption.description}
                @click=${() => this.#toggleFormatOption(formatOption.name)}
            >
                ${formatOption.name}
            </button>
        `;
    }

    #renderLintRuleToggle(rule: { ruleId: string; description: string }) {
        const isEnabled = this.#enabledLintRules.get(rule.ruleId) ?? true;
        return html`
            <button
                type="button"
                class="rule-toggle ${isEnabled ? "active" : ""}"
                aria-pressed=${isEnabled}
                title=${rule.description}
                @click=${() => this.#toggleLintRule(rule.ruleId)}
            >
                ${rule.ruleId}
            </button>
        `;
    }

    #renderCodemodToggle(codemod: { description: string; id: string }) {
        const isEnabled = this.#enabledCodemods.get(codemod.id) ?? true;
        return html`
            <button
                type="button"
                class="rule-toggle ${isEnabled ? "active" : ""}"
                aria-pressed=${isEnabled}
                title=${codemod.description}
                @click=${() => this.#toggleCodemod(codemod.id)}
            >
                ${codemod.id}
            </button>
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
                ${this.#isFormatEnabled && formatOptions.length > 0
                    ? html`
                          <div class="rule-details-section">
                              <button
                                  type="button"
                                  class="rule-details-header ${this.#showFormatDetails ? "expanded" : ""}"
                                  @click=${() => this.#toggleFormatDetails()}
                              >
                                  <span class="rule-details-header-icon">${this.#showFormatDetails ? "▾" : "▸"}</span>
                                  <span class="rule-details-header-label">Format Options</span>
                                  <span class="rule-details-count">${formatOptions.length}</span>
                              </button>
                              ${this.#showFormatDetails
                                  ? html`
                                        <div class="rule-details-content">
                                            ${formatOptions.map((option) => this.#renderFormatOptionToggle(option))}
                                        </div>
                                    `
                                  : null}
                          </div>
                      `
                    : null}
                ${this.#isLintEnabled && lintRules.length > 0
                    ? html`
                          <div class="rule-details-section">
                              <button
                                  type="button"
                                  class="rule-details-header ${this.#showLintDetails ? "expanded" : ""}"
                                  @click=${() => this.#toggleLintDetails()}
                              >
                                  <span class="rule-details-header-icon">${this.#showLintDetails ? "▾" : "▸"}</span>
                                  <span class="rule-details-header-label">Lint Rules</span>
                                  <span class="rule-details-count">${lintRules.length}</span>
                              </button>
                              ${this.#showLintDetails
                                  ? html`
                                        <div class="rule-details-content">
                                            ${lintRules.map((rule) => this.#renderLintRuleToggle(rule))}
                                        </div>
                                    `
                                  : null}
                          </div>
                      `
                    : null}
                ${this.#isRefactorEnabled && codemods.length > 0
                    ? html`
                          <div class="rule-details-section">
                              <button
                                  type="button"
                                  class="rule-details-header ${this.#showCodemodDetails ? "expanded" : ""}"
                                  @click=${() => this.#toggleCodemodDetails()}
                              >
                                  <span class="rule-details-header-icon">${this.#showCodemodDetails ? "▾" : "▸"}</span>
                                  <span class="rule-details-header-label">Codemods</span>
                                  <span class="rule-details-count">${codemods.length}</span>
                              </button>
                              ${this.#showCodemodDetails
                                  ? html`
                                        <div class="rule-details-content">
                                            ${codemods.map((codemod) => this.#renderCodemodToggle(codemod))}
                                        </div>
                                    `
                                  : null}
                          </div>
                      `
                    : null}
            </div>
        `;
    }

    protected render() {
        if (!this.model || !this.state) {
            return html``;
        }

        const activeClassName = this.state.activePage === "playground" ? "page active" : "page";

        return html`
            <section id="playground-page" class=${activeClassName}>
                <div class="playground-toolbar">
                    <div class="rule-toggles">
                        <button
                            type="button"
                            class="rule-toggle ${this.#isFormatEnabled ? "active" : ""}"
                            aria-pressed=${this.#isFormatEnabled}
                            @click=${() => this.#toggleFormat()}
                        >
                            Format
                        </button>
                        <button
                            type="button"
                            class="rule-toggle ${this.#isLintEnabled ? "active" : ""}"
                            aria-pressed=${this.#isLintEnabled}
                            @click=${() => this.#toggleLint()}
                        >
                            Lint
                        </button>
                        <button
                            type="button"
                            class="rule-toggle ${this.#isRefactorEnabled ? "active" : ""}"
                            aria-pressed=${this.#isRefactorEnabled}
                            @click=${() => this.#toggleRefactor()}
                        >
                            Refactor
                        </button>
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
                    <div class="playground-toolbar-spacer" aria-hidden="true"></div>
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

                ${this.#renderRuleDetails()}
                <div class="playground-main">
                    <div class="editor-pane">
                        <div class="pane-header">
                            <span>Input GML</span>
                            <span class="pane-header-status">Writable</span>
                        </div>
                        <textarea
                            class="playground-input"
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
                            ? html`<div class="playground-output is-error">${this.#error}</div>`
                            : this.#viewMode === "code"
                              ? html`<pre class="playground-output">${this.#gmlOutput}</pre>`
                              : html`<pre class="playground-output">${this.#astJson}</pre>`}
                    </div>
                </div>
            </section>
        `;
    }
}
