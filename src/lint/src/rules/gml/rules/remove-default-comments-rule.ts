import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportProgramTextRewrite, rewriteSourceLines } from "../rule-base-helpers.js";

const INTENTIONAL_EMPTY_OBJECT_EVENT_COMMENT =
    "// Intentionally empty: overrides inherited/default object event behavior.";
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

function readRuleContextFilename(context: Rule.RuleContext): string {
    const contextWithFilenames = context as Rule.RuleContext & {
        filename?: string;
        physicalFilename?: string;
    };

    return contextWithFilenames.physicalFilename ?? contextWithFilenames.filename ?? "";
}

function isObjectEventFilePath(filePath: string): boolean {
    return /(?:^|[/\\])objects[/\\][^/\\]+[/\\][^/\\]+\.gml$/u.test(filePath);
}

function containsOnlyDefaultPlaceholderComments(sourceText: string): boolean {
    const lines = sourceText.split(/\r?\n/u);
    let foundPlaceholderComment = false;

    for (const line of lines) {
        if (line.trim().length === 0) {
            continue;
        }

        if (!isDefaultPlaceholderCommentLine(line)) {
            return false;
        }

        foundPlaceholderComment = true;
    }

    return foundPlaceholderComment;
}

function rewriteDefaultComments(sourceText: string, filePath: string): string {
    if (isObjectEventFilePath(filePath) && containsOnlyDefaultPlaceholderComments(sourceText)) {
        const lineEnding = sourceText.includes("\r\n") ? "\r\n" : "\n";
        return sourceText.endsWith("\n")
            ? `${INTENTIONAL_EMPTY_OBJECT_EVENT_COMMENT}${lineEnding}`
            : INTENTIONAL_EMPTY_OBJECT_EVENT_COMMENT;
    }

    return rewriteSourceLines(sourceText, (line) => (isDefaultPlaceholderCommentLine(line) ? null : line));
}

/**
 * Creates the `gml/remove-default-comments` rule.
 *
 * Removes GameMaker IDE placeholder comments and migration banner comments that
 * do not represent user-authored documentation. Object event files are special:
 * a comment-only event can intentionally override inherited/default event
 * behavior, so placeholder-only object event files are rewritten to an explicit
 * intentional-empty marker instead of becoming empty.
 */
export function createRemoveDefaultCommentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const filePath = readRuleContextFilename(context);

            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, (sourceText) =>
                        rewriteDefaultComments(sourceText, filePath)
                    );
                }
            });
        }
    });
}
