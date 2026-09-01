import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, reportFullTextRewrite, rewriteSourceLines } from "../rule-base-helpers.js";

type LineCommentParts = Readonly<{
    codeText: string;
    commentText: string;
}>;

function isValidMacroIdentifier(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name);
}

function splitLineCommentOutsideStringLiterals(line: string): LineCommentParts {
    let activeQuoteDelimiter: '"' | "'" | null = null;
    let isEscapedCharacter = false;

    for (let index = 0; index < line.length - 1; index += 1) {
        const character = line[index];
        const nextCharacter = line[index + 1];

        if (isEscapedCharacter) {
            isEscapedCharacter = false;
            continue;
        }

        if (activeQuoteDelimiter !== null && character === "\\") {
            isEscapedCharacter = true;
            continue;
        }

        if (activeQuoteDelimiter === null && (character === "'" || character === '"')) {
            activeQuoteDelimiter = character;
            continue;
        }

        if (activeQuoteDelimiter === character) {
            activeQuoteDelimiter = null;
            continue;
        }

        if (activeQuoteDelimiter === null && character === "/" && nextCharacter === "/") {
            return Object.freeze({
                codeText: line.slice(0, index),
                commentText: line.slice(index)
            });
        }
    }

    return Object.freeze({
        codeText: line,
        commentText: ""
    });
}

function appendTrailingLineComment(lineWithoutComment: string, commentText: string): string {
    const trimmedComment = commentText.trim();
    if (trimmedComment.length === 0) {
        return lineWithoutComment;
    }

    return `${lineWithoutComment} ${trimmedComment}`;
}

function normalizeDefineRegionLine(leadingWhitespace: string, directiveBody: string): string | null {
    const regionMatch = /^region(?:\s+(.*))?$/iu.exec(directiveBody);
    if (regionMatch) {
        const regionName = regionMatch[1]?.trim() ?? "";
        return regionName.length === 0 ? `${leadingWhitespace}#region` : `${leadingWhitespace}#region ${regionName}`;
    }

    const endRegionMatch = /^(?:end\s+region|endregion)(?:\s+(.*))?$/iu.exec(directiveBody);
    if (!endRegionMatch) {
        return null;
    }

    const regionName = endRegionMatch[1]?.trim() ?? "";
    return regionName.length === 0 ? `${leadingWhitespace}#endregion` : `${leadingWhitespace}#endregion ${regionName}`;
}

function normalizeDefineMacroLine(line: string): string {
    const defineMatch = /^(\s*)#define(\s+)(.*)$/u.exec(line);
    if (!defineMatch) {
        return line;
    }

    const leadingWhitespace = defineMatch[1] ?? "";
    const spacingAfterDefine = defineMatch[2] ?? " ";
    const directiveBody = (defineMatch[3] ?? "").trim();
    if (directiveBody.length === 0) {
        return line;
    }

    const normalizedRegionLine = normalizeDefineRegionLine(leadingWhitespace, directiveBody);
    if (normalizedRegionLine) {
        return normalizedRegionLine;
    }

    const lineCommentParts = splitLineCommentOutsideStringLiterals(directiveBody);
    const directiveCodeText = lineCommentParts.codeText.trim();
    const directiveParts = directiveCodeText.split(/\s+/u);
    const directiveName = directiveParts[0] ?? "";

    if (!isValidMacroIdentifier(directiveName)) {
        return "";
    }

    const directiveValueText = directiveCodeText.slice(directiveName.length).trim();
    const normalizedDirectiveValue = directiveValueText.endsWith(";")
        ? directiveValueText.slice(0, -1).trimEnd()
        : directiveValueText;
    const normalizedMacroLine =
        normalizedDirectiveValue.length === 0
            ? `${leadingWhitespace}#macro${spacingAfterDefine}${directiveName}`
            : `${leadingWhitespace}#macro${spacingAfterDefine}${directiveName} ${normalizedDirectiveValue}`;

    return appendTrailingLineComment(normalizedMacroLine, lineCommentParts.commentText);
}

function normalizeCommentedDirectiveLine(line: string): string {
    return line;
}

export function createNormalizeDirectivesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    const text = context.sourceCode.text;
                    const rewritten = rewriteSourceLines(text, (line, index, sourceLines) => {
                        let normalized: string | null = normalizeDefineMacroLine(line);
                        if (normalized === null) {
                            return normalized;
                        }
                        normalized = normalizeCommentedDirectiveLine(normalized);

                        const isLastLine = index === sourceLines.length - 1;
                        if (isLastLine && normalized.endsWith("\n")) {
                            normalized = normalized.slice(0, -1);
                        }

                        return normalized;
                    });
                    reportFullTextRewrite(context, definition.messageId, text, rewritten);
                }
            });
        }
    });
}
