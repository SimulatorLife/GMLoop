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
