import { html, nothing } from "lit";

import { LightDomLitElement } from "../light-dom-lit-element.js";

/**
 * Sentinel returned by {@link GmJsonViewer.#resolveParsedValue} when the
 * component's `value` is a string that cannot be parsed as JSON. Kept
 * distinct from `unknown` parsed data so the render path can fall back to a
 * plain-text view without confusing "valid JSON that happens to be `null`"
 * with "not JSON at all".
 */
const JSON_PARSE_FAILURE = Symbol("gm-json-viewer-parse-failure");

/** A JSON object node, keyed by property name. */
type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A single renderable entry inside a JSON object or array: `[key, value]`. */
type JsonEntry = readonly [key: string, value: unknown];

function toJsonEntries(value: JsonRecord | readonly unknown[]): readonly JsonEntry[] {
    if (Array.isArray(value)) {
        return value.map((entry, index) => [String(index), entry] as JsonEntry);
    }
    return Object.entries(value);
}

/**
 * Recursively collects the path of every collapsible object/array node
 * reachable from `value`, including `value` itself when it is a container.
 * Used to implement "collapse all" without walking the tree twice.
 */
function collectContainerPaths(value: unknown, path: string, into: Set<string>): void {
    if (!isJsonRecord(value) && !Array.isArray(value)) {
        return;
    }
    into.add(path);
    for (const [key, entryValue] of toJsonEntries(value)) {
        collectContainerPaths(entryValue, `${path}.${key}`, into);
    }
}

/**
 * Reusable read-only JSON viewer primitive.
 *
 * Renders any JSON-shaped `value` (a JSON string or an already-parsed
 * object/array/primitive) as an indented, syntax-highlighted tree in which
 * every object and array node can be collapsed or expanded independently,
 * alongside a "Collapse all" / "Expand all" toggle. A {@link GmCopyButton}
 * is always rendered next to the tree so the underlying raw JSON text can be
 * copied verbatim regardless of the current collapse state.
 *
 * When `value` is a string that fails to parse as JSON (or is empty), the
 * component falls back to a plain preformatted view of the raw text rather
 * than erroring, so it stays safe to use for payloads that are usually — but
 * not guaranteed to be — valid JSON.
 */
export class GmJsonViewer extends LightDomLitElement {
    public static properties = {
        compact: { reflect: true, type: Boolean },
        copyAccessibleLabel: { type: String },
        copyLabel: { type: String },
        value: { attribute: false }
    };

    /**
     * Renders a smaller, icon-only copy button and omits the "Collapse all" toggle.
     * Intended for small inline JSON previews (e.g. a single lint rule's options)
     * where a full toolbar would overwhelm the content. Per-node collapse/expand
     * toggles remain available either way.
     */
    public accessor compact = false;

    /** Accessible label handed to the copy button, e.g. "Copy graph JSON to clipboard". */
    public accessor copyAccessibleLabel = "Copy JSON to clipboard";

    /** Visible label handed to the copy button. */
    public accessor copyLabel = "Copy JSON";

    /** The JSON payload to render: either a raw JSON string or an already-parsed value. */
    public accessor value: unknown = null;

    /** Paths (see {@link collectContainerPaths}) of container nodes currently collapsed. */
    #collapsedPaths = new Set<string>();

