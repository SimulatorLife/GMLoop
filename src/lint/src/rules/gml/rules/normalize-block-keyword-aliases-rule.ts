import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite, rewriteSourceLines } from "../rule-base-helpers.js";

function appendTrailingLineComment(lineWithoutComment: string, commentText: string): string {
    const trimmedComment = commentText.trim();
    if (trimmedComment.length === 0) {
        return lineWithoutComment;
    }

    return `${lineWithoutComment} ${trimmedComment}`;
}

function normalizeLegacyBlockKeywordLine(line: string): string | null {
    const beginBlockMatch = /^(\s*)begin\s*(?:;\s*)?(\/\/.*)?$/u.exec(line);
    if (beginBlockMatch) {
        const indentation = beginBlockMatch[1] ?? "";
        const commentText = beginBlockMatch[2] ?? "";
        return commentText.trim().length === 0 ? "" : appendTrailingLineComment(`${indentation}{`, commentText);
    }

    const endBlockMatch = /^(\s*)end\s*(?:;\s*)?(\/\/.*)?$/u.exec(line);
    if (endBlockMatch) {
        const indentation = endBlockMatch[1] ?? "";
        const commentText = endBlockMatch[2] ?? "";
        return commentText.trim().length === 0 ? null : appendTrailingLineComment(`${indentation}}`, commentText);
    }

    const inlineBeginMatch = /^(\s*)(.+?)\s+begin\s*(?:;\s*)?(\/\/.*)?$/u.exec(line);
    if (!inlineBeginMatch) {
        return line;
    }

    const indentation = inlineBeginMatch[1] ?? "";
    const header = inlineBeginMatch[2]?.trimEnd() ?? "";
    const commentText = inlineBeginMatch[3] ?? "";
    if (header.length === 0 || header.startsWith("#") || header.startsWith("//") || header.endsWith("{")) {
        return line;
    }

    return appendTrailingLineComment(`${indentation}${header} {`, commentText);
}

export function createNormalizeBlockKeywordAliasesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Normalize Pascal-style block keywords `begin` and `end` to standard curly braces `{` and `}`."
        }),
        create(context) {
            return Object.freeze({
                Program() {
                    const text = context.sourceCode.text;
                    const rewritten = rewriteSourceLines(text, (line) => {
                        return normalizeLegacyBlockKeywordLine(line);
                    });
                    reportFullTextRewrite(context, definition.messageId, text, rewritten);
                }
            });
        }
    });
}
