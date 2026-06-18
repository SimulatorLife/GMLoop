import { Core } from "@gmloop/core";
import type { TemplateResult } from "lit";

function isTemplateResult(value: unknown): value is TemplateResult {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}

type RepeatDirectiveResult = Readonly<{
    values: ReadonlyArray<unknown>;
}>;

function isRepeatDirectiveResult(value: unknown): value is RepeatDirectiveResult {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const directive = Reflect.get(value, "_$litDirective$");
    const values = Reflect.get(value, "values");
    return (
        typeof directive === "function" &&
        Array.isArray(values) &&
        values.length === 3 &&
        typeof values[1] === "function" &&
        typeof values[2] === "function"
    );
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

    if (isRepeatDirectiveResult(value)) {
        const [items, , renderItem] = value.values;
        if (
            typeof items === "object" &&
            items !== null &&
            Symbol.iterator in items &&
            typeof renderItem === "function"
        ) {
            return Array.from(items as Iterable<unknown>, (item, index) =>
                renderTemplateValue(Reflect.apply(renderItem, undefined, [item, index]))
            ).join("");
        }
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
 * Builds a regex that matches a rendered `<button>` element with a specific id and aria-pressed value.
 * Uses lookahead assertions so attribute order does not affect the match.
 */
export function createButtonAriaPressedPattern(buttonId: string, pressed: boolean): RegExp {
    return new RegExp(
        `<button(?=[^>]*id="${Core.escapeRegExp(buttonId)}")(?=[^>]*aria-pressed=(?:"${String(pressed)}"|${String(pressed)}))[^>]*>`,
        "u"
    );
}