    protected render() {
        const rawText = this.#resolveRawText();
        const parsedValue = this.#resolveParsedValue(rawText);

        return html`
            <div class="gm-json-viewer">
                <div class="gm-json-viewer__toolbar">
                    <gm-copy-button
                        class="gm-json-viewer__copy"
                        .value=${rawText}
                        accessibleLabel=${this.copyAccessibleLabel}
                        label=${this.copyLabel}
                        ?hideLabel=${this.compact}
                    ></gm-copy-button>
                    ${
                        this.compact || parsedValue === JSON_PARSE_FAILURE
                            ? nothing
                            : this.#renderCollapseAllToggle(parsedValue)
                    }
                </div>
                ${
                    parsedValue === JSON_PARSE_FAILURE
                        ? html`<pre class="gm-json-viewer__raw">${rawText}</pre>`
                        : html`<div class="gm-json-viewer__tree">${this.#renderValue(parsedValue, "$", 0)}</div>`
                }
            </div>
        `;
    }

    #renderCollapseAllToggle(parsedValue: unknown) {
        const isAnyCollapsed = this.#collapsedPaths.size > 0;
        return html`
            <button
                type="button"
                class="gm-json-viewer__collapse-all"
                @click=${() => this.#toggleAll(parsedValue, isAnyCollapsed)}
            >
                ${isAnyCollapsed ? "Expand all" : "Collapse all"}
            </button>
        `;
    }

    #toggleAll(parsedValue: unknown, isCurrentlyAnyCollapsed: boolean): void {
        if (isCurrentlyAnyCollapsed) {
            this.#collapsedPaths = new Set();
            this.requestUpdate();
            return;
        }

        const allPaths = new Set<string>();
        collectContainerPaths(parsedValue, "$", allPaths);
        this.#collapsedPaths = allPaths;
        this.requestUpdate();
    }

    #toggleNode(path: string): void {
        if (this.#collapsedPaths.has(path)) {
            this.#collapsedPaths.delete(path);
        } else {
            this.#collapsedPaths.add(path);
        }
        this.requestUpdate();
    }

    #renderValue(value: unknown, path: string, depth: number): unknown {
        if (Array.isArray(value)) {
            return this.#renderContainer(value, path, depth, true);
        }
        if (isJsonRecord(value)) {
            return this.#renderContainer(value, path, depth, false);
        }
        return this.#renderPrimitive(value);
    }

    #renderContainer(value: JsonRecord | readonly unknown[], path: string, depth: number, isArray: boolean) {
        const entries = toJsonEntries(value);
        const openBracket = isArray ? "[" : "{";
        const closeBracket = isArray ? "]" : "}";

        if (entries.length === 0) {
            return html`<span class="gm-json-viewer__bracket">${openBracket}${closeBracket}</span>`;
        }

        const isCollapsed = this.#collapsedPaths.has(path);
        const summary = `${entries.length} ${isArray ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"}`;
        const toggleLabel = isCollapsed
            ? `Expand ${isArray ? "array" : "object"}`
            : `Collapse ${isArray ? "array" : "object"}`;

        return html`
            <button
                type="button"
                class="gm-json-viewer__toggle"
                aria-expanded=${isCollapsed ? "false" : "true"}
                aria-label=${toggleLabel}
                @click=${() => this.#toggleNode(path)}
            >
                <span class="gm-json-viewer__toggle-icon" aria-hidden="true">${isCollapsed ? "▸" : "▾"}</span>
            </button>
            <span class="gm-json-viewer__bracket">${openBracket}</span>
            ${
                isCollapsed
                    ? html`<span class="gm-json-viewer__summary">${summary}</span
                          ><span class="gm-json-viewer__bracket">${closeBracket}</span>`
                    : html`<div class="gm-json-viewer__children">
                              ${entries.map(([key, entryValue], index) =>
                                  this.#renderEntry(key, entryValue, path, isArray, depth, index === entries.length - 1)
                              )}
                          </div>
                          <span class="gm-json-viewer__bracket gm-json-viewer__bracket--close">${closeBracket}</span>`
            }
        `;
    }

    #renderEntry(key: string, value: unknown, parentPath: string, isArray: boolean, depth: number, isLast: boolean) {
        const path = `${parentPath}.${key}`;
        const keyPrefix = isArray
            ? nothing
            : html`<span class="gm-json-viewer__key">"${key}"</span
                  ><span class="gm-json-viewer__punctuation">:</span> `;
        const trailingComma = isLast ? nothing : html`<span class="gm-json-viewer__punctuation">,</span>`;

        return html`
            <div class="gm-json-viewer__row" style=${`--gm-json-viewer-depth: ${depth + 1}`}>
                ${keyPrefix}${this.#renderValue(value, path, depth + 1)}${trailingComma}
            </div>
        `;
    }

    #renderPrimitive(value: unknown) {
        if (value === null) {
            return html`<span class="gm-json-viewer__null">null</span>`;
        }
        if (typeof value === "string") {
            return html`<span class="gm-json-viewer__string">"${value}"</span>`;
        }
        if (typeof value === "number") {
            return html`<span class="gm-json-viewer__number">${value}</span>`;
        }
        if (typeof value === "boolean") {
            return html`<span class="gm-json-viewer__boolean">${value}</span>`;
        }
        return html`<span class="gm-json-viewer__unknown">${String(value)}</span>`;
    }

    #resolveRawText(): string {
        if (typeof this.value === "string") {
            return this.value;
        }
        if (this.value === null || this.value === undefined) {
            return "";
        }
        return JSON.stringify(this.value, null, 2);
    }

    #resolveParsedValue(rawText: string): unknown {
        if (typeof this.value !== "string") {
            return this.value;
        }
        if (rawText.trim().length === 0) {
            return JSON_PARSE_FAILURE;
        }
        try {
            return JSON.parse(rawText) as unknown;
        } catch {
            return JSON_PARSE_FAILURE;
        }
    }
}
