import type { Rule } from "eslint";

import { gmlRuleDocCommentServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";

const { convertLegacyReturnsDescriptionLineToMetadata } = gmlRuleDocCommentServices;

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
 * Converts legacy doc-comment return descriptions into canonical `@returns`
 * metadata.
 *
 * @param text Full source text to normalize.
 * @returns Source text with legacy return descriptions converted.
 */
export function sanitizeLegacyDocReturnDescriptions(text: string): string {
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    return text
        .split(/\r?\n/u)
        .map((line) => convertLegacyReturnsDescriptionLineToMetadata(line))
        .join(lineEnding);
}

function reportLegacyDocReturnFixes(context: Rule.RuleContext, definition: GmlRuleDefinition): void {
    const sourceText = context.sourceCode.text;
    for (const line of collectSourceLines(sourceText)) {
        const normalizedLine = convertLegacyReturnsDescriptionLineToMetadata(line.text);
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
 * Creates the rule module that owns legacy return description cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-returns`.
 */
export function createNormalizeDocReturnsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Convert legacy doc-comment return descriptions to @returns metadata."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportLegacyDocReturnFixes(context, definition);
                }
            };
        }
    });
}
