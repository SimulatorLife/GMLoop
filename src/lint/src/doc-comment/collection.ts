import { Core } from "@gmloop/core";

const {
    asArray,
    formatLineComment,
    getCommentArray,
    getCommentBoundaryIndex,
    getLineCommentRawText,
    isNonEmptyArray,
    resolveLineCommentOptions,
    toMutableArray,
    toTrimmedString
} = Core;

const STRING_TYPE = "string" as const;
const NUMBER_TYPE = "number" as const;

function normalizeDocLikeFormattedLine(formatted: string): string {
    const match = formatted.match(/^(\s*)\/\/\s+\/(.*)$/);
    if (!match) {
        return formatted;
    }

    const [, indent = "", remainder = ""] = match;
    const trimmedRemainder = remainder.trimStart();
    if (trimmedRemainder.startsWith("/")) {
        return formatted;
    }

    return `${indent}///${remainder}`;
}

function getNodeStartIndexForDocComments(node: any, locStart: unknown) {
    if (!node) {
        return null;
    }

    if (typeof locStart === "function") {
        const resolved = locStart(node);
        if (Number.isInteger(resolved)) {
            return resolved;
        }
    }

    const startProp = node.start;
    if (typeof startProp === NUMBER_TYPE) {
        return startProp;
    }

    if (startProp && typeof startProp.index === NUMBER_TYPE) {
        return startProp.index;
    }

    return null;
}

export function collectSyntheticDocCommentLines(node: any, options: any, programNode: any, sourceText: string | null) {
    const rawComments = getCommentArray(node);
    const lineCommentOptions = resolveLineCommentOptions(options);
    const nodeStartIndex = getNodeStartIndexForDocComments(node, options);

    const { existingDocLines, remainingComments } = collectNodeDocCommentLines(
        rawComments,
        lineCommentOptions,
        nodeStartIndex
    );

    if (existingDocLines.length > 0) {
        return { existingDocLines, remainingComments };
    }

    if (programNode) {
        const programCommentArray = getCommentArray(programNode);
        const programHasComments = isNonEmptyArray(programCommentArray);

        if (programHasComments) {
            const programDocLines = tryCollectDocLinesFromProgramComments(
                programCommentArray,
                nodeStartIndex,
                sourceText,
                options
            );
            if (programDocLines) {
                return {
                    existingDocLines: programDocLines,
                    remainingComments: toMutableArray(rawComments)
                };
            }
        } else {
            const sourceDocLines = tryCollectDocLinesFromSourceText(
                sourceText,
                nodeStartIndex,
                options,
                programCommentArray
            );
            if (sourceDocLines) {
                return {
                    existingDocLines: sourceDocLines,
                    remainingComments: toMutableArray(rawComments)
                };
            }
        }
    }

    return { existingDocLines, remainingComments };
}

