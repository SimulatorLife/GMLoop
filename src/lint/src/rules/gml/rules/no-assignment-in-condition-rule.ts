import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite } from "../rule-base-helpers.js";

/**
 * Pattern matching the control-flow keywords that take a parenthesised
 * condition followed immediately by an opening paren (whitespace allowed
 * between the keyword and the paren).
 *
 * `if` and `while` are simple identifiers; `do until` is matched as the
 * two-word form `do` followed by `until` so we do not rewrite bare `do { ... }`
 * blocks that lack an `until` clause.
 *
 * The trailing `(` is consumed only as a position marker: the helper
 * {@link findMatchingCloseParenIndex} takes that paren's index and locates
 * the matching close paren by counting depth while skipping over string and
 * comment contents. Manual depth counting is required because JavaScript
 * regex does not support recursive/balanced matching, and condition
 * expressions in real GML code frequently contain nested parens (function
 * calls, ternary expressions, parenthesised sub-expressions) that a
 * `[^)]*` capture would silently truncate.
 */
const KEYWORD_HEADER_PATTERN = /\b(if|while|do\s+until)\b\s*\(/giu;

function normalizeConditionAssignments(conditionText: string): string {
    return conditionText.replaceAll(/(?<![=!<>+\-*/%])=(?![=])/g, "==");
}

/**
 * Locates the index of the `)` that matches the `(` at `openParenIndex`,
 * tracking string and comment state so that `(`/`)` inside literals and
 * comments are not counted toward the depth.
 *
 * Returns `null` when no matching close paren is found on the same line.
 * The caller treats that case as "no rewrite", which preserves the safe
 * line-based behaviour of the rule for malformed input (e.g. an
 * unterminated condition on the current line).
 */
function findMatchingCloseParenIndex(line: string, openParenIndex: number): number | null {
    if (line[openParenIndex] !== "(") {
        return null;
    }

    const scanState = Core.createStringCommentScanState();
    const length = line.length;
    let depth = 1;
    let index = openParenIndex + 1;

    while (index < length) {
        const advancedIndex = Core.advanceStringCommentScan(line, length, index, scanState, true);
        if (advancedIndex !== index) {
            index = advancedIndex;
            continue;
        }

        const character = line[index];
        if (character === "(") {
            depth += 1;
        } else if (character === ")") {
            depth -= 1;
            if (depth === 0) {
                return index;
            }
        }

        index += 1;
    }

    return null;
}

/**
 * Rewrites assignments inside parenthesised conditions of single-line
 * `if` / `while` / `do until` headers. Multi-line condition headers are
 * left unchanged because the rule operates line by line; the surrounding
 * `reportProgramTextRewrite` pipeline preserves the rest of the file
 * unchanged.
 */
function rewriteLineControlConditions(line: string): string {
    const keywordPattern = new RegExp(KEYWORD_HEADER_PATTERN.source, "giu");
    let result = "";
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = keywordPattern.exec(line)) !== null) {
        const keywordStart = match.index;
        const openParenIndex = keywordStart + match[0].length - 1;
        const closeParenIndex = findMatchingCloseParenIndex(line, openParenIndex);
        if (closeParenIndex === null) {
            // Unmatched paren on this line; advance past the opening paren
            // so the regex does not infinite-loop on the same `(`.
            keywordPattern.lastIndex = openParenIndex + 1;
            continue;
        }

        const conditionText = line.slice(openParenIndex + 1, closeParenIndex);
        const rewrittenCondition = normalizeConditionAssignments(conditionText);

        // Preserve the exact keyword + whitespace + `(` prefix from the
        // original line; the rule only rewrites condition content.
        const keywordAndOpenParen = line.slice(keywordStart, openParenIndex + 1);
        result += `${line.slice(lastIndex, keywordStart)}${keywordAndOpenParen}${rewrittenCondition})`;
        lastIndex = closeParenIndex + 1;
        keywordPattern.lastIndex = lastIndex;
    }

    return `${result}${line.slice(lastIndex)}`;
}

function rewriteControlConditionAssignments(sourceText: string): string {
    const lineEnding = Core.dominantLineEnding(sourceText);
    const lines = sourceText.split(/\r?\n/u);
    return lines.map(rewriteLineControlConditions).join(lineEnding);
}

export function createNoAssignmentInConditionRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const rewrittenText = rewriteControlConditionAssignments(sourceText);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
