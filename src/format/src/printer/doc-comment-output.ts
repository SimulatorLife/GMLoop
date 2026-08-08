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
 *
 * `buildPrintableDocCommentLines` is imported directly from the comments
 * subsystem. The previous indirection through `options.gml` (with a fallback
 * to the canonical implementation for callers that bypassed `createGmlFormat`)
 * was a backward-compatibility shim; the printer always runs through
 * `createGmlFormat`, so the read-side indirection served no callers and the
 * canonical import is the single source of truth.
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
    const mixedLeadingCommentBlock = buildMixedLeadingCommentBlock({
        node,
        printableDocComments,
        docCommentEntries: docCommentEntriesForMetadata,
        originalText,
        nodeStartIndex
    });

    const parts: any[] = [];
    if (mixedLeadingCommentBlock !== null) {
        parts.push(mixedLeadingCommentBlock, hardline);
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

        if (mixedLeadingCommentBlock === null) {
            parts.push(printableDocCommentBlock, hardline);
        }
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

type LeadingCommentItem = Readonly<{
    doc: unknown;
    endIndex: number | null;
    sourceIndex: number;
    stableIndex: number;
}>;

function buildMixedLeadingCommentBlock({
    node,
    printableDocComments,
    docCommentEntries,
    originalText,
    nodeStartIndex
}: {
    node: any;
    printableDocComments: ReadonlyArray<unknown>;
    docCommentEntries: MutableDocCommentLines;
    originalText: string | null;
    nodeStartIndex: number | null;
}): unknown {
    if (
        originalText === null ||
        typeof nodeStartIndex !== NUMBER_TYPE ||
        !Core.isNonEmptyArray(printableDocComments) ||
        printableDocComments.length !== docCommentEntries.length ||
        !docCommentEntries.every(isLineStyleDocCommentEntry) ||
        (!Array.isArray(node.comments) && !Core.isNonEmptyArray(node._gmlEmbeddedLeadingComments))
    ) {
        return null;
    }

    const docItems = printableDocComments.map((doc, index) =>
        resolveDocLeadingCommentItem(doc, docCommentEntries[index], originalText, nodeStartIndex, index)
    );
    const hasDocPositions = docItems.every((item) => Number.isFinite(item.sourceIndex));
    if (!hasDocPositions) {
        return null;
    }

    const earliestDocStartIndex = Math.min(...docItems.map((item) => item.sourceIndex));
    const plainItems = resolveEmbeddedLeadingCommentItems(
        node,
        docCommentEntries,
        originalText,
        earliestDocStartIndex,
        nodeStartIndex
    );
    if (plainItems.length === 0) {
        return null;
    }

    return joinLeadingCommentItemsPreservingSourceSpacing(
        [...docItems, ...plainItems].toSorted((left, right) => {
            if (left.sourceIndex !== right.sourceIndex) {
                return left.sourceIndex - right.sourceIndex;
            }

            return left.stableIndex - right.stableIndex;
        }),
        originalText
    );
}

function resolveEmbeddedLeadingCommentItems(
    node: any,
    docCommentEntries: MutableDocCommentLines,
    originalText: string,
    leadingBlockStartIndex: number,
    nodeStartIndex: number
): LeadingCommentItem[] {
    if (!Array.isArray(node._gmlEmbeddedLeadingComments)) {
        return [];
    }

    const docCommentEntrySet = new Set(docCommentEntries.filter(Core.isObjectLike));
    const items: LeadingCommentItem[] = [];

    for (const comment of node._gmlEmbeddedLeadingComments) {
        if (!Core.isObjectLike(comment) || docCommentEntrySet.has(comment)) {
            continue;
        }

        const sourceIndex = Core.getCommentBoundaryIndex(comment, "start");
        if (sourceIndex === null || sourceIndex < leadingBlockStartIndex || sourceIndex >= nodeStartIndex) {
            continue;
        }

        const rawText = resolveRawAttachedCommentText(comment, originalText);
        if (rawText === null) {
            continue;
        }

        items.push({
            doc: rawText,
            endIndex: Core.getCommentBoundaryIndex(comment, "end"),
            sourceIndex,
            stableIndex: docCommentEntries.length + items.length
        });
    }

    return items;
}

function resolveRawAttachedCommentText(comment: Record<string, unknown>, originalText: string): string | null {
    if (comment.type === "CommentLine") {
        return Core.getLineCommentRawText(comment, { originalText });
    }

    if (comment.type !== "CommentBlock") {
        return null;
    }

    const startIndex = Core.getCommentBoundaryIndex(comment, "start");
    const endIndex = Core.getCommentBoundaryIndex(comment, "end");
    if (startIndex === null || endIndex === null || endIndex < startIndex) {
        return null;
    }

    return originalText.slice(startIndex, endIndex + 1);
}

function isLineStyleDocCommentEntry(commentEntry: unknown): boolean {
    if (typeof commentEntry === "string") {
        return commentEntry.trimStart().startsWith("///");
    }

    if (!Core.isObjectLike(commentEntry)) {
        return false;
    }

    return (commentEntry as { type?: unknown }).type === "CommentLine";
}

function resolveDocLeadingCommentItem(
    doc: unknown,
    docCommentEntry: unknown,
    originalText: string,
    nodeStartIndex: number,
    stableIndex: number
): LeadingCommentItem {
    const metadataStartIndex = Core.getCommentBoundaryIndex(docCommentEntry, "start");
    if (metadataStartIndex !== null) {
        return {
            doc,
            endIndex: Core.getCommentBoundaryIndex(docCommentEntry, "end"),
            sourceIndex: metadataStartIndex,
            stableIndex
        };
    }

    if (typeof doc === "string") {
        const sourceIndex = originalText.lastIndexOf(doc, nodeStartIndex);
        if (sourceIndex !== -1) {
            return {
                doc,
                endIndex: sourceIndex + doc.length - 1,
                sourceIndex,
                stableIndex
            };
        }
    }

    return {
        doc,
        endIndex: null,
        sourceIndex: Number.NaN,
        stableIndex
    };
}

function joinLeadingCommentItemsPreservingSourceSpacing(
    leadingCommentItems: ReadonlyArray<LeadingCommentItem>,
    originalText: string
): any {
    const parts: any[] = [];
    for (let index = 0; index < leadingCommentItems.length; index += 1) {
        const item = leadingCommentItems[index];
        parts.push(item.doc);

        if (index >= leadingCommentItems.length - 1) {
            continue;
        }

        const nextItem = leadingCommentItems[index + 1];
        if (
            !isRawBlockCommentDoc(item.doc) &&
            item.endIndex !== null &&
            nextItem.sourceIndex > item.endIndex &&
            /\r?\n[ \t]*\r?\n/u.test(originalText.slice(item.endIndex + 1, nextItem.sourceIndex))
        ) {
            parts.push(hardline, hardline);
        } else {
            parts.push(hardline);
        }
    }

    return concat(parts);
}

function isRawBlockCommentDoc(doc: unknown): boolean {
    return typeof doc === "string" && doc.trimStart().startsWith("/*");
}

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
    const leftEndIndex = Core.getCommentBoundaryIndex(leftEntry, "end");
    const rightStartIndex = Core.getCommentBoundaryIndex(rightEntry, "start");
    if (leftEndIndex === null || rightStartIndex === null || rightStartIndex <= leftEndIndex) {
        return false;
    }

    const slice = originalText.slice(leftEndIndex + 1, rightStartIndex);
    if (slice.length === 0) {
        return false;
    }

    return /\r?\n[ \t]*\r?\n/u.test(slice);
}

// `start` and `end` boundaries on doc-comment entries are read through
// `Core.getCommentBoundaryIndex`, the canonical helper for parser-produced
// comment boundary shapes. Keeping the call sites uniform here (instead of
// re-implementing the same `number | { index }` discrimination twice) makes
// any future change to boundary handling apply everywhere at once.

function sortDocCommentsBySourceOrder(docCommentDocs: MutableDocCommentLines): void {
    if (!Array.isArray(docCommentDocs) || docCommentDocs.length <= 1) {
        return;
    }

    const indexedEntries = docCommentDocs.map((entry, index) => ({
        entry,
        index,
        startIndex: Core.getCommentBoundaryIndex(entry, "start")
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
