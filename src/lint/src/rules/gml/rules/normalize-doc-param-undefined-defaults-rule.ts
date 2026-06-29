import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";

const undefinedOptionalDefaultPattern =
    /^(\s*\/\/\/\s*@param(?:\s+\{[^}\r\n]+\})?\s+)\[([A-Za-z0-9_]+)\s*=\s*undefined\](.*)$/u;

function normalizeUndefinedOptionalDefaultLine(line: string): string {
    const normalized = undefinedOptionalDefaultPattern.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]}[${normalized[2]}]${normalized[3]}`;
}

type SourceLine = Readonly<{
    startOffset: number;
    text: string;
}>;

function collectSourceLines(sourceText: string): ReadonlyArray<SourceLine> {
    const lines: Array<SourceLine> = [];
    const linePattern = /[^\r\n]*(?:\r\n|\r|\n|$)/gu;
    let match: RegExpExecArray | null;
    while ((match = linePattern.exec(sourceText)) !== null) {
        const rawLine = match[0];
        if (rawLine.length === 0 && match.index === sourceText.length) {
            break;
        }

        lines.push({
            startOffset: match.index,
            text: rawLine.replace(/(?:\r\n|\r|\n)$/u, "")
        });

        if (linePattern.lastIndex === sourceText.length) {
            break;
        }
    }

    return lines;
}

/**
 * Removes explicit `undefined` defaults from optional `@param` doc names.
 *
 * @param text Full source text to normalize.
 * @returns Source text with `[name=undefined]` doc params rewritten to `[name]`.
 */
export function sanitizeDocCommentUndefinedOptionalParamDefaults(text: string): string {
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    return text
        .split(/\r?\n/u)
        .map((line) => normalizeUndefinedOptionalDefaultLine(line))
        .join(lineEnding);
}

function reportUndefinedOptionalDefaultFixes(context: Rule.RuleContext, definition: GmlRuleDefinition): void {
    const sourceText = context.sourceCode.text;
    for (const line of collectSourceLines(sourceText)) {
        const normalizedLine = normalizeUndefinedOptionalDefaultLine(line.text);
        if (normalizedLine === line.text) {
            continue;
        }

        context.report({
            loc: resolveLocFromIndex(context, sourceText, line.startOffset),
            messageId: definition.messageId,
            fix: (fixer) =>
                fixer.replaceTextRange([line.startOffset, line.startOffset + line.text.length], normalizedLine)
        });
    }
}

/**
 * Creates the rule module that owns explicit `undefined` optional `@param`
 * default cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-undefined-defaults`.
 */
export function createNormalizeDocParamUndefinedDefaultsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Remove explicit undefined defaults from optional @param documentation."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportUndefinedOptionalDefaultFixes(context, definition);
                }
            };
        }
    });
}
