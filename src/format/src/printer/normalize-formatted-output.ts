import { Core } from "@gmloop/core";

const { isNonEmptyTrimmedString } = Core;

const MULTIPLE_BLANK_LINE_PATTERN = /\n{3,}/g;
const WHITESPACE_ONLY_BLANK_LINE_PATTERN = /\n[ \t]+\n/g;
const LINE_COMMENT_TO_BLOCK_COMMENT_BLANK_PATTERN = /(\/\/(?!\/)[^\n]*\n)[ \t]*\n(?=[ \t]*\/\*)/g;
// Matches a blank line immediately after `{`, but not when the next
// non-blank content is a comment (`///`, `//`, or `/*`).  Comments that
// immediately follow a block opener are left with their blank line intact
// so the formatter never makes spacing decisions that require knowing
// whether the surrounding block is a function, a loop, or any other
// GML-specific construct.  (target-state.md §3.2 – formatter boundary)
const BLOCK_OPENING_BLANK_PATTERN = /\{\n[ \t]*\n(?![ \t]*(?:\/\/\/|\/\/|\/\*))/g;
const DECORATIVE_COMMENT_BLANK_PATTERN = /\{\n[ \t]+\n(?=\s*\/\/)/g;

const INLINE_TRAILING_COMMENT_SPACING_PATTERN = /(?<=[^\s/,])[ \t]{2,}(?=\/\/(?!\/))/g;

const DOUBLE_INDENT_TO_SINGLE = new Map([
    ["        ", "    "],
    ["\t\t", "\t"]
]);

type NormalizationStep = (formatted: string) => string;

function createPatternReplacementStep(pattern: RegExp, replacement: string): NormalizationStep {
    return (formatted: string) => formatted.replaceAll(pattern, replacement);
}

const collapseDuplicateBlankLines = createPatternReplacementStep(MULTIPLE_BLANK_LINE_PATTERN, "\n\n");
const collapseWhitespaceOnlyBlankLines = createPatternReplacementStep(WHITESPACE_ONLY_BLANK_LINE_PATTERN, "\n\n");
const collapseLineCommentToBlockCommentBlankLines = createPatternReplacementStep(
    LINE_COMMENT_TO_BLOCK_COMMENT_BLANK_PATTERN,
    "$1\n"
);

// Collapse the blank line that directly follows `{` when the next
// non-empty content is code (not a comment).  Comments are excluded by
// BLOCK_OPENING_BLANK_PATTERN so this replacement is unconditional and
// requires no knowledge of surrounding GML syntax.  (target-state.md §3.2)
const collapseBlockOpeningBlankLines = createPatternReplacementStep(BLOCK_OPENING_BLANK_PATTERN, "{\n");

const trimDecorativeCommentBlankLines = createPatternReplacementStep(DECORATIVE_COMMENT_BLANK_PATTERN, "{\n\n");
const normalizeInlineTrailingCommentSpacing = createPatternReplacementStep(
    INLINE_TRAILING_COMMENT_SPACING_PATTERN,
    " "
);

function normalizeSingleCommentBlockIndentation(formatted: string): string {
    const lines = formatted.split("\n");

    for (let index = 1; index < lines.length - 1; index += 1) {
        const previousLine = lines[index - 1] ?? "";
        const currentLine = lines[index] ?? "";
        const nextLine = lines[index + 1] ?? "";

        if (!previousLine.trimEnd().endsWith("{")) {
            continue;
        }

        const currentTrimmed = currentLine.trimStart();
        if (!currentTrimmed.startsWith("//")) {
            continue;
        }

        if (nextLine.trim() !== "}") {
            continue;
        }

        const currentIndent = currentLine.slice(0, currentLine.length - currentTrimmed.length);
        const closingIndent = nextLine.slice(0, nextLine.length - nextLine.trimStart().length);
        if (!currentIndent.startsWith(closingIndent)) {
            continue;
        }

        const extraIndent = currentIndent.slice(closingIndent.length);
        const normalizedExtraIndent = DOUBLE_INDENT_TO_SINGLE.get(extraIndent);
        if (normalizedExtraIndent === undefined) {
            continue;
        }

        lines[index] = `${closingIndent}${normalizedExtraIndent}${currentTrimmed}`;
    }

    return lines.join("\n");
}

/** Returns `true` when `line` starts with `//` (including doc-comment `///`) at column 0 with no leading whitespace. */
function isTopLevelLineComment(line: string | undefined): boolean {
    return typeof line === "string" && line.startsWith("//");
}

/** Returns `true` when a blank line should be inserted before a top-level comment at `previousLine`. */
function shouldInsertBlankLineBeforeTopLevelComment(previousLine: string | undefined): boolean {
    return isNonEmptyTrimmedString(previousLine) && !isTopLevelLineComment(previousLine);
}

function updateBlockCommentState(line: string, isInside: boolean): boolean {
    const startIndex = line.indexOf("/*");
    const endIndex = line.indexOf("*/");

    if (!isInside) {
        if (startIndex !== -1 && (endIndex === -1 || endIndex < startIndex)) {
            return true;
        }
        return false;
    }

    if (endIndex !== -1 && (startIndex === -1 || endIndex > startIndex)) {
        return false;
    }

    return true;
}

function ensureBlankLineBeforeTopLevelLineComments(formatted: string): string {
    const lines = formatted.split(/\r?\n/);
    const result: string[] = [];
    let previousLine: string | undefined;
    let insideBlockComment = false;

    for (const line of lines) {
        if (
            !insideBlockComment &&
            isTopLevelLineComment(line) &&
            shouldInsertBlankLineBeforeTopLevelComment(previousLine)
        ) {
            result.push("");
        }

        result.push(line);
        previousLine = line;
        insideBlockComment = updateBlockCommentState(line, insideBlockComment);
    }

    return result.join("\n");
}

function ensureTrailingNewline(formatted: string): string {
    return formatted.endsWith("\n") ? formatted : `${formatted}\n`;
}

export function normalizeFormattedOutput(formatted: string): string {
    const normalized = [
        collapseDuplicateBlankLines,
        collapseBlockOpeningBlankLines,
        ensureTrailingNewline,
        collapseDuplicateBlankLines,
        normalizeInlineTrailingCommentSpacing,
        normalizeSingleCommentBlockIndentation,
        ensureBlankLineBeforeTopLevelLineComments,
        trimDecorativeCommentBlankLines,
        collapseDuplicateBlankLines,
        collapseWhitespaceOnlyBlankLines,
        collapseLineCommentToBlockCommentBlankLines
    ].reduce<string>((current, step) => step(current), formatted);

    return collapseWhitespaceOnlyBlankLines(normalized);
}
