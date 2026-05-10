/**
 * Statement traversal and spacing helpers for the print pipeline.
 *
 * These functions drive the per-iteration spacing logic used by `buildStatementPartsForPrinter`.
 * They determine whether to emit a blank line (hardline) after a statement based on:
 * - whether the next line is empty in the original source
 * - whether blank-line suppression is active for a macro statement
 * - whether the current or next node is a macro, #region/#endregion, loop, variable declaration, etc.
 * - whether the current node has a trailing comment that should preserve a gap
 *
 * `handleIntermediateTrailingSpacing` – used when iterating over a list of statements;
 *   decides whether to push a hardline based on the node pair and original source layout.
 *
 * `handleTerminalTrailingSpacing` – used at the end of a statement list; applies final
 *   padding when a block or container ends (e.g. constructor closing brace).
 *
 * `findNextTerminalCharacter` – scans forward from a known byte offset to find the next
 *   meaningful non-whitespace character (used to detect trailing `}` on blocks without
 *   storing a separate end-index on every node).
 */

import { Core } from "@gmloop/core";
import { util } from "prettier";

import { DOC_COMMENT_OUTPUT_FLAG,NUMBER_TYPE, STRING_TYPE } from "./constants.js";
import { countTrailingBlankLines, getNextNonWhitespaceCharacter } from "./semicolons.js";
import { macroTextHasExplicitTrailingBlankLine } from "./source-text.js";
import { shouldAddNewlinesAroundStatement, shouldSuppressEmptyLineBetween } from "./statement-spacing-policy.js";

const MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING = 4;

/**
 * Returns the number of consecutive variable declarations ending at `index`
 * (working backwards through `statements`) by scanning the original text for `var`.
 */
function countContiguousVariableDeclarationsBeforeIndexWithSource(
    statements: readonly any[],
    index: number,
    originalText: string | null
): number {
    if (originalText === null) {
        return 0;
    }

    let count = 0;
    let scanIndex = index;

    while (scanIndex >= 0) {
        const candidate = statements[scanIndex];
        if (candidate?.type !== Core.VARIABLE_DECLARATION) {
            break;
        }

        const candidateStart = Core.getNodeStartIndex(candidate);
        if (typeof candidateStart !== NUMBER_TYPE) {
            break;
        }

        const snippet = originalText.slice(Math.max(0, candidateStart), candidateStart + 4);
        if (!/var\b/iu.test(snippet)) {
            break;
        }

        count += 1;
        scanIndex -= 1;
    }

    return count;
}

/**
 * Returns true when `node` is immediately preceded by a block comment on the same line.
 */
function isNodeImmediatelyPrecededByBlockComment(node: any, originalText: string): boolean {
    const nodeStartIndex = Core.getNodeStartIndex(node);
    if (typeof nodeStartIndex !== NUMBER_TYPE || nodeStartIndex <= 0) {
        return false;
    }

    let cursor = nodeStartIndex - 1;
    while (cursor >= 0) {
        const character = originalText[cursor];
        if (character === " " || character === "\t" || character === "\n" || character === "\r") {
            cursor -= 1;
            continue;
        }

        break;
    }

    if (cursor < 0) {
        return false;
    }

    const lineStartIndex = originalText.lastIndexOf("\n", cursor);
    const sourceLine = originalText.slice(lineStartIndex === -1 ? 0 : lineStartIndex + 1, cursor + 1).trimStart();
    return sourceLine.startsWith("/*") || sourceLine.endsWith("*/");
}

/**
 * Returns true when there is a blank line between `leftNode` and `rightNode` in `originalText`.
 */
function hasBlankLineBetweenStatements(leftNode: any, rightNode: any, originalText: string): boolean {
    const leftEndIndex = Core.getNodeEndIndex(leftNode);
    const rightStartIndex = Core.getNodeStartIndex(rightNode);
    if (
        typeof leftEndIndex !== NUMBER_TYPE ||
        typeof rightStartIndex !== NUMBER_TYPE ||
        rightStartIndex <= leftEndIndex
    ) {
        return false;
    }

    const betweenText = originalText.slice(leftEndIndex, rightStartIndex);
    if (betweenText.length === 0) {
        return false;
    }

    return /\r?\n[ \t]*\r?\n/u.test(betweenText);
}

/**
 * Returns true when there is a comment between `leftNode` and `rightNode` in `originalText`.
 */
