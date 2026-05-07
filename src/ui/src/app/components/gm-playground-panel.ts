import { Format } from "@gmloop/format";
import { Parser } from "@gmloop/parser";
import { Refactor } from "@gmloop/refactor";
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

    #debounceTimer: number | null = null;

    protected firstUpdated(): void {
        const savedInput = localStorage.getItem("gmloop-playground-input");
        if (savedInput) {
            this.#gmlInput = savedInput;
            this.#processInput();
        }
    }

    protected updated(changedProperties: PropertyValues): void {
        super.updated(changedProperties);
        if (changedProperties.has("state") && this.state?.activePage === "playground") {
            this.#processInput();
        }
    }

    readonly #onInputChange = (e: Event): void => {
        const target = e.target as HTMLTextAreaElement;
        this.#gmlInput = target.value;
        localStorage.setItem("gmloop-playground-input", this.#gmlInput);

        if (this.#debounceTimer) {
            clearTimeout(this.#debounceTimer);
        }

        this.#debounceTimer = globalThis.setTimeout(() => {
            this.#processInput();
            this.requestUpdate();
        }, 300);

        this.requestUpdate();
    };

    #processInput(): void {
        this.#error = null;
        if (!this.#gmlInput.trim()) {
            this.#gmlOutput = "";
            this.#astJson = "";
            return;
        }

        try {
            // 1. Parse for AST
            const gmlParser = new Parser.GMLParser(this.#gmlInput);
            const program = gmlParser.parse();
            this.#astJson = JSON.stringify(
                program,
                (key, value) => {
                    if (key === "parent" || key === "sourceRange") return undefined;
                    return value;
                },
                2
            );

            // 2. Apply rules sequentially
            let result = this.#gmlInput;

            if (this.#isRefactorEnabled) {
                const codemodResult = Refactor.LoopLengthHoisting.applyLoopLengthHoistingCodemod(result);
                result = codemodResult.outputText;
            }

            if (this.#isLintEnabled) {
                // Note: Full ESLint autofixes are not fully supported in the browser build yet,
                // but this acts as a placeholder where a browser-safe linter bundle would run.
                // For demonstration, we could apply simple syntactic checks or string replacements.
                // Right now it just passes through.
            }

            if (this.#isFormatEnabled) {
                void Format.format(result)
                    .then((formatted) => {
                        this.#gmlOutput = formatted;
                        this.requestUpdate();
                    })
                    .catch((error) => {
                        this.#error = `Formatting error: ${error.message}`;
                        this.requestUpdate();
                    });
            } else {
                this.#gmlOutput = result;
            }
        } catch (error) {
            this.#error = error instanceof Error ? error.message : String(error);
            this.#gmlOutput = "";
            this.#astJson = "";
        }
    }

    #toggleFormat(): void {
        this.#isFormatEnabled = !this.#isFormatEnabled;
        this.#processInput();
        this.requestUpdate();
    }

    #toggleLint(): void {
        this.#isLintEnabled = !this.#isLintEnabled;
        this.#processInput();
        this.requestUpdate();
    }

    #toggleRefactor(): void {
        this.#isRefactorEnabled = !this.#isRefactorEnabled;
        this.#processInput();
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
                        <div
                            class="rule-toggle ${this.#isFormatEnabled ? "active" : ""}"
                            @click=${() => this.#toggleFormat()}
                        >
                            Format
                        </div>
                        <div
                            class="rule-toggle ${this.#isLintEnabled ? "active" : ""}"
                            @click=${() => this.#toggleLint()}
                        >
                            Lint
                        </div>
                        <div
                            class="rule-toggle ${this.#isRefactorEnabled ? "active" : ""}"
                            @click=${() => this.#toggleRefactor()}
                        >
                            Refactor
                        </div>
                    </div>
                    <div style="flex: 1"></div>
                    <div class="view-selector">
                        <div
                            class="view-option ${this.#viewMode === "code" ? "active" : ""}"
                            @click=${() => this.#setViewMode("code")}
                        >
                            Output Code
                        </div>
                        <div
                            class="view-option ${this.#viewMode === "ast" ? "active" : ""}"
                            @click=${() => this.#setViewMode("ast")}
                        >
                            AST View
                        </div>
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
