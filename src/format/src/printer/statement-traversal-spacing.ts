import { Core } from "@gmloop/core";
import { util } from "prettier";

import { DOC_COMMENT_OUTPUT_FLAG, NUMBER_TYPE, STRING_TYPE } from "./constants.js";
import { safeGetParentNode } from "./path-utils.js";
import { countTrailingBlankLines, getNextNonWhitespaceCharacter } from "./semicolons.js";
import { macroTextHasExplicitTrailingBlankLine } from "./source-text.js";
import { shouldAddNewlinesAroundStatement, shouldSuppressEmptyLineBetween } from "./statement-spacing-policy.js";

const MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING = 4;

function isStaticFunctionVariableDeclaration(node) {
    if (node?.type !== Core.VARIABLE_DECLARATION || node.kind !== "static" || !Array.isArray(node.declarations)) {
        return false;
    }

    return node.declarations.some((declaration) => {
        const initializerType = declaration?.init?.type;
        return initializerType === Core.FUNCTION_EXPRESSION || initializerType === Core.FUNCTION_DECLARATION;
    });
}

function isLoopLikeStatement(node) {
    return (
        node?.type === Core.FOR_STATEMENT ||
        node?.type === Core.WHILE_STATEMENT ||
        node?.type === Core.REPEAT_STATEMENT ||
        node?.type === Core.DO_UNTIL_STATEMENT ||
        node?.type === Core.WITH_STATEMENT
    );
}

function countContiguousVariableDeclarationsBeforeIndexWithSource(
    statements,
    index,
    originalText: string | null
): number {
    if (!Array.isArray(statements) || index < 0 || index >= statements.length) {
        return 0;
    }

    let count = 0;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
        if (statements[cursor]?.type !== Core.VARIABLE_DECLARATION) {
            break;
        }

        if (
            originalText !== null &&
            cursor < index &&
            hasCommentBetweenStatements(statements[cursor], statements[cursor + 1], originalText)
        ) {
            break;
        }

        count += 1;
    }

    return count;
}