function hasCommentBetweenStatements(leftNode: any, rightNode: any, originalText: string): boolean {
    const leftEndIndex = Core.getNodeEndIndex(leftNode);
    const rightStartIndex = Core.getNodeStartIndex(rightNode);
    if (
        typeof leftEndIndex !== NUMBER_TYPE ||
        typeof rightStartIndex !== NUMBER_TYPE ||
        rightStartIndex <= leftEndIndex
    ) {
        return false;
    }

    const betweenText = originalText.slice(leftEndIndex + 1, rightStartIndex);
    return /\/\/|\/\*/u.test(betweenText);
}

/**
 * Returns true when the line containing `node` ends with a trailing comment in `originalText`.
 */
function hasTrailingCommentOnStatementLine(node: any, originalText: string): boolean {
    const nodeEndIndex = Core.getNodeEndIndex(node);
    if (typeof nodeEndIndex !== NUMBER_TYPE || nodeEndIndex < 0 || nodeEndIndex >= originalText.length) {
        return false;
    }

    let lineEndIndex = nodeEndIndex;
    while (lineEndIndex < originalText.length) {
        const character = originalText[lineEndIndex];
        if (character === "\n" || character === "\r") {
            break;
        }

        lineEndIndex += 1;
    }

    return /\/\/|\/\*/u.test(originalText.slice(nodeEndIndex, lineEndIndex));
}

function isLoopLikeStatement(node: any): boolean {
    return (
        node?.type === "ForStatement" ||
        node?.type === "WhileStatement" ||
        node?.type === "DoUntilStatement" ||
        node?.type === "RepeatStatement" ||
        node?.type === "WithStatement"
    );
}

function isRegionDirectiveNode(node: any): boolean {
    return (
        node?.type === "RegionStatement" ||
        Core.getNormalizedDefineReplacementDirective(node) === Core.DefineReplacementDirective.REGION
    );
}

function isEndRegionDirectiveNode(node: any): boolean {
    return (
        node?.type === "EndRegionStatement" ||
        Core.getNormalizedDefineReplacementDirective(node) === Core.DefineReplacementDirective.END_REGION
    );
}

function isStaticFunctionVariableDeclaration(node: any): boolean {
    if (node?.type !== "VariableDeclarator") {
        return false;
    }

    const initializer = node.init;
    return initializer?.type === "FunctionDeclaration" && (initializer).isStatic === true;
}

function canForceAutomaticPadding(
    nextLineEmpty: boolean,
    shouldSuppressExtraEmptyLine: boolean,
    sanitizedMacroHasExplicitBlankLine: boolean
): boolean {
    return !nextLineEmpty && !shouldSuppressExtraEmptyLine && !sanitizedMacroHasExplicitBlankLine;
}

function canForceAutomaticPaddingWithSuppressionGuard(
    suppressFollowingEmptyLine: boolean,
    nextLineEmpty: boolean,
    shouldSuppressExtraEmptyLine: boolean,
    sanitizedMacroHasExplicitBlankLine: boolean
): boolean {
    return (
        !suppressFollowingEmptyLine &&
        canForceAutomaticPadding(nextLineEmpty, shouldSuppressExtraEmptyLine, sanitizedMacroHasExplicitBlankLine)
    );
}

function shouldForceVariableBlockBeforeLoopPadding(
    statements: readonly any[],
    index: number,
    node: any,
    nextNode: any,
    originalText: string | null
): boolean {
    if (node?.type !== Core.VARIABLE_DECLARATION || !isLoopLikeStatement(nextNode)) {
        return false;
    }

    const variableBlockSize = countContiguousVariableDeclarationsBeforeIndexWithSource(statements, index, originalText);
    return variableBlockSize >= MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING;
}

/**
 * Scans forward from `startIndex` to find the next meaningful non-whitespace character.
 * Skips semicolons unless `hasFunctionInitializer` is true.
 */
function findNextTerminalCharacter(
    originalText: string,
    startIndex: number,
    hasFunctionInitializer: boolean
): string | null {
    const textLength = originalText.length;
    let scanIndex = startIndex;

    while (scanIndex < textLength) {
        const nextCharacter = getNextNonWhitespaceCharacter(originalText, scanIndex);

        if (nextCharacter === ";") {
            if (hasFunctionInitializer) {
                return ";";
            }

            const semicolonIndex = originalText.indexOf(";", scanIndex);
            if (semicolonIndex === -1) {
                return null;
            }

            scanIndex = semicolonIndex + 1;
            continue;
        }

        return nextCharacter;
    }

    return null;
}

