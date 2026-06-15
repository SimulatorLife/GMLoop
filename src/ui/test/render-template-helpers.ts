import { Core } from "@gmloop/core";
import type { TemplateResult } from "lit";

/**
 * Shape used by tests that need to invoke Lit's lifecycle hooks directly
 * without going through a full element update cycle.
 */
export type PropertyValuesForTest = Map<PropertyKey, unknown>;

export function isTemplateResult(value: unknown): value is TemplateResult {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}

export function renderTemplateValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map((entry) => renderTemplateValue(entry)).join("");
    }

    if (isTemplateResult(value)) {
        let output = "";
        for (const [index, stringPart] of value.strings.entries()) {
            output += stringPart;
            if (index < value.values.length) {
                output += renderTemplateValue(value.values[index]);
            }
        }
        return output;
    }

    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    return JSON.stringify(value) ?? "";
}

/**
 * Locates the first function value embedded in a Lit template's `values`
 * array. Tests use this to invoke event handlers (such as `@click`) directly,
 * without standing up a real DOM event loop.
 */
export function findEventHandlerInTemplate(rendered: unknown): (...args: never[]) => unknown {
    if (!isTemplateResult(rendered)) {
        throw new Error("Expected a Lit template result.");
    }

    const handler = rendered.values.find(
        (value): value is (...args: never[]) => unknown => typeof value === "function"
    );
    if (handler === undefined) {
        throw new Error("Expected a Lit template result to contain an event handler.");
    }
    return handler;
}

/**
 * Builds a regex that matches a rendered `<button>` element with a specific id and aria-pressed value.
 * Uses lookahead assertions so attribute order does not affect the match.
 */
export function createButtonAriaPressedPattern(buttonId: string, pressed: boolean): RegExp {
    return new RegExp(
        `<button(?=[^>]*id="${Core.escapeRegExp(buttonId)}")(?=[^>]*aria-pressed=(?:"${String(pressed)}"|${String(pressed)}))[^>]*>`,
        "u"
    );
}
