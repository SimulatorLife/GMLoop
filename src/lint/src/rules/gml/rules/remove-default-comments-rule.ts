import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, reportProgramTextRewrite, type GmlRuleDefinition } from "../rule-base-helpers.js";

const DEFAULT_COMMENT_PLACEHOLDER_FRAGMENTS = Object.freeze([
    "Script assets have changed for v2.3.0",
    "https://help.yoyogames.com/hc/en-us/articles/360005277377 for more information",
    "@description Insert description here",
    "You can write your code in this editor"
]);

function readLineCommentContent(line: string): string | null {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith("//")) {
        return null;
    }

    return trimmed.replace(/^\/+\s*/u, "");
}

function isDefaultPlaceholderCommentLine(line: string): boolean {
    const commentContent = readLineCommentContent(line);
    if (commentContent === null) {
        return false;
    }

    for (const fragment of DEFAULT_COMMENT_PLACEHOLDER_FRAGMENTS) {
        if (commentContent.includes(fragment)) {
            return true;
        }
    }

    return false;
}

/**
 * Creates the `gml/remove-default-comments` rule.
 *
 * Removes GameMaker IDE placeholder comments and migration banner comments that
 * do not represent user-authored documentation.
 */
export function createRemoveDefaultCommentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, (sourceText) => {
                        const lineEnding = Core.dominantLineEnding(sourceText);
                        const sourceLines = sourceText.split(/\r?\n/u);
                        const rewrittenLines = sourceLines.filter((line) => !isDefaultPlaceholderCommentLine(line));
                        return rewrittenLines.join(lineEnding);
                    });
                }
            });
        }
    });
}
