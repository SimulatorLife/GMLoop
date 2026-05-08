// import { Format } from "@gmloop/format";
// import { Parser } from "@gmloop/parser";
// import { Refactor } from "@gmloop/refactor";
import { Core } from "@gmloop/core";
import { html, type PropertyValues } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
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

    #gmlInput = "";

    #gmlOutput = "";

    #astJson = "";

    #viewMode: "code" | "ast" = "code";

    #isFormatEnabled = true;

    #isLintEnabled = false;

    #isRefactorEnabled = false;

    #error: string | null = null;

    #debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    protected firstUpdated(): void {
        const savedInput = localStorage.getItem("gmloop-playground-input");
        if (savedInput) {
            this.#gmlInput = savedInput;
            void this.#processInput();
        }
    }

    protected updated(changedProperties: PropertyValues): void {
        super.updated(changedProperties);
        if (changedProperties.has("state") && this.state?.activePage === "playground") {
            void this.#processInput();
        }
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

        try {
            const response = await fetch("/api/playground/process", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    gml: this.#gmlInput,
                    format: this.#isFormatEnabled,
                    lint: this.#isLintEnabled,
                    refactor: this.#isRefactorEnabled
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

    #setViewMode(mode: "code" | "ast"): void {
        this.#viewMode = mode;
        this.requestUpdate();
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
                    </div>
                    <div style="flex: 1"></div>
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

                <div class="playground-main">
                    <div class="editor-pane">
                        <div class="pane-header">
                            <span>Input GML</span>
                            <span style="opacity: 0.5">Writable</span>
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
                            <span>${this.#viewMode === "code" ? "Processed Result" : "Parsed AST"}</span>
                            <span style="opacity: 0.5">Read-only</span>
                        </div>
                        ${this.#error
                            ? html`<div
                                  class="playground-output"
                                  style="color: #ff8080; background: rgba(255, 0, 0, 0.05)"
                              >
                                  ${this.#error}
                              </div>`
                            : this.#viewMode === "code"
                              ? html`<pre class="playground-output">${this.#gmlOutput}</pre>`
                              : html`<pre class="playground-output">${this.#astJson}</pre>`}
                    </div>
                </div>
            </section>
        `;
    }
}