function collectNodeDocCommentLines(
    rawComments: readonly any[],
    lineCommentOptions: any,
    nodeStartIndex: number | null
) {
    const existingDocLines: string[] = [];
    const remainingComments: any[] = [];

    if (!isNonEmptyArray(rawComments)) {
        // No node-level comments exist; fallback collection happens later.
    }

    for (const comment of rawComments) {
        if (!comment) {
            continue;
        }

        if (comment.type === "CommentBlock") {
            const rawValue = typeof comment.value === STRING_TYPE ? comment.value : "";
            const trimmed = rawValue.trim();
            const isJSDoc =
                trimmed.startsWith("*") ||
                /@(?:param|return|returns|arg|argument|desc|description|function|func)/.test(trimmed);

            if (!isJSDoc) {
                remainingComments.push(comment);
                continue;
            }

            const commentStartIndex = getCommentBoundaryIndex(comment, "start");

            const isBeforeNode =
                Number.isInteger(commentStartIndex) &&
                Number.isInteger(nodeStartIndex) &&
                commentStartIndex < nodeStartIndex;
            const considerAsLeading = isBeforeNode || comment?.placement === "leading";

            if (!considerAsLeading) {
                remainingComments.push(comment);
                continue;
            }

            comment.printed = true;
            const lines = rawValue.split(/\r?\n/);
            for (const line of lines) {
                const cleaned = line.replace(/^\s*\*?\s?/, "").trim();
                if (cleaned) {
                    existingDocLines.push(`/// ${cleaned}`);
                }
            }
            continue;
        }

        if (comment.type !== "CommentLine") {
            remainingComments.push(comment);
            continue;
        }

        let formatted = formatLineComment(comment, lineCommentOptions);
        const rawText = getLineCommentRawText(comment);
        const trimmedRaw = typeof rawText === STRING_TYPE ? rawText.trim() : "";
        const isFormattedDocStyle = typeof formatted === STRING_TYPE && formatted.trim().startsWith("///");
        const trimmedWithoutSlashes = trimmedRaw.replace(/^\/+/, "").trim();
        const hasDocTagAfterSlash = /^\/+\s*@/.test(trimmedRaw);
        const isDocStyleSlash = /^\/\/\s+\/\s*/.test(trimmedRaw);
        const isBlockDocLike = trimmedRaw.startsWith("/*") && trimmedWithoutSlashes.startsWith("@");
        const isRawDocLike = trimmedRaw.startsWith("///") || hasDocTagAfterSlash || isDocStyleSlash || isBlockDocLike;
        if (!isFormattedDocStyle && !isRawDocLike) {
            remainingComments.push(comment);
            continue;
        }

        if (
            (!formatted || formatted.trim().length === 0) &&
            isRawDocLike &&
            typeof trimmedRaw === STRING_TYPE &&
            trimmedRaw.length > 0
        ) {
            const inner = trimmedRaw.replace(/^\/*\s*/, "").trim();
            formatted = inner.length > 0 ? `/// ${inner}` : "///";
        }

        const commentStartIndex =
            comment && typeof comment.start === NUMBER_TYPE
                ? comment.start
                : comment && comment.start && typeof comment.start.index === NUMBER_TYPE
                  ? comment.start.index
                  : null;

        const isBeforeNode =
            Number.isInteger(commentStartIndex) &&
            Number.isInteger(nodeStartIndex) &&
            commentStartIndex < nodeStartIndex;
        const considerAsLeading = isBeforeNode || comment?.placement === "leading";
        if (!considerAsLeading) {
            remainingComments.push(comment);
            continue;
        }

        comment.printed = true;
        if (typeof formatted === "string") {
            formatted = normalizeDocLikeFormattedLine(formatted);
        }
        if (typeof formatted === "string" && formatted.includes("\n")) {
            const parts = formatted.split(/\r?\n/);
            for (const part of parts) {
                existingDocLines.push(part);
            }
        } else {
            existingDocLines.push(formatted);
        }
    }

    return { existingDocLines, remainingComments };
}

function tryCollectDocLinesFromProgramComments(
    programCommentArray: readonly any[],
    nodeStartIndex: number | null,
    sourceText: string | null,
    options: any
) {
    if (!Number.isInteger(nodeStartIndex)) {
        return null;
    }

    const docCandidates: any[] = [];
    let anchorIndex = nodeStartIndex;

    for (let i = programCommentArray.length - 1; i >= 0; --i) {
        const pc = programCommentArray[i];
        if (!pc || pc.type !== "CommentLine" || pc.printed) {
            continue;
        }
        let pcEndIndex = getCommentBoundaryIndex(pc, "end");
        const pcStartIndex = getCommentBoundaryIndex(pc, "start");
        if (!Number.isInteger(pcEndIndex)) {
            pcEndIndex = Number.isInteger(pcStartIndex) ? pcStartIndex : null;
        }
        if (!Number.isInteger(pcEndIndex) || pcEndIndex >= anchorIndex) {
            continue;
        }

        const rawText = getLineCommentRawText(pc);
        if (!isLineCommentDocLike(rawText)) {
            break;
        }
        if (hasTooManyBlankLinesBetween(sourceText, pcEndIndex, anchorIndex)) {
            break;
        }
        docCandidates.unshift(pc);
        anchorIndex = Number.isInteger(pcStartIndex) ? pcStartIndex : pcEndIndex;
    }

    if (docCandidates.length === 0) {
        return null;
    }

    const fallbackOptions = resolveLineCommentOptions(options);
    const collected = docCandidates.map((c) => {
        const formatted = formatLineComment(c, fallbackOptions);
        return typeof formatted === STRING_TYPE ? normalizeDocLikeFormattedLine(formatted) : formatted;
    });
    const flattenedCollected = flattenDocEntries(collected);
    for (const c of docCandidates) {
        c.printed = true;
    }
    return flattenedCollected;
}

