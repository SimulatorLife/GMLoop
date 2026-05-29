import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportProgramTextRewrite } from "../rule-base-helpers.js";

/**
 * Returns `true` when the line is a bare `//` comment — i.e. the line contains
 * only optional leading whitespace, the `//` token, and optional trailing
 * whitespace, with **no** content after the slashes.
 *
 * Triple-slash doc-comment lines (`///`) are intentionally excluded: a line
 * containing only `///` is a blank documentation line used to separate
 * paragraphs in a JSDoc block and must be preserved.
 */
function isEmptyLineComment(line: string): boolean {
    // Must start with // but NOT ///
    return /^\s*\/\/(?!\/)[ \t]*$/u.test(line);
}

/**
 * Returns `true` when the line contains a block comment (`/* … *\/`) whose
 * body is entirely whitespace or asterisks. Matches patterns such as `/** *\/`,
 * `/* *\/`, `/*  *\/`, `/**  *\/`, etc. Only whole-line occurrences are
 * matched; inline block comments that have surrounding code are left alone.
 */
function isEmptyBlockComment(line: string): boolean {
    return /^\s*\/\*[* \t]*\*\/\s*$/u.test(line);
}

/**
 * Returns `true` when `line` is an empty code-comment line that should be
 * removed. Specifically matches:
 *
 * - Bare `//` lines (no content after the slashes)
 * - Whole-line block comments whose body is purely whitespace (`/** *\/`)
 *
 * Triple-slash doc-comment lines (`///`) are deliberately excluded — they
 * serve as blank paragraph separators inside JSDoc blocks and carry semantic
 * meaning.
 */
export function isEmptyCodeCommentLine(line: string): boolean {
    return isEmptyLineComment(line) || isEmptyBlockComment(line);
}

/**
 * Creates the `gml/no-empty-comments` rule.
 *
 * Removes empty code-comment lines (`//` and `/** *\/`) that carry no
 * information. Triple-slash doc-comment blank lines (`///`) are explicitly
 * preserved because they act as paragraph separators inside JSDoc blocks.
 */
export function createNoEmptyCommentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, (sourceText) => {
                        const lineEnding = Core.dominantLineEnding(sourceText);
                        const sourceLines = sourceText.split(/\r?\n/u);
                        const rewrittenLines = sourceLines.filter((line) => !isEmptyCodeCommentLine(line));
                        return rewrittenLines.join(lineEnding);
                    });
                }
            });
        }
    });
}
