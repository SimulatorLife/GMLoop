import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";

const paramDescriptionSeparatorPattern =
    /^(\s*\/\/\/\s*@param(?:\s+\{[^}\r\n]+\})?\s+(?:\[[^\]\r\n]+\]|[A-Za-z0-9_]+))\s+-\s+(.+)$/u;

function normalizeDocParamSeparatorLine(line: string): string {
    const normalized = paramDescriptionSeparatorPattern.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]} ${normalized[2]}`;
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
 * Rewrites legacy `@param name - description` separator hyphens to the
 * canonical `@param name description` form.
 *
 * @param text Full source text to normalize.
 * @returns Source text with doc-param separator hyphens removed.
 */
export function sanitizeDocCommentParamDescriptionSeparators(text: string): string {
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    return text
        .split(/\r?\n/u)
        .map((line) => normalizeDocParamSeparatorLine(line))
        .join(lineEnding);
}

function reportDocParamSeparatorFixes(context: Rule.RuleContext, definition: GmlRuleDefinition): void {
    const sourceText = context.sourceCode.text;
    for (const line of collectSourceLines(sourceText)) {
        const normalizedLine = normalizeDocParamSeparatorLine(line.text);
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
 * Creates the rule module that owns single-line `@param` description
 * separator cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-separators`.
 */
export function createNormalizeDocParamSeparatorsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Remove separator hyphens from @param descriptions."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportDocParamSeparatorFixes(context, definition);
                }
            };
        }
    });
}
