/**
 * Helpers for emitting doc-comment blocks that are attached to function
 * and variable-declaration nodes.
 *
 * Responsibilities:
 *  - Sort and deduplicate doc-comment entries by their source position.
 *  - Preserve blank lines between consecutive doc-comment blocks when the
 *    original source contained them.
 *  - Mark comment objects as printed so Prettier does not re-emit them as
 *    dangling comments.
 */
import { Core, type MutableDocCommentLines } from "@gmloop/core";
import { util } from "prettier";

import { buildPrintableDocCommentLines } from "../comments/description-doc.js";
import { DOC_COMMENT_OUTPUT_FLAG, NUMBER_TYPE } from "./constants.js";
import { safeGetParentNode } from "./path-utils.js";
import { concat, hardline, join } from "./prettier-doc-builders.js";
import { resolveNodeIndexRangeWithSource, resolvePrinterSourceMetadata } from "./source-text.js";

/**
 * Builds and returns the formatted doc-comment block for `node`, ready to be
 * prepended to the node's own printed output. Returns an empty `concat("")`
 * when the node has no printable doc comments.
 */
export function printNodeDocComments(node: any, path: any, options: any): any {
    const sourceMetadata = resolvePrinterSourceMetadata(options);
    const { originalText } = sourceMetadata;
    const { startIndex: nodeStartIndex } = resolveNodeIndexRangeWithSource(node, sourceMetadata);

    const docCommentDocs: MutableDocCommentLines = Array.isArray(node.docComments)
        ? Core.toMutableArray(node.docComments as string[], { clone: true })
        : [];
    const plainLeadingLines: string[] = Array.isArray(node.plainLeadingLines) ? node.plainLeadingLines : [];

    // The formatter trusts the AST's `docComments` as authoritative. Legacy doc
    // comment formats (e.g. `// @function`) are normalised by the lint rule
    // `gml/normalize-doc-comments` before formatting, so no source-text fallback
    // is needed here. Core's `normalizeFunctionDocCommentAttachments` helper
    // pre-attaches recognised `@function`-tag comments to the correct function
    // node, removing the need for any formatter-side source-text scan.
    // (target-state.md §2.2, §3.2, §3.5)

    sortDocCommentsBySourceOrder(docCommentDocs);

    const docCommentEntriesForMetadata = [...docCommentDocs];
    const printableDocComments = buildPrintableDocCommentLines(docCommentDocs, originalText);
    const printableDocCommentBlock = joinDocCommentsPreservingSourceSpacing(
        printableDocComments,
        docCommentEntriesForMetadata,
        originalText
    );

    const parts: any[] = [];
    const shouldEmitPlainLeadingLines = plainLeadingLines.length > 0;

    if (shouldEmitPlainLeadingLines) {
        parts.push(join(hardline, plainLeadingLines), hardline);
        if (docCommentDocs.length === 0) {
            parts.push(hardline);
        }
    }

    if (docCommentDocs.length > 0) {
        node[DOC_COMMENT_OUTPUT_FLAG] = true;
        const suppressLeadingBlank = (docCommentDocs as any)?._suppressLeadingBlank === true;

        const needsLeadingBlankLine = node?._gmlNeedsLeadingBlankLine === true;

        const hasLeadingNonDocComment =
            !Core.isNonEmptyArray(node.docComments) &&
            docCommentDocs.length === 0 &&
            originalText !== null &&
            typeof nodeStartIndex === NUMBER_TYPE &&
            Core.hasCommentImmediatelyBefore(originalText, nodeStartIndex);

        const hasExistingBlankLine =
            originalText !== null &&
            typeof nodeStartIndex === NUMBER_TYPE &&
            util.isPreviousLineEmpty(originalText, nodeStartIndex);
        const isTopOfFileDocBlock =
            originalText !== null &&
            typeof nodeStartIndex === NUMBER_TYPE &&
            originalText.slice(0, nodeStartIndex).trim().length === 0;

        const shouldEmitConfiguredLeadingBlankLine =
            !suppressLeadingBlank &&
            ((!isTopOfFileDocBlock && needsLeadingBlankLine) || (hasLeadingNonDocComment && !hasExistingBlankLine));

        if (shouldEmitConfiguredLeadingBlankLine) {
            parts.push(hardline);
        }

        parts.push(printableDocCommentBlock, hardline);
    } else {
        if (Object.hasOwn(node, DOC_COMMENT_OUTPUT_FLAG)) {
            delete node[DOC_COMMENT_OUTPUT_FLAG];
        }
    }

    markDocCommentsAsPrinted(node, path);

    return concat(parts);
}

