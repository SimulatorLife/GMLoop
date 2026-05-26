import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createNormalizeDocCommentsRule as createUnsafeNormalizeDocCommentsRule } from "./normalize-doc-comments-rule.js";

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

function createSanitizingContext(context: Rule.RuleContext): Rule.RuleContext {
    return {
        ...context,
        report(payload: Parameters<Rule.RuleContext["report"]>[0]) {
            if (typeof Reflect.get(payload, "fix") !== "function") {
                context.report(payload);
                return;
            }

            context.report({
                ...payload,
                fix(fixer: Rule.RuleFixer) {
                    const sanitizingFixer = {
                        ...fixer,
                        replaceTextRange(range: Parameters<Rule.RuleFixer["replaceTextRange"]>[0], text: string) {
                            return fixer.replaceTextRange(
                                range,
                                sanitizeDocCommentMultilineOptionalParamDefaults(text)
                            );
                        }
                    };

                    return Reflect.get(payload, "fix")(sanitizingFixer);
                }
            });
        }
    };
}

export function createNormalizeDocCommentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    const baseRule = createUnsafeNormalizeDocCommentsRule(definition);
    return Object.freeze({
        ...baseRule,
        create(context: Rule.RuleContext): Rule.RuleListener {
            return baseRule.create(createSanitizingContext(context));
        }
    });
}
