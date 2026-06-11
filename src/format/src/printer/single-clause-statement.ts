import { Core } from "@gmloop/core";

import {
    DEFAULT_PRINT_WIDTH,
    INLINE_BLOCK_TOTAL_OVERHEAD,
    INLINEABLE_SINGLE_STATEMENT_TYPES,
    NUMBER_TYPE,
    STRING_TYPE
} from "./constants.js";
import { isLogicalComparisonClause } from "./logical-expression-predicates.js";
import { concat, group, ifBreak, indent, line } from "./prettier-doc-builders.js";
import { optionalSemicolon } from "./semicolons.js";

/**
 * Default margin (in characters) added to the inline-length estimate before it
 * is compared to `printWidth`. A value of `0` reproduces the legacy behavior
 * exactly: the inline form is kept whenever its estimated length fits within
 * `printWidth`. Adjusting this value is the only knob that controls how
 * aggressively the formatter chooses the inline form.
 */
const INLINE_BLOCK_MARGIN_FALLBACK = 0;

/**
 * Resolve the user-provided `inlineControlFlowBlockMargin` option to a safe,
 * finite number. Missing, non-numeric, or non-finite values fall back to
 * {@link INLINE_BLOCK_MARGIN_FALLBACK} so the print-width check is never
 * bypassed.
 *
 * The resolved margin is added to the inline-length estimate before it is
 * compared to `printWidth`:
 *  - A positive margin makes the formatter more conservative, requiring
 *    additional headroom before a block is kept inline.
 *  - A negative margin makes the formatter more aggressive, allowing the
 *    inline form to exceed `printWidth` by the configured amount.
 */
function resolveInlineControlFlowBlockMargin(options) {
    const rawMargin = options?.inlineControlFlowBlockMargin;
    if (typeof rawMargin !== NUMBER_TYPE || !Number.isFinite(rawMargin)) {
        return INLINE_BLOCK_MARGIN_FALLBACK;
    }
    return rawMargin;
}

/**
 * Builds a grouped clause document used by loop and control-flow headers.
 */
export function buildClauseGroup(doc) {
    return group([indent([ifBreak(line), doc]), ifBreak(line)]);
}

function getInnermostClauseExpression(node) {
    return Core.unwrapParenthesizedExpression(node);
}

function wrapInClauseParens(path, print, clauseKey, printWithoutExtraParens) {
    const clauseNode = path.getValue()?.[clauseKey];
    const clauseDoc = printWithoutExtraParens(path, print, clauseKey);
    const clauseExpressionNode = getInnermostClauseExpression(clauseNode);

    if (clauseExpressionNode?.type === "CallExpression" && (clauseExpressionNode as any).preserveOriginalCallText) {
        return concat(["(", clauseDoc, ")"]);
    }

    return concat(["(", buildClauseGroup(clauseDoc), ")"]);
}

function resolveInlineClauseBodySourceText(bodyNode, options, getSourceTextForNode): string | null {
    const bodySource = getSourceTextForNode(bodyNode, options);
    if (typeof bodySource !== STRING_TYPE) {
        return null;
    }

    const trimmedBodySource = bodySource.trim();
    if (trimmedBodySource.length === 0) {
        return null;
    }

    if (bodyNode?.type !== "BlockStatement") {
        return trimmedBodySource;
    }

    if (!trimmedBodySource.startsWith("{") || !trimmedBodySource.endsWith("}")) {
        return trimmedBodySource;
    }

    const inlineBodySource = trimmedBodySource.slice(1, -1).trim();
    return inlineBodySource.length > 0 ? inlineBodySource : null;
}

function shouldInlineClauseByPrintWidth(keyword, clauseNode, bodyNode, options, getSourceTextForNode): boolean {
    if (!bodyNode) {
        return false;
    }

    const clauseSource = getSourceTextForNode(clauseNode, options);
    if (typeof clauseSource !== STRING_TYPE || clauseSource.trim().length === 0) {
        return true;
    }

    if (clauseSource.includes("\n") || clauseSource.includes("\r")) {
        return false;
    }

    const inlineBodySource = resolveInlineClauseBodySourceText(bodyNode, options, getSourceTextForNode);
    if (inlineBodySource === null || inlineBodySource.includes("\n") || inlineBodySource.includes("\r")) {
        return false;
    }

    const configuredPrintWidth =
        typeof options?.printWidth === NUMBER_TYPE && Number.isFinite(options.printWidth) && options.printWidth > 0
            ? options.printWidth
            : DEFAULT_PRINT_WIDTH;

    const inlineMargin = resolveInlineControlFlowBlockMargin(options);

    const estimatedInlineLength =
        keyword.length + INLINE_BLOCK_TOTAL_OVERHEAD + clauseSource.trim().length + inlineBodySource.length;
    return estimatedInlineLength + inlineMargin <= configuredPrintWidth;
}

