import type { Rule } from "eslint";

export function readObjectOption(context: Rule.RuleContext): Record<string, unknown> {
    if (!Array.isArray(context.options)) {
        return Object.freeze({});
    }

    const [rawOption] = context.options;
    if (!rawOption || typeof rawOption !== "object") {
        return Object.freeze({});
    }

    return rawOption as Record<string, unknown>;
}

export function shouldReportUnsafe(context: Rule.RuleContext): boolean {
    const option = readObjectOption(context).reportUnsafe;
    return option === undefined ? true : option === true;
}