/**
 * Marks every comment object attached to `node.docComments` (or, for a
 * `VariableDeclarator`, to its grandparent `VariableDeclaration`) as printed
 * so Prettier's dangling-comment pass does not re-emit them.
 */
export function markDocCommentsAsPrinted(node: any, path: any): void {
    if (node.docComments) {
        node.docComments.forEach((comment: any) => {
            if (comment && typeof comment === "object") {
                comment.printed = true;
            }
        });
    } else {
        const parentNode = safeGetParentNode(path);
        if (parentNode && parentNode.type === Core.VARIABLE_DECLARATOR) {
            const grandParentNode = safeGetParentNode(path, 1);
            if (grandParentNode && grandParentNode.type === Core.VARIABLE_DECLARATION && grandParentNode.docComments) {
                grandParentNode.docComments.forEach((comment: any) => {
                    if (comment && typeof comment === "object") {
                        comment.printed = true;
                    }
                });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function joinDocCommentsPreservingSourceSpacing(
    printableDocComments: ReadonlyArray<unknown>,
    docCommentDocs: MutableDocCommentLines,
    originalText: string | null
): any {
    if (!Core.isNonEmptyArray(printableDocComments)) {
        return "";
    }

    if (originalText === null || printableDocComments.length !== docCommentDocs.length) {
        return join(hardline, [...printableDocComments] as any[]);
    }

    const parts: any[] = [];
    for (let index = 0; index < printableDocComments.length; index += 1) {
        parts.push(printableDocComments[index]);

        if (index >= printableDocComments.length - 1) {
            continue;
        }

        const currentEntry = docCommentDocs[index];
        const nextEntry = docCommentDocs[index + 1];
        if (hasBlankLineBetweenDocCommentEntries(currentEntry, nextEntry, originalText)) {
            parts.push(hardline, hardline);
        } else {
            parts.push(hardline);
        }
    }

    return concat(parts);
}

function hasBlankLineBetweenDocCommentEntries(leftEntry: unknown, rightEntry: unknown, originalText: string): boolean {
    const leftEndIndex = resolveDocCommentEndIndex(leftEntry);
    const rightStartIndex = resolveDocCommentStartIndex(rightEntry);
    if (leftEndIndex === null || rightStartIndex === null || rightStartIndex <= leftEndIndex) {
        return false;
    }

    const slice = originalText.slice(leftEndIndex + 1, rightStartIndex);
    if (slice.length === 0) {
        return false;
    }

    return /\r?\n[ \t]*\r?\n/u.test(slice);
}

function resolveDocCommentStartIndex(commentEntry: unknown): number | null {
    if (!Core.isObjectLike(commentEntry)) {
        return null;
    }

    const startValue = (commentEntry as { start?: unknown }).start;
    if (typeof startValue === NUMBER_TYPE) {
        return startValue as number;
    }

    if (Core.isObjectLike(startValue)) {
        const startIndex = (startValue as { index?: unknown }).index;
        if (typeof startIndex === NUMBER_TYPE) {
            return startIndex as number;
        }
    }

    return null;
}

function resolveDocCommentEndIndex(commentEntry: unknown): number | null {
    if (!Core.isObjectLike(commentEntry)) {
        return null;
    }

    const endValue = (commentEntry as { end?: unknown }).end;
    if (typeof endValue === NUMBER_TYPE) {
        return endValue as number;
    }

    if (Core.isObjectLike(endValue)) {
        const endIndex = (endValue as { index?: unknown }).index;
        if (typeof endIndex === NUMBER_TYPE) {
            return endIndex as number;
        }
    }

    return null;
}

function sortDocCommentsBySourceOrder(docCommentDocs: MutableDocCommentLines): void {
    if (!Array.isArray(docCommentDocs) || docCommentDocs.length <= 1) {
        return;
    }

    const indexedEntries = docCommentDocs.map((entry, index) => ({
        entry,
        index,
        startIndex: resolveDocCommentStartIndex(entry)
    }));

    const hasSourcePositions = indexedEntries.some((entry) => typeof entry.startIndex === NUMBER_TYPE);
    if (!hasSourcePositions) {
        return;
    }

    indexedEntries.sort((left, right) => {
        const leftStart = typeof left.startIndex === NUMBER_TYPE ? left.startIndex : Number.NEGATIVE_INFINITY;
        const rightStart = typeof right.startIndex === NUMBER_TYPE ? right.startIndex : Number.NEGATIVE_INFINITY;
        if (leftStart !== rightStart) {
            return leftStart - rightStart;
        }
        return left.index - right.index;
    });

    for (const [index, indexedEntry] of indexedEntries.entries()) {
        docCommentDocs[index] = indexedEntry.entry;
    }
}