function hasCommentBetweenStatements(leftNode, rightNode, originalText: string): boolean {
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

function hasBlankLineBetweenStatements(leftNode, rightNode, originalText: string): boolean {
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

function hasTrailingCommentOnStatementLine(node, originalText: string): boolean {
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

function isNodeImmediatelyPrecededByBlockComment(node, originalText: string): boolean {
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

function shouldForceVariableBlockBeforeLoopPadding(
    statements,
    index,
    node,
    nextNode,
    originalText: string | null
): boolean {
    if (node?.type !== Core.VARIABLE_DECLARATION || !isLoopLikeStatement(nextNode)) {
        return false;
    }

    const variableBlockSize = countContiguousVariableDeclarationsBeforeIndexWithSource(statements, index, originalText);
    return variableBlockSize >= MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING;
}

function canForceAutomaticPadding(
    nextLineEmpty,
    shouldSuppressExtraEmptyLine,
    sanitizedMacroHasExplicitBlankLine
): boolean {
    return !nextLineEmpty && !shouldSuppressExtraEmptyLine && !sanitizedMacroHasExplicitBlankLine;
}

function canForceAutomaticPaddingWithSuppressionGuard(
    suppressFollowingEmptyLine,
    nextLineEmpty,
    shouldSuppressExtraEmptyLine,
    sanitizedMacroHasExplicitBlankLine
): boolean {
    return (
        !suppressFollowingEmptyLine &&
        canForceAutomaticPadding(nextLineEmpty, shouldSuppressExtraEmptyLine, sanitizedMacroHasExplicitBlankLine)
    );
}

function isRegionDirectiveNode(node): boolean {
    return (
        node?.type === "RegionStatement" ||
        Core.getNormalizedDefineReplacementDirective(node) === Core.DefineReplacementDirective.REGION
    );
}

function isEndRegionDirectiveNode(node): boolean {
    return (
        node?.type === "EndRegionStatement" ||
        Core.getNormalizedDefineReplacementDirective(node) === Core.DefineReplacementDirective.END_REGION
    );
}

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
}) {
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

    const forceFollowingEmptyLine = node?._gmlForceFollowingEmptyLine === true;
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

    const isSanitizedMacro = node?.type === Core.MACRO_DECLARATION && typeof node._featherMacroText === STRING_TYPE;
    const sanitizedMacroHasExplicitBlankLine =
        isSanitizedMacro && macroTextHasExplicitTrailingBlankLine(node._featherMacroText);
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
            typeof options.originalText === STRING_TYPE ? options.originalText : null
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

    // Suppress the blank line between a #region and an immediately following
    // #endregion (an empty region). Adding a blank line inside an empty region
    // would change the source round-trip and create unnecessary noise.
    const isEmptyRegionPair = isRegionDirectiveNode(node) && isEndRegionDirectiveNode(nextNode);

    const shouldAddPaddingWithNewline =
        !isEmptyRegionPair && (shouldAddForcedPadding || (currentNodeRequiresNewline && !nextLineEmpty));

    if (shouldAddPaddingWithNewline) {
        parts.push(hardlineDoc);
        previousNodeHadNewlineAddedAfter = true;
    } else if (isEmptyRegionPair) {
        // Set the flag even though we didn't emit a blank line: this prevents
        // addLeadingStatementSpacing from inserting one before the #endregion
        // on the next iteration, preserving the source round-trip.
        previousNodeHadNewlineAddedAfter = true;
    } else if (nextLineEmpty && !shouldSuppressExtraEmptyLine && !sanitizedMacroHasExplicitBlankLine) {
        // When the next statement has a leading comment immediately preceding it
        // and a blank line separates the current statement from that comment,
        // Prettier's built-in comment printing already emits a hardline before
        // the comment. Emitting one here too would produce a double blank line.
        // Detect this by checking whether the original source has a comment
        // immediately before the next node; if so, let Prettier handle spacing.
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
        const nextNodePrintsDocCommentBlock = Core.isNonEmptyArray(nextNode?.docComments);

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

function handleTerminalTrailingSpacing({
    childPath,
    parts,
    node,
    options,
    hardline: hardlineDoc,
    nodeEndIndex,
    suppressFollowingEmptyLine,
    isStaticDeclaration,
    hasFunctionInitializer,
    containerNode: _containerNode
}) {
    let previousNodeHadNewlineAddedAfter = false;
    const parentNode = childPath.parent;
    const isFunctionDeclarationNode = node?.type === "FunctionDeclaration";
    const trailingProbeIndex =
        node?.type === Core.DEFINE_STATEMENT || node?.type === Core.MACRO_DECLARATION ? nodeEndIndex : nodeEndIndex + 1;
    const enforceTrailingPadding = shouldAddNewlinesAroundStatement(node);
    const blockParent = safeGetParentNode(childPath) ?? childPath.parent;
    const constructorAncestor = safeGetParentNode(childPath, 1) ?? blockParent?.parent ?? null;
    const isConstructorBlock =
        blockParent?.type === "BlockStatement" && constructorAncestor?.type === "ConstructorDeclaration";
    const constructorHasParentClause = isConstructorBlock && constructorAncestor.parent != null;
    const shouldPreserveConstructorStaticPadding = isStaticDeclaration && hasFunctionInitializer && isConstructorBlock;
    let shouldPreserveTrailingBlankLine = false;
    const hasAttachedDocComment = node?.[DOC_COMMENT_OUTPUT_FLAG] === true || Core.isNonEmptyArray(node?.docComments);
    const requiresTrailingPadding =
        enforceTrailingPadding &&
        parentNode?.type === "BlockStatement" &&
        !suppressFollowingEmptyLine &&
        (!isFunctionDeclarationNode || (isFunctionDeclarationNode && constructorHasParentClause));

    if (parentNode?.type === "BlockStatement" && !suppressFollowingEmptyLine) {
        const originalText = typeof options.originalText === STRING_TYPE ? options.originalText : null;
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
            // Never keep a trailing blank line when the next non-whitespace character is the
            // constructor's closing brace; constructors should close without a blank gap
            // regardless of whether all members are static function declarations.
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
        const originalText = typeof options.originalText === STRING_TYPE ? options.originalText : null;
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
    shouldForceVariableBlockBeforeLoopPadding
};