interface TraversalSpacingOptions {
    parts: any[];
    statements: readonly any[] | null;
    index: number;
    node: any;
    containerNode: any;
    options: any;
    hardline: any;
    currentNodeRequiresNewline: boolean;
    nodeEndIndex: number;
    suppressFollowingEmptyLine: boolean;
    isTopLevel: boolean;
}

/**
 * Spacing logic applied during statement-list iteration.
 *
 * After emitting a hardline for the current statement, this function evaluates
 * the gap between the current and next node and may emit an additional hardline
 * (blank line) based on source layout, node types, and formatting policy.
 */
function handleIntermediateTrailingSpacing({
    parts,
    statements,
    index,
    node,
    containerNode,
    options,
    hardline: hardlineDoc,
    currentNodeRequiresNewline,
    nodeEndIndex,
    suppressFollowingEmptyLine,
    isTopLevel
}: TraversalSpacingOptions): boolean {
    let previousNodeHadNewlineAddedAfter = false;
    const nextNode = statements ? statements[index + 1] : null;
    const shouldSuppressExtraEmptyLine = shouldSuppressEmptyLineBetween(node, nextNode);
    const nextNodeIsMacro = Core.isMacroLikeStatement(nextNode);
    const shouldSkipStandardHardline =
        shouldSuppressExtraEmptyLine && Core.isMacroLikeStatement(node) && !nextNodeIsMacro;

    if (!shouldSkipStandardHardline) {
        parts.push(hardlineDoc);
    }

    const nextLineProbeIndex =
        node?.type === Core.DEFINE_STATEMENT || node?.type === Core.MACRO_DECLARATION ? nodeEndIndex : nodeEndIndex + 1;

    const forceFollowingEmptyLine = (node)?._gmlForceFollowingEmptyLine === true;
    const originalText = typeof options.originalText === STRING_TYPE ? (options.originalText as string) : null;
    const currentStatementIsDelete = Core.isDeleteStatementNode(node);
    const hasSourceBlankLineBeforeNextNode =
        !suppressFollowingEmptyLine &&
        originalText !== null &&
        nextNode != null &&
        hasBlankLineBetweenStatements(node, nextNode, originalText);
    const currentStatementHasTrailingComment =
        originalText !== null && hasTrailingCommentOnStatementLine(node, originalText);
    const nextLineEmpty = suppressFollowingEmptyLine
        ? false
        : util.isNextLineEmpty(options.originalText, nextLineProbeIndex) || hasSourceBlankLineBeforeNextNode;

    const isSanitizedMacro =
        node?.type === Core.MACRO_DECLARATION && typeof (node)._featherMacroText === STRING_TYPE;
    const sanitizedMacroHasExplicitBlankLine =
        isSanitizedMacro && macroTextHasExplicitTrailingBlankLine((node)._featherMacroText);
    const hasAutomaticPaddingCapacity = canForceAutomaticPadding(
        nextLineEmpty,
        shouldSuppressExtraEmptyLine,
        sanitizedMacroHasExplicitBlankLine
    );
    const hasAutomaticPaddingCapacityWithSuppressionGuard = canForceAutomaticPaddingWithSuppressionGuard(
        suppressFollowingEmptyLine,
        nextLineEmpty,
        shouldSuppressExtraEmptyLine,
        sanitizedMacroHasExplicitBlankLine
    );

    const isMacroLikeNode = Core.isMacroLikeStatement(node);
    const isDefineMacroReplacement =
        Core.getNormalizedDefineReplacementDirective(node) === Core.DefineReplacementDirective.MACRO;
    const shouldForceMacroPadding =
        isMacroLikeNode && !isDefineMacroReplacement && !nextNodeIsMacro && hasAutomaticPaddingCapacity;
    const isLoopStatement = isLoopLikeStatement(node);
    const nextNodeIsLoop = isLoopLikeStatement(nextNode);
    const nextNodeIsVariableDeclaration = nextNode?.type === Core.VARIABLE_DECLARATION;
    const shouldForceLoopSectionPadding =
        hasAutomaticPaddingCapacityWithSuppressionGuard &&
        isLoopStatement &&
        (nextNodeIsVariableDeclaration || nextNodeIsLoop);
    const shouldForceVariableBlockLoopPadding =
        isTopLevel &&
        hasAutomaticPaddingCapacityWithSuppressionGuard &&
        shouldForceVariableBlockBeforeLoopPadding(
            statements,
            index,
            node,
            nextNode,
            typeof options.originalText === STRING_TYPE ? (options.originalText as string) : null
        );
    const shouldForceConstructorStaticSectionPadding =
        hasAutomaticPaddingCapacityWithSuppressionGuard &&
        containerNode?.type === "ConstructorDeclaration" &&
        isStaticFunctionVariableDeclaration(nextNode);
    const shouldAddForcedPadding = [
        shouldForceMacroPadding,
        shouldForceLoopSectionPadding,
        shouldForceVariableBlockLoopPadding,
        shouldForceConstructorStaticSectionPadding,
        forceFollowingEmptyLine && hasAutomaticPaddingCapacity
    ].some(Boolean);

    const isEmptyRegionPair = isRegionDirectiveNode(node) && isEndRegionDirectiveNode(nextNode);

    const shouldAddPaddingWithNewline =
        !isEmptyRegionPair && (shouldAddForcedPadding || (currentNodeRequiresNewline && !nextLineEmpty));

    if (shouldAddPaddingWithNewline) {
        parts.push(hardlineDoc);
        previousNodeHadNewlineAddedAfter = true;
    } else if (isEmptyRegionPair) {
        previousNodeHadNewlineAddedAfter = true;
    } else if (nextLineEmpty && !shouldSuppressExtraEmptyLine && !sanitizedMacroHasExplicitBlankLine) {
        const nextNodeStartIndex = nextNode == null ? null : Core.getNodeStartIndex(nextNode);
        const nextNodeHasLeadingComment =
            isTopLevel &&
            typeof nextNodeStartIndex === NUMBER_TYPE &&
            Core.hasCommentImmediatelyBefore(originalText, nextNodeStartIndex);
        const nextNodeHasCommentGap =
            isTopLevel &&
            originalText !== null &&
            nextNode != null &&
            hasCommentBetweenStatements(node, nextNode, originalText);
        const nextNodeHasBlockCommentImmediatelyBefore =
            originalText !== null &&
            nextNode != null &&
            isNodeImmediatelyPrecededByBlockComment(nextNode, originalText);
        const nextNodePrintsDocCommentBlock = Core.isNonEmptyArray((nextNode)?.docComments);

        const shouldPreserveSourceGapBeforeDocCommentedNode =
            nextNodePrintsDocCommentBlock && hasSourceBlankLineBeforeNextNode;
        const shouldPreserveSourceGapAfterTrailingComment =
            currentStatementHasTrailingComment &&
            hasSourceBlankLineBeforeNextNode &&
            (currentStatementIsDelete || !isTopLevel);
        const shouldCollapseTopLevelTrailingCommentGap =
            isTopLevel && currentStatementHasTrailingComment && !currentStatementIsDelete;

        const shouldApplyGenericSourceBlankLineSpacing =
            !shouldCollapseTopLevelTrailingCommentGap &&
            !nextNodePrintsDocCommentBlock &&
            !nextNodeHasLeadingComment &&
            !nextNodeHasCommentGap;

        if (
            shouldApplyGenericSourceBlankLineSpacing ||
            nextNodeHasBlockCommentImmediatelyBefore ||
            shouldPreserveSourceGapBeforeDocCommentedNode ||
            shouldPreserveSourceGapAfterTrailingComment
        ) {
            parts.push(hardlineDoc);
        }
    }

    return previousNodeHadNewlineAddedAfter;
}

