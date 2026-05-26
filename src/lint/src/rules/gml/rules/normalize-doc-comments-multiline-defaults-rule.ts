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
        // Explicitly copy sourceCode since it is inherited from the prototype chain
        // and would not be included in the spread operator.
        sourceCode: context.sourceCode,
        report(payload: Parameters<Rule.RuleContext["report"]>[0]) {
            if (typeof Reflect.get(payload, "fix") !== "function") {
                context.report(payload);
                return;
            }

            context.report({
                ...payload,
                fix(fixer: Rule.RuleFixer) {
                    return Reflect.get(
                        payload,
                        "fix"
                    )({
                        insertTextAfter(node: Parameters<Rule.RuleFixer["insertTextAfter"]>[0], text: string) {
                            return fixer.insertTextAfter(node, text);
                        },
                        insertTextAfterRange(
                            range: Parameters<Rule.RuleFixer["insertTextAfterRange"]>[0],
                            text: string
                        ) {
                            return fixer.insertTextAfterRange(range, text);
                        },
                        insertTextBefore(node: Parameters<Rule.RuleFixer["insertTextBefore"]>[0], text: string) {
                            return fixer.insertTextBefore(node, text);
                        },
                        insertTextBeforeRange(
                            range: Parameters<Rule.RuleFixer["insertTextBeforeRange"]>[0],
                            text: string
                        ) {
                            return fixer.insertTextBeforeRange(range, text);
                        },
                        replaceText(node: Parameters<Rule.RuleFixer["replaceText"]>[0], text: string) {
                            return fixer.replaceText(node, text);
                        },
                        replaceTextRange(range: Parameters<Rule.RuleFixer["replaceTextRange"]>[0], text: string) {
                            return fixer.replaceTextRange(
                                range,
                                sanitizeDocCommentMultilineOptionalParamDefaults(text)
                            );
                        },
                        remove(node: Parameters<Rule.RuleFixer["remove"]>[0]) {
                            return fixer.remove(node);
                        },
                        removeRange(range: Parameters<Rule.RuleFixer["removeRange"]>[0]) {
                            return fixer.removeRange(range);
                        }
                    });
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
