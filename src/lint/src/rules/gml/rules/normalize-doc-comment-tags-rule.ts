import type { Rule } from "eslint";

import { gmlRuleDocCommentServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportLineTextFixes } from "../rule-base-helpers.js";

const { normalizeDocCommentTagAliasLine } = gmlRuleDocCommentServices;

function normalizeDocCommentPrefixLine(line: string): string {
    const docSlashMatch = /^(\s*)\/\/\s*\/(?!\/)(.*)$/u.exec(line);
    if (docSlashMatch) {
        const content = docSlashMatch[2].trim();
        if (/^[=+\-*/%<>!&|^]/u.test(content)) {
            return line;
        }
        if (content.length === 0) {
            return `${docSlashMatch[1]}///`;
        }
        return `${docSlashMatch[1]}/// ${content}`;
    }

    const tripleSlashMatch = /^(\s*)\/\/\/\s*@(.*)$/u.exec(line);
    if (tripleSlashMatch) {
        return `${tripleSlashMatch[1]}/// @${tripleSlashMatch[2].trim()}`;
    }

    const doubleSlashAtMatch = /^(\s*)\/\/\s*@(.*)$/u.exec(line);
    if (doubleSlashAtMatch) {
        return `${doubleSlashAtMatch[1]}/// @${doubleSlashAtMatch[2].trim()}`;
    }

    const tripleSlashNoAtMatch = /^(\s*)\/\/\/\s*(.*)$/u.exec(line);
    if (tripleSlashNoAtMatch) {
        const content = tripleSlashNoAtMatch[2].trim();
        if (content.startsWith("/")) {
            return `${tripleSlashNoAtMatch[1]}/// ${content}`;
        }
        if (content.length === 0) {
            return `${tripleSlashNoAtMatch[1]}///`;
        }
        return `${tripleSlashNoAtMatch[1]}/// ${content}`;
    }

    return line;
}

function normalizeDocCommentTagLine(line: string): string {
    return normalizeDocCommentTagAliasLine(normalizeDocCommentPrefixLine(line));
}

/**
 * Creates the rule module that owns doc-comment marker and tag-alias
 * canonicalization before function-doc synthesis runs.
 *
 * @param definition Static catalog metadata for the rule.
 * @returns ESLint rule module for `gml/normalize-doc-comment-tags`.
 */
export function createNormalizeDocCommentTagsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText: "Normalize doc-comment markers and tag aliases."
        }),
        create(context: Rule.RuleContext): Rule.RuleListener {
            return {
                Program() {
                    reportLineTextFixes(context, definition, normalizeDocCommentTagLine);
                }
            };
        }
    });
}