function tryCollectDocLinesFromSourceText(
    sourceText: string | null,
    nodeStartIndex: number | null,
    options: any,
    programCommentArray: readonly any[]
) {
    if (typeof sourceText !== STRING_TYPE || !Number.isInteger(nodeStartIndex)) {
        return null;
    }

    const candidates: Array<{ text: string; start: number; end: number }> = [];
    let anchor = nodeStartIndex;

    while (anchor > 0) {
        const prevNewline = sourceText.lastIndexOf("\n", anchor - 1);
        const lineStart = prevNewline === -1 ? 0 : prevNewline + 1;
        const lineEnd = anchor === 0 ? 0 : anchor - 1;
        const rawLine = sourceText.slice(lineStart, lineEnd + 1);
        const trimmed = rawLine.trim();
        const isBlank = trimmed.length === 0;
        if (
            isBlank &&
            Number.isInteger(nodeStartIndex) &&
            hasTooManyBlankLinesBetween(sourceText, lineStart, nodeStartIndex)
        ) {
            break;
        }
        if (isBlank) {
            anchor = lineStart - 1;
            continue;
        }
        if (!/^\s*\/\//.test(trimmed)) {
            break;
        }
        const isDocLike = /^\/{2,}/.test(trimmed) || /^\/\/\s*\//.test(trimmed) || /^\/\s*@/.test(trimmed);
        if (!isDocLike) {
            break;
        }
        candidates.unshift({
            text: rawLine,
            start: lineStart,
            end: lineEnd
        });
        anchor = lineStart - 1;
    }

    if (candidates.length === 0) {
        return null;
    }

    const fallbackOptions = resolveLineCommentOptions(options);
    const formatted = candidates.map((c) => {
        const matchNode = programCommentArray.find((pc) => {
            const startIndex = getCommentBoundaryIndex(pc, "start");
            return Number.isInteger(startIndex) && startIndex === c.start;
        });
        if (matchNode) {
            matchNode.printed = true;
            const formattedComment = formatLineComment(matchNode, fallbackOptions);
            return typeof formattedComment === STRING_TYPE
                ? normalizeDocLikeFormattedLine(formattedComment)
                : formattedComment;
        }
        const inner = c.text.replace(/^\s*\/+\s*/, "").trim();
        return inner.length > 0 ? `/// ${inner}` : "///";
    });
    return flattenDocEntries(formatted);
}

export function isLineCommentDocLike(rawText: unknown): boolean {
    if (typeof rawText !== STRING_TYPE) {
        return false;
    }

    const trimmedRaw = (rawText as string).trim();
    const trimmedWithoutSlashes = trimmedRaw.replace(/^\/+/, "").trim();
    const hasDocTagAfterSlash = /^\/+\s*@/.test(trimmedRaw);
    const isDocStyleSlash = /^\/\/\s+\/\s*/.test(trimmedRaw);
    const isBlockDocLike = trimmedRaw.startsWith("/*") && trimmedWithoutSlashes.startsWith("@");

    return trimmedRaw.startsWith("///") || hasDocTagAfterSlash || isDocStyleSlash || isBlockDocLike;
}

function hasTooManyBlankLinesBetween(sourceText: string | null, start: number | null, end: number): boolean {
    if (typeof sourceText !== STRING_TYPE || !Number.isInteger(start)) {
        return false;
    }

    const gapText = sourceText.slice(start, end);
    const blankLines = (gapText.match(/\n/g) || []).length;
    return blankLines >= 2;
}

function flattenDocEntries(entries: unknown[]): string[] {
    const flattened: string[] = [];
    for (const entry of entries) {
        appendFlattenedEntry(flattened, entry);
    }
    return flattened;
}

function appendFlattenedEntry(target: string[], entry: unknown): void {
    if (typeof entry !== "string") {
        return;
    }

    if (entry.includes("\n")) {
        target.push(...entry.split(/\r?\n/));
        return;
    }

    target.push(entry);
}

function isUnprintedLineComment(comment: unknown): comment is { [key: string]: unknown; type: "CommentLine" } {
    if (!comment || typeof comment !== "object") {
        return false;
    }

    const candidate = comment as { [key: string]: unknown };
    return candidate.type === "CommentLine" && candidate.printed !== true;
}

