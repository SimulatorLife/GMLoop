import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportProgramTextRewrite } from "../rule-base-helpers.js";

const malformedOptionalDefaultParamPattern = /^(\s*\/\/\/\s*@param(?:\s+\{[^}\r\n]+\})?\s+)\[([A-Za-z0-9_]+)=.*$/u;
const docOrCodeLinePattern = /^\s*(?:(?:\/\/\/)|(?:function|var|static|if|for|while|repeat|switch|return)\b|[}])/u;

function findMalformedParamDefaultCloseLine(lines: ReadonlyArray<string>, startIndex: number): number | null {
    for (let index = startIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (docOrCodeLinePattern.test(line)) {
            return null;
        }

        if (line.includes("]")) {
            return index;
        }
    }

    return null;
}

/**
 * Collapses optional `@param` documentation defaults that spill across
 * multiple lines into a default-free optional parameter name.
 *
 * @param text Full source text to normalize.
 * @returns Source text with malformed multiline optional defaults removed.
 */
export function sanitizeDocCommentMultilineOptionalParamDefaults(text: string): string {
    const lineEnding = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(/\r?\n/u);
    const sanitizedLines: Array<string> = [];

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const malformedOptionalDefaultParamMatch = malformedOptionalDefaultParamPattern.exec(line);
        if (!malformedOptionalDefaultParamMatch || line.includes("]")) {
            sanitizedLines.push(line);
            continue;
        }

        const closeLineIndex = findMalformedParamDefaultCloseLine(lines, index);
        if (closeLineIndex === null) {
            sanitizedLines.push(line);
            continue;
        }

        sanitizedLines.push(`${malformedOptionalDefaultParamMatch[1]}[${malformedOptionalDefaultParamMatch[2]}]`);
        index = closeLineIndex;
    }

    return sanitizedLines.join(lineEnding);
}

/**
 * Creates the rule module that owns unsafe or multiline optional `@param`
 * default cleanup.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-param-defaults`.
 */
export function createNormalizeDocParamDefaultsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Normalize optional @param default documentation that spans multiple lines."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportProgramTextRewrite(context, definition, sanitizeDocCommentMultilineOptionalParamDefaults);
                }
            };
        }
    });
}