function shouldPreserveClauseBlockAdjacency(clauseNode, bodyNode) {
    if (!clauseNode || !bodyNode || bodyNode.type !== "BlockStatement") {
        return false;
    }

    const clauseEndIndex = Core.getNodeEndIndex(clauseNode);
    const bodyStartIndex = Core.getNodeStartIndex(bodyNode);

    if (
        typeof clauseEndIndex !== NUMBER_TYPE ||
        typeof bodyStartIndex !== NUMBER_TYPE ||
        bodyStartIndex < clauseEndIndex
    ) {
        return false;
    }

    if (bodyStartIndex !== clauseEndIndex) {
        return false;
    }

    return isLogicalComparisonClause(clauseNode);
}

/**
 * Prints loop/control-flow forms that share the shape `keyword (clause) statement`.
 */
export function printSingleClauseStatement(path, options, print, keyword, clauseKey, bodyKey, dependencies) {
    const { printInBlock, printWithoutExtraParens, getSourceTextForNode } = dependencies;
    const node = path.getValue();
    const clauseNode = node?.[clauseKey];
    const clauseExpressionNode = getInnermostClauseExpression(clauseNode);
    const clauseDoc = wrapInClauseParens(path, print, clauseKey, printWithoutExtraParens);
    const bodyNode = node?.[bodyKey];
    const allowInlineControlFlowBlocks = options?.allowInlineControlFlowBlocks ?? false;
    const clauseIsPreservedCall =
        clauseExpressionNode?.type === "CallExpression" &&
        (clauseExpressionNode as any).preserveOriginalCallText === true;

    const allowCollapsedGuard =
        bodyNode &&
        !clauseIsPreservedCall &&
        allowInlineControlFlowBlocks &&
        shouldInlineClauseByPrintWidth(keyword, clauseNode, bodyNode, options, getSourceTextForNode);

    if (allowCollapsedGuard) {
        let inlineReturnDoc = null;
        let inlineStatementType = null;

        if (INLINEABLE_SINGLE_STATEMENT_TYPES.has(bodyNode.type) && !Core.hasComment(bodyNode)) {
            inlineReturnDoc = print(bodyKey);
            inlineStatementType = bodyNode.type;
        } else if (
            bodyNode.type === "BlockStatement" &&
            !Core.hasComment(bodyNode) &&
            Array.isArray(bodyNode.body) &&
            bodyNode.body.length === 1
        ) {
            const [onlyStatement] = bodyNode.body;
            if (
                onlyStatement &&
                INLINEABLE_SINGLE_STATEMENT_TYPES.has(onlyStatement.type) &&
                !Core.hasComment(onlyStatement)
            ) {
                const startLine = bodyNode.start?.line;
                const endLine = bodyNode.end?.line;
                const blockSource = getSourceTextForNode(bodyNode, options);
                const blockContainsSemicolon = typeof blockSource === STRING_TYPE && blockSource.includes(";");
                const canInlineBlock =
                    onlyStatement.type === "ExitStatement" ||
                    (startLine !== undefined && endLine !== undefined && startLine === endLine);

                if (blockContainsSemicolon && canInlineBlock) {
                    inlineReturnDoc = path.call((childPath) => childPath.call(print, "body", 0), bodyKey);
                    inlineStatementType = onlyStatement.type;
                }
            }
        }

        if (inlineReturnDoc) {
            return group([
                keyword,
                " ",
                clauseDoc,
                " { ",
                inlineReturnDoc,
                optionalSemicolon(inlineStatementType ?? "ReturnStatement"),
                " }"
            ]);
        }
    }

    const preserveBraceAdjacency = shouldPreserveClauseBlockAdjacency(clauseNode, bodyNode);
    return concat([
        keyword,
        " ",
        clauseDoc,
        preserveBraceAdjacency ? "" : " ",
        printInBlock(path, options, print, bodyKey)
    ]);
}
