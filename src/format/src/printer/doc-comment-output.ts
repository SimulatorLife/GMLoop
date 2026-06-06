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
 * Dependency inversion: `buildPrintableDocCommentLines` is retrieved from
 * `options` so this module does not directly import the concrete adapter from
 * `../comments/description-doc.js`. The canonical implementation is injected by
 * `default-format-components.ts` via the `GmlFormatComponentContract` and reaches
 * this module through the Prettier options pipeline. (target-state.md §2.3)
 */
import { Core, type MutableDocCommentLines } from "@gmloop/core";
import { util } from "prettier";

import { buildPrintableDocCommentLines as buildPrintableDocCommentLinesFromComments } from "../comments/description-doc.js";
import { DOC_COMMENT_OUTPUT_FLAG, NUMBER_TYPE } from "./constants.js";
import { safeGetParentNode } from "./path-utils.js";
import { concat, hardline, join } from "./prettier-doc-builders.js";
import { resolveNodeIndexRangeWithSource, resolvePrinterSourceMetadata } from "./source-text.js";

/**
 * Resolves the buildPrintableDocCommentLines function for doc-comment rendering.
 *
 * This module avoids a direct cross-subsystem import by retrieving the function
 * from options.gml when available (injected by format-entry.ts via the
 * GmlFormatComponentContract). When running in test or standalone contexts
 * where options.gml is not populated, the canonical implementation from the
 * comments subsystem is used as a fallback. This keeps the dependency graph
 * clean for dependency-inversion tests while preserving backward compatibility
 * for callers that bypass createGmlFormat. (target-state.md §2.3)
 */
function resolveBuildPrintableDocCommentLines(options: any) {
    const injected = options?.gml?.buildPrintableDocCommentLines;
    if (typeof injected === "function") {
        return injected;
    }
    return buildPrintableDocCommentLinesFromComments;
}

/**
 * Builds and returns the formatted doc-comment block for `node`, ready to be
 * prepended to the node's own printed output. Returns an empty `concat("")`
 * when the node has no printable doc comments.
 *
 * The `buildPrintableDocCommentLines` function is retrieved from `options`
 * rather than imported directly, keeping this function decoupled from the
 * concrete adapter in `../comments/description-doc.js`.
 */
export function printNodeDocComments(node: any, path: any, options: any): any {
    const sourceMetadata = resolvePrinterSourceMetadata(options);
    const { originalText } = sourceMetadata;
    const { startIndex: nodeStartIndex } = resolveNodeIndexRangeWithSource(node, sourceMetadata);

    // Resolve buildPrintableDocCommentLines from options.gml (injected by
    // format-entry.ts) with a fallback to the canonical comments subsystem
    // implementation for backward compatibility. (target-state.md §2.3)
    const buildPrintableDocCommentLines = resolveBuildPrintableDocCommentLines(options);

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
    const mixedLeadingCommentBlock = buildMixedLeadingCommentBlock({
        node,
        printableDocComments,
        docCommentEntries: docCommentEntriesForMetadata,
        plainLeadingLines,
        originalText,
        nodeStartIndex
    });

    const parts: any[] = [];
    const shouldEmitPlainLeadingLines = plainLeadingLines.length > 0;

    if (mixedLeadingCommentBlock !== null) {
        parts.push(mixedLeadingCommentBlock, hardline);
    } else if (shouldEmitPlainLeadingLines) {
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
    plainLeadingLines,
    originalText,
    nodeStartIndex
}: {
    node: any;
    printableDocComments: ReadonlyArray<unknown>;
    docCommentEntries: MutableDocCommentLines;
    plainLeadingLines: ReadonlyArray<string>;
    originalText: string | null;
    nodeStartIndex: number | null;
}): unknown {
    if (
        originalText === null ||
        typeof nodeStartIndex !== NUMBER_TYPE ||
        !Core.isNonEmptyArray(printableDocComments) ||
        printableDocComments.length !== docCommentEntries.length ||
        !docCommentEntries.every(isLineStyleDocCommentEntry) ||
        (plainLeadingLines.length === 0 && !Array.isArray(node.comments))
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
    const plainItems = [
        ...resolveAttachedLeadingCommentItems(
            node,
            docCommentEntries,
            originalText,
            earliestDocStartIndex,
            nodeStartIndex
        ),
        ...resolvePlainLeadingLineItems(
            plainLeadingLines,
            originalText,
            earliestDocStartIndex,
            nodeStartIndex,
            docItems.length
        )
    ];
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

function resolveAttachedLeadingCommentItems(
    node: any,
    docCommentEntries: MutableDocCommentLines,
    originalText: string,
    leadingBlockStartIndex: number,
    nodeStartIndex: number
): LeadingCommentItem[] {
    if (!Array.isArray(node.comments)) {
        return [];
    }

    const docCommentEntrySet = new Set(docCommentEntries.filter(Core.isObjectLike));
    const items: LeadingCommentItem[] = [];

    for (const comment of node.comments) {
        if (!Core.isObjectLike(comment) || docCommentEntrySet.has(comment)) {
            continue;
        }

        const sourceIndex = resolveDocCommentStartIndex(comment);
        if (sourceIndex === null || sourceIndex < leadingBlockStartIndex || sourceIndex >= nodeStartIndex) {
            continue;
        }

        const rawText = resolveRawAttachedCommentText(comment, originalText);
        if (rawText === null) {
            continue;
        }

        comment.printed = true;
        items.push({
            doc: rawText,
            endIndex: resolveDocCommentEndIndex(comment),
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

    const startIndex = resolveDocCommentStartIndex(comment);
    const endIndex = resolveDocCommentEndIndex(comment);
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
    const metadataStartIndex = resolveDocCommentStartIndex(docCommentEntry);
    if (metadataStartIndex !== null) {
        return {
            doc,
            endIndex: resolveDocCommentEndIndex(docCommentEntry),
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

function resolvePlainLeadingLineItems(
    plainLeadingLines: ReadonlyArray<string>,
    originalText: string,
    leadingBlockStartIndex: number,
    nodeStartIndex: number,
    stableIndexOffset: number
): ReadonlyArray<LeadingCommentItem> {
    const items: LeadingCommentItem[] = [];
    let searchIndex = leadingBlockStartIndex;

    for (const [index, line] of plainLeadingLines.entries()) {
        const sourceIndex = originalText.indexOf(line, searchIndex);
        if (sourceIndex === -1 || sourceIndex >= nodeStartIndex) {
            return [];
        }

        items.push({
            doc: line,
            endIndex: sourceIndex + line.length - 1,
            sourceIndex,
            stableIndex: stableIndexOffset + index
        });
        searchIndex = sourceIndex + line.length;
    }

    return items;
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