export function collectLeadingProgramLineComments(
    node: any,
    programNode: any,
    options: any,
    sourceText: string | null
) {
    if (!node || !programNode) {
        return [];
    }

    const nodeStartIndex = getNodeStartIndexForDocComments(node, options);
    if (!Number.isInteger(nodeStartIndex)) {
        return [];
    }

    const programComments = getCommentArray(programNode);
    if (!isNonEmptyArray(programComments)) {
        return [];
    }

    const lineCommentOptions = resolveLineCommentOptions(options);
    const leadingLines: string[] = [];
    let anchorIndex = nodeStartIndex;

    for (let i = programComments.length - 1; i >= 0; i -= 1) {
        const comment = programComments[i];
        if (!isUnprintedLineComment(comment)) {
            continue;
        }

        const commentEnd = Core.getCommentBoundaryIndex(comment, "end");
        const commentStart = Core.getCommentBoundaryIndex(comment, "start");

        if (!Number.isInteger(commentEnd) || commentEnd >= anchorIndex) {
            continue;
        }

        const formatted = formatLineComment(comment, lineCommentOptions);
        const trimmed = toTrimmedString(formatted);

        if (
            trimmed.length === 0 ||
            trimmed.startsWith("///") ||
            /^\/\/\s*\/\s*/.test(trimmed) ||
            /^\s*@/.test(trimmed)
        ) {
            continue;
        }

        if (typeof sourceText === STRING_TYPE && typeof commentEnd === "number") {
            const gapText = sourceText.slice(commentEnd, anchorIndex);
            const blankLines = (gapText.match(/\n/g) || []).length;
            if (blankLines >= 2) {
                break;
            }
        }

        comment.printed = true;
        leadingLines.unshift(typeof formatted === STRING_TYPE ? formatted : "");
        anchorIndex =
            typeof commentStart === "number" ? commentStart : typeof commentEnd === "number" ? commentEnd : anchorIndex;
    }

    return leadingLines;
}

export function collectAdjacentLeadingSourceLineComments(node: any, options: any, sourceText: string | null) {
    if (!node || typeof sourceText !== STRING_TYPE) {
        return [];
    }

    const nodeStartIndex = getNodeStartIndexForDocComments(node, options);
    if (!Number.isInteger(nodeStartIndex)) {
        return [];
    }

    const leadingLines: string[] = [];
    let anchorIndex = nodeStartIndex;

    while (anchorIndex > 0) {
        const prevNewline = sourceText.lastIndexOf("\n", anchorIndex - 1);
        const lineStart = prevNewline === -1 ? 0 : prevNewline + 1;
        const lineEnd = anchorIndex === 0 ? 0 : anchorIndex - 1;
        const rawLine = sourceText.slice(lineStart, lineEnd + 1);
        const trimmed = rawLine.trim();

        if (trimmed.length === 0) {
            const gapText = sourceText.slice(lineStart, nodeStartIndex);
            const blankLines = (gapText.match(/\n/g) || []).length;
            if (blankLines >= 2) break;
            anchorIndex = lineStart - 1;
            continue;
        }

        if (!trimmed.startsWith("//")) {
            break;
        }

        if (trimmed.startsWith("///") || /^\/\/\s*\//.test(trimmed) || /^\s*@/.test(trimmed)) {
            break;
        }

        leadingLines.unshift(rawLine);
        anchorIndex = lineStart - 1;
    }

    return leadingLines;
}

export function extractLeadingNonDocCommentLines(comments: any, options: any) {
    if (!isNonEmptyArray(comments)) {
        return {
            leadingLines: [],
            remainingComments: asArray(comments)
        };
    }

    const lineCommentOptions = resolveLineCommentOptions(options);
    const leadingLines: string[] = [];
    const remainingComments: any[] = [];
    let scanningLeadingComments = true;

    for (const comment of comments) {
        if (scanningLeadingComments && comment && comment.type === "CommentLine") {
            const formatted = formatLineComment(comment, lineCommentOptions);
            const trimmed = toTrimmedString(formatted);

            if (trimmed.length === 0) {
                comment.printed = true;
                continue;
            }

            if (trimmed.startsWith("//") && !trimmed.startsWith("///") && !/^\/\/\s*\//.test(trimmed)) {
                comment.printed = true;
                leadingLines.push(typeof formatted === STRING_TYPE ? formatted : "");
                continue;
            }
        }

        scanningLeadingComments = false;
        remainingComments.push(comment);
    }

    return { leadingLines, remainingComments };
}
