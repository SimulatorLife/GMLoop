import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { createMeta, reportFullTextRewrite } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

const DECORATIVE_BANNER_RUN_PATTERN = /[/\\_*#<>|:~-]{6,}/u;
const DECORATIVE_CHARACTER_PATTERN = /^[\s/\\_*#<>|:~-]+$/u;
const TRIPLE_SLASH_LINE_PATTERN = /^(\s*)\/\/\/(.*)$/u;
const METHOD_LIST_TRIPLE_SLASH_PATTERN = /^\.[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)\s*$/u;
const LEADING_DECORATIVE_PATTERN = /^[\s/\\_*#<>|:~-]+/u;
const TRAILING_DECORATIVE_PATTERN = /[\s/\\_*#<>|:~-]+$/u;

function isDocTagCommentLine(line: string): boolean {
    return /^\s*\/\/\/\s*@/u.test(line);
}

type SourceLineRewrite = Readonly<{
    lines: ReadonlyArray<string>;
    lastConsumedLineIndex: number;
}>;

function normalizeDecorativeLineCommentLine(line: string): string {
    if (isDocTagCommentLine(line)) {
        return line;
    }

    const lineCommentMatch = /^(\s*)\/\/(.*)$/u.exec(line);
    if (!lineCommentMatch) {
        return line;
    }

    const leadingWhitespace = lineCommentMatch[1] ?? "";
    const content = lineCommentMatch[2] ?? "";
    if (!DECORATIVE_BANNER_RUN_PATTERN.test(content) && !/\/{4,}/u.test(content)) {
        return line;
    }

    const normalizedContent = content
        .replace(LEADING_DECORATIVE_PATTERN, "")
        .replace(TRAILING_DECORATIVE_PATTERN, "")
        .trim();
    if (normalizedContent.length === 0) {
        return "";
    }

    return `${leadingWhitespace}// ${normalizedContent}`;
}

function rewriteMethodListTripleSlashBlock(
    sourceLines: ReadonlyArray<string>,
    startLineIndex: number
): SourceLineRewrite | null {
    if (TRIPLE_SLASH_LINE_PATTERN.exec(sourceLines[startLineIndex] ?? "") === null) {
        return null;
    }

    const rewrittenLines: Array<string> = [];
    let lineIndex = startLineIndex;
    while (lineIndex < sourceLines.length) {
        const sourceLine = sourceLines[lineIndex] ?? "";
        const match = TRIPLE_SLASH_LINE_PATTERN.exec(sourceLine);
        if (match === null) {
            break;
        }

        const leadingWhitespace = match[1] ?? "";
        const content = (match[2] ?? "").trim();
        if (content.startsWith("@")) {
            return null;
        }

        if (content.length === 0) {
            continue;
        }

        if (!METHOD_LIST_TRIPLE_SLASH_PATTERN.test(content)) {
            return null;
        }

        rewrittenLines.push(`${leadingWhitespace}// ${content}`);
        lineIndex += 1;
    }

    if (rewrittenLines.length === 0) {
        return null;
    }

    return {
        lines: rewrittenLines,
        lastConsumedLineIndex: lineIndex - 1
    };
}

function isDecorativeOnlyText(value: string): boolean {
    return DECORATIVE_CHARACTER_PATTERN.test(value);
}

function parseDecorativeBannerBlockStart(line: string): Readonly<{ indentation: string }> | null {
    const startMatch = /^(\s*)\/\*(.*)$/u.exec(line);
    if (startMatch === null) {
        return null;
    }

    const decorativeSuffix = (startMatch[2] ?? "").trim();
    if (decorativeSuffix.length < 6) {
        return null;
    }

    if (decorativeSuffix.includes("*/")) {
        return null;
    }

    if (!isDecorativeOnlyText(decorativeSuffix)) {
        return null;
    }

    return Object.freeze({
        indentation: startMatch[1] ?? ""
    });
}

function isDecorativeBannerBlockEndLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith("*")) {
        return false;
    }

    const decorativeSuffix = trimmed.slice(1).trim();
    if (!decorativeSuffix.startsWith("/") || decorativeSuffix.length < 6) {
        return false;
    }

    return isDecorativeOnlyText(decorativeSuffix);
}

function extractDecorativeBannerContentLine(line: string): string | null {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
        return null;
    }

    const withoutLeadingStar = trimmed.startsWith("*") ? trimmed.slice(1).trimStart() : trimmed;
    if (withoutLeadingStar.length === 0) {
        return null;
    }

    if (isDecorativeOnlyText(withoutLeadingStar)) {
        return null;
    }

    return withoutLeadingStar;
}

function rewriteDecorativeBannerBlock(
    sourceLines: ReadonlyArray<string>,
    startLineIndex: number
): SourceLineRewrite | null {
    const start = parseDecorativeBannerBlockStart(sourceLines[startLineIndex] ?? "");
    if (start === null) {
        return null;
    }

    const contentLines: Array<string> = [];
    for (let lineIndex = startLineIndex + 1; lineIndex < sourceLines.length; lineIndex += 1) {
        const sourceLine = sourceLines[lineIndex] ?? "";

        if (isDecorativeBannerBlockEndLine(sourceLine)) {
            const normalizedContent = contentLines.join(" ").replaceAll(/\s+/gu, " ").trim();
            if (normalizedContent.length === 0) {
                return null;
            }

            return {
                lines: [`${start.indentation}/* ${normalizedContent} */`],
                lastConsumedLineIndex: lineIndex
            };
        }

        if (sourceLine.includes("*/")) {
            return null;
        }

        const contentLine = extractDecorativeBannerContentLine(sourceLine);
        if (contentLine !== null) {
            contentLines.push(contentLine);
        }
    }

    return null;
}

function normalizeBannerCommentLines(sourceLines: ReadonlyArray<string>): ReadonlyArray<string> {
    const rewrittenLines: Array<string> = [];

    for (let lineIndex = 0; lineIndex < sourceLines.length; lineIndex += 1) {
        const methodListRewrite = rewriteMethodListTripleSlashBlock(sourceLines, lineIndex);
        if (methodListRewrite !== null) {
            rewrittenLines.push(...methodListRewrite.lines);
            lineIndex = methodListRewrite.lastConsumedLineIndex;
            continue;
        }

        const decorativeBlockRewrite = rewriteDecorativeBannerBlock(sourceLines, lineIndex);
        if (decorativeBlockRewrite !== null) {
            rewrittenLines.push(...decorativeBlockRewrite.lines);
            lineIndex = decorativeBlockRewrite.lastConsumedLineIndex;
            continue;
        }

        rewrittenLines.push(normalizeDecorativeLineCommentLine(sourceLines[lineIndex] ?? ""));
    }

    return rewrittenLines;
}

/**
 * Creates the `gml/normalize-banner-comments` rule.
 *
 * Canonicalizes decorative line and block banner comments and rewrites method-
 * list triple-slash comments to plain `//` form so banner normalization is
 * lint-owned behavior.
 */
export function createNormalizeBannerCommentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    const lineEnding = Core.dominantLineEnding(sourceText);
                    const sourceLines = sourceText.split(/\r?\n/u);
                    const rewrittenLines = normalizeBannerCommentLines(sourceLines);
                    const rewrittenText = rewrittenLines.join(lineEnding);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