interface TerminalSpacingOptions {
    childPath: { parent: any };
    parts: any[];
    node: any;
    options: any;
    hardline: any;
    nodeEndIndex: number;
    suppressFollowingEmptyLine: boolean;
    isStaticDeclaration: boolean;
    hasFunctionInitializer: boolean;
    containerNode?: any;
}

/**
 * Spacing logic applied at the end of a statement list (e.g. closing block brace).
 *
 * Evaluates whether the final statement should be followed by a trailing blank line
 * based on the original source layout, whether the block is a constructor, and the
 * presence of doc comments.
 */
function handleTerminalTrailingSpacing({
    childPath,
    parts,
    node,
    options,
    hardline: hardlineDoc,
    nodeEndIndex,
    suppressFollowingEmptyLine,
    isStaticDeclaration,
    hasFunctionInitializer
}: TerminalSpacingOptions): boolean {
    let previousNodeHadNewlineAddedAfter = false;
    const parentNode = childPath.parent;
    const isFunctionDeclarationNode = node?.type === "FunctionDeclaration";
    const trailingProbeIndex =
        node?.type === Core.DEFINE_STATEMENT || node?.type === Core.MACRO_DECLARATION ? nodeEndIndex : nodeEndIndex + 1;
    const enforceTrailingPadding = shouldAddNewlinesAroundStatement(node);
    const blockParent = (childPath as any).parent ?? childPath.parent?.parent ?? null;
    const constructorAncestor = (childPath as any).parent?.parent ?? blockParent?.parent ?? null;
    const isConstructorBlock =
        blockParent?.type === "BlockStatement" && constructorAncestor?.type === "ConstructorDeclaration";
    const constructorHasParentClause = isConstructorBlock && (constructorAncestor).parent != null;
    const shouldPreserveConstructorStaticPadding = isStaticDeclaration && hasFunctionInitializer && isConstructorBlock;
    let shouldPreserveTrailingBlankLine = false;
    const hasAttachedDocComment =
        node?.[DOC_COMMENT_OUTPUT_FLAG] === true || Core.isNonEmptyArray((node)?.docComments);
    const requiresTrailingPadding =
        enforceTrailingPadding &&
        parentNode?.type === "BlockStatement" &&
        !suppressFollowingEmptyLine &&
        (!isFunctionDeclarationNode || (isFunctionDeclarationNode && constructorHasParentClause));

    if (parentNode?.type === "BlockStatement" && !suppressFollowingEmptyLine) {
        const originalText = typeof options.originalText === STRING_TYPE ? (options.originalText as string) : null;
        const trailingBlankLineCount =
            originalText === null ? 0 : countTrailingBlankLines(originalText, trailingProbeIndex);
        const hasExplicitTrailingBlankLine = trailingBlankLineCount > 0;
        const shouldCollapseExcessBlankLines = trailingBlankLineCount > 1;

        if (enforceTrailingPadding) {
            if (isFunctionDeclarationNode) {
                const nextCharacter =
                    originalText === null ? null : findNextTerminalCharacter(originalText, trailingProbeIndex, false);
                shouldPreserveTrailingBlankLine = hasExplicitTrailingBlankLine && nextCharacter !== "}";
            } else {
                shouldPreserveTrailingBlankLine = hasExplicitTrailingBlankLine;
            }
        } else if (
            shouldPreserveConstructorStaticPadding &&
            hasExplicitTrailingBlankLine &&
            !shouldCollapseExcessBlankLines
        ) {
            const nextCharacter =
                originalText === null ? null : findNextTerminalCharacter(originalText, trailingProbeIndex, false);
            shouldPreserveTrailingBlankLine = nextCharacter !== null && nextCharacter !== "}";
        } else if (hasExplicitTrailingBlankLine && originalText !== null) {
            const nextCharacter = findNextTerminalCharacter(originalText, trailingProbeIndex, hasFunctionInitializer);
            if (isConstructorBlock && nextCharacter !== "}") {
                shouldPreserveTrailingBlankLine = false;
            } else {
                const shouldPreserve = nextCharacter === null ? false : nextCharacter !== "}";

                shouldPreserveTrailingBlankLine = shouldCollapseExcessBlankLines ? false : shouldPreserve;
            }
        }
    }

    if (
        !shouldPreserveTrailingBlankLine &&
        !suppressFollowingEmptyLine &&
        hasAttachedDocComment &&
        blockParent?.type === "BlockStatement" &&
        Core.isFunctionLikeDeclaration(node)
    ) {
        const originalText = typeof options.originalText === STRING_TYPE ? (options.originalText as string) : null;
        const nextCharacter =
            originalText === null ? null : findNextTerminalCharacter(originalText, trailingProbeIndex, false);
        shouldPreserveTrailingBlankLine = nextCharacter !== "}";
    }

    if (shouldPreserveTrailingBlankLine || requiresTrailingPadding) {
        parts.push(hardlineDoc);
        previousNodeHadNewlineAddedAfter = true;
    }

    return previousNodeHadNewlineAddedAfter;
}

export {
    canForceAutomaticPadding,
    canForceAutomaticPaddingWithSuppressionGuard,
    countContiguousVariableDeclarationsBeforeIndexWithSource,
    findNextTerminalCharacter,
    handleIntermediateTrailingSpacing,
    handleTerminalTrailingSpacing,
    hasBlankLineBetweenStatements,
    hasCommentBetweenStatements,
    hasTrailingCommentOnStatementLine,
    isEndRegionDirectiveNode,
    isLoopLikeStatement,
    isNodeImmediatelyPrecededByBlockComment,
    isRegionDirectiveNode,
    isStaticFunctionVariableDeclaration,
    shouldForceVariableBlockBeforeLoopPadding};
