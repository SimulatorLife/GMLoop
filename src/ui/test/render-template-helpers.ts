import type { TemplateResult } from "lit";

function isTemplateResult(value: unknown): value is TemplateResult {
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
 * Escapes special regex characters in a literal string value.
 */
function escapeRegexLiteral(value: string): string {
    return value.replaceAll(/[\\^$.*+?()[\]{}|]/gu, String.raw`\$&`);
}

/**
 * Builds a regex that matches a rendered `<button>` element with a specific id and aria-pressed value.
 * Uses lookahead assertions so attribute order does not affect the match.
 */
export function createButtonAriaPressedPattern(buttonId: string, pressed: boolean): RegExp {
    return new RegExp(
        `<button(?=[^>]*id="${escapeRegexLiteral(buttonId)}")(?=[^>]*aria-pressed=(?:"${String(pressed)}"|${String(pressed)}))[^>]*>`,
        "u"
    );
}
