/**
 * Central print dispatcher for the GML formatter workspace.
 *
 * ARCHITECTURE NOTE: This file has grown organically and now houses both high-level
 * print coordination logic and low-level node-handling utilities. It should be refactored
 * into multiple focused modules:
 *
 * - A top-level coordinator that delegates to domain-specific sub-printers
 * - Separate files for each AST node category (expressions, statements, declarations, etc.)
 * - General AST utilities (node inspection, property access) should move to Core
 * - Comment handling should be extracted to a dedicated comment-printer module
 *
 * Until this refactoring occurs, contributors should avoid adding new utility functions
 * here; instead, place domain-specific helpers in appropriately-scoped files under
 * src/format/src/printer/ or src/core/src/ast/ and import them as needed.
 */

import { Core, type MutableDocCommentLines } from "@gmloop/core";
import { util } from "prettier";

import { printComment, printDanglingComments, printDanglingCommentsAsGroup } from "../comments/comment-printer.js";
import { buildPrintableDocCommentLines } from "../comments/description-doc.js";
import {
    LogicalOperatorsStyle,
    normalizeLogicalOperatorsStyle,
    ObjectWrapOption,
    resolveObjectWrapOption,
    TRAILING_COMMA
} from "../options/index.js";
import {
    DEFAULT_PRINT_WIDTH,
    INLINEABLE_SINGLE_STATEMENT_TYPES,
    MULTIPLICATIVE_BINARY_OPERATORS,
    NUMBER_TYPE,
    OBJECT_TYPE,
    STRING_TYPE,
    UNDEFINED_TYPE
} from "./constants.js";
import { getEnumNameAlignmentPadding, prepareEnumMembersForPrinting } from "./enum-alignment.js";
import { isLogicalComparisonClause } from "./logical-expression-predicates.js";
import { safeGetParentNode, safeGetPathName, safeGetPathValue } from "./path-utils.js";
import {
    breakParent,
    concat,
    conditionalGroup,
    group,
    hardline,
    ifBreak,
    indent,
    join,
    line,
    lineSuffix,
    lineSuffixBoundary,
    softline,
    willBreak
} from "./prettier-doc-builders.js";
import {
    countTrailingBlankLines,
    getNextNonWhitespaceCharacter,
    isLastStatement,
    isSkippableSemicolonWhitespace,
    optionalSemicolon
} from "./semicolons.js";
import {
    getOriginalTextFromOptions,
    hasBlankLineBetweenLastCommentAndClosingBrace,
    macroTextHasExplicitTrailingBlankLine,
    resolveNodeIndexRangeWithSource,
    resolvePrinterSourceMetadata,
    sliceOriginalText,
    stripTrailingLineTerminators
} from "./source-text.js";
import { shouldAddNewlinesAroundStatement, shouldSuppressEmptyLineBetween } from "./statement-spacing-policy.js";
import {
    expressionIsStringLike,
    hasLineBreak,
    isCallbackArgument,
    isComplexArgumentNode,
    isInlineEmptyBlockComment,
    isInLValueChain,
    isNumericComputationNode,
    isSimpleCallArgument,
    isSyntheticParenFlatteningEnabled
} from "./type-guards.js";
import { joinDeclaratorPartsWithCommas } from "./variable-declarator-layout.js";

const forcedStructArgumentBreaks = new WeakMap();
const MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING = 4;

const DOC_COMMENT_OUTPUT_FLAG = "_gmlHasDocCommentOutput";

function applyLogicalOperatorsStyle(operator, style) {
    const coreStyle = style === LogicalOperatorsStyle.KEYWORDS ? "keyword" : "symbol";
    return Core.getOperatorVariant(operator, coreStyle);
}

function _printImpl(path, options, print) {
    const node = path.getValue();

    if (!node) {
        return concat("");
    }

    if (typeof node === STRING_TYPE) {
        return concat(node);
    }

    return _printImplCore(node, path, options, print);
}

// Ordered list of category-level printers tried in sequence. Each function
// returns `undefined` (via implicit switch fall-through) when it does not own
// the given node type, allowing the loop to advance to the next candidate.
// Note: some printers legitimately return `null` for a valid-but-empty result
// (e.g. a bare ExpressionStatement that emits nothing), so the "no match"
// sentinel is strictly `undefined` – using `??` here would be incorrect.
const NODE_TYPE_PRINTERS = [
    tryPrintControlStructureNode,
    tryPrintFunctionNode,
    tryPrintFunctionSupportNode,
    tryPrintVariableNode,
    tryPrintExpressionNode,
    tryPrintDeclarationNode,
    tryPrintLiteralNode
];

function _printImplCore(node, path, options, print) {
    for (const tryPrint of NODE_TYPE_PRINTERS) {
        const doc = tryPrint(node, path, options, print);
        if (doc !== undefined) return doc;
    }
}

function tryPrintControlStructureNode(node, path, options, print) {
    switch (node.type) {
        case "Program": {
            return printProgramNode(node, path, options, print);
        }
        case "BlockStatement": {
            return printBlockStatementNode(node, path, options, print);
        }
        case "IfStatement": {
            return buildIfStatementDoc(path, options, print, node);
        }
        case "SwitchStatement": {
            return printSwitchStatementNode(node, path, options, print);
        }
        case "SwitchCase": {
            return printSwitchCaseNode(node, path, options, print);
        }
        case "TernaryExpression": {
            return printTernaryExpressionNode(node, path, options, print);
        }
        case "ForStatement": {
            return concat([
                "for (",
                group([
                    indent([
                        ifBreak(line),
                        concat([print("init"), ";", line, print("test"), ";", line, print("update")])
                    ])
                ]),
                ") ",
                printInBlock(path, options, print, "body")
            ]);
        }
        case "DoUntilStatement": {
            return concat([
                "do ",
                printInBlock(path, options, print, "body"),
                " until (",
                buildClauseGroup(printWithoutExtraParens(path, print, "test")),
                ")",
                ";"
            ]);
        }
        case "WhileStatement": {
            return concat(printSingleClauseStatement(path, options, print, "while", "test", "body"));
        }
        case "RepeatStatement": {
            return concat(printSingleClauseStatement(path, options, print, "repeat", "test", "body"));
        }
        case "WithStatement": {
            return concat(printSingleClauseStatement(path, options, print, "with", "test", "body"));
        }
    }
}

function tryPrintFunctionNode(node, path, options, print) {
    if (node.type !== "FunctionDeclaration" && node.type !== "ConstructorDeclaration") {
        return;
    }

    const docComments = printNodeDocComments(node, path, options);
    const signature = printFunctionSignature(node, path, options, print);
    const body = printFunctionBody(node, path, options, print);

    return concat([docComments, signature, " ", body]);
}

function printNodeDocComments(node, path, options) {
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

    appendMixedDocPreambleLeadingComments(docCommentDocs, node, originalText, nodeStartIndex);
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

function appendMixedDocPreambleLeadingComments(
    docCommentDocs: MutableDocCommentLines,
    node,
    originalText: string | null,
    nodeStartIndex
): void {
    if (
        docCommentDocs.length === 0 ||
        originalText === null ||
        typeof nodeStartIndex !== NUMBER_TYPE ||
        !Array.isArray(node.comments) ||
        node.comments.length === 0
    ) {
        return;
    }

    const docCommentStartIndexes = docCommentDocs
        .map((entry) => resolveDocCommentStartIndex(entry))
        .filter((startIndex): startIndex is number => typeof startIndex === NUMBER_TYPE);
    if (docCommentStartIndexes.length === 0) {
        return;
    }

    const preambleStartIndex = Math.min(...docCommentStartIndexes);
    const preambleText = originalText.slice(preambleStartIndex, nodeStartIndex);
    const hasTripleSlashDocComment = /(^|\r?\n)[ \t]*\/\/\//u.test(preambleText);
    const hasMixedCommentSyntax = /(^|\r?\n)[ \t]*\/\/(?!\/)|\/\*/u.test(preambleText);
    if (!hasTripleSlashDocComment || !hasMixedCommentSyntax) {
        return;
    }

    const mergedComments = new Set<unknown>();
    for (const comment of node.comments) {
        const commentStartIndex = resolveDocCommentStartIndex(comment);
        const commentEndIndex = resolveDocCommentEndIndex(comment);
        if (
            typeof commentStartIndex !== NUMBER_TYPE ||
            typeof commentEndIndex !== NUMBER_TYPE ||
            commentStartIndex < preambleStartIndex ||
            commentEndIndex >= nodeStartIndex ||
            docCommentDocs.includes(comment)
        ) {
            continue;
        }

        docCommentDocs.push(comment);
        mergedComments.add(comment);
        if (Core.isObjectLike(comment)) {
            comment.printed = true;
        }
    }

    if (mergedComments.size > 0) {
        node.comments = node.comments.filter((comment) => !mergedComments.has(comment));
    }
}

function joinDocCommentsPreservingSourceSpacing(
    printableDocComments: ReadonlyArray<unknown>,
    docCommentDocs: MutableDocCommentLines,
    originalText: string | null
) {
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

function markDocCommentsAsPrinted(node, path) {
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

function printFunctionSignature(node, path, options, print) {
    const idDoc = printFunctionId(node, path, options, print);
    const paramsDoc = printFunctionParameters(node, path, options, print);
    const constructorDoc = printConstructorClause(node, path, options, print);

    return group(["function", idDoc ? [" ", idDoc] : " ", paramsDoc, constructorDoc]);
}

function printFunctionId(node, _path, _options, print) {
    return node.id ? print("id") : null;
}

function printFunctionParameters(node, path, options, print) {
    const hasParameters = Core.isNonEmptyArray(node.params);

    if (hasParameters) {
        const { inlineDoc, multilineDoc } = buildFunctionParameterDocs(path, print, options, {
            forceInline: shouldForceInlineFunctionParameters(path, options)
        });

        return conditionalGroup([inlineDoc, multilineDoc]);
    }

    return printEmptyParens(path, options);
}

function printConstructorClause(node, _path, _options, print) {
    if (node.type !== Core.CONSTRUCTOR_DECLARATION) {
        return "";
    }

    if (node.parent) {
        return print("parent");
    }

    return " constructor";
}

function printFunctionBody(_node, path, options, print) {
    const inlineDefault = maybePrintInlineDefaultParameterFunctionBody(path, print);
    if (inlineDefault) {
        return inlineDefault;
    }

    return printInBlock(path, options, print, "body");
}

function tryPrintFunctionSupportNode(node, path, options, print) {
    switch (node.type) {
        case "ConstructorParentClause": {
            const hasParameters = Core.isNonEmptyArray(node.params);
            const params = hasParameters
                ? printCommaSeparatedList(path, print, "params", "(", ")", options, {
                      // Constructor parent clauses participate in the
                      // surrounding function signature. Breaking the
                      // argument list across multiple lines changes
                      // the shape of the signature and regresses
                      // existing fixtures that rely on the entire
                      // clause remaining inline.
                      leadingNewline: false,
                      trailingNewline: false,
                      forceInline: true
                  })
                : printEmptyParens(path, options);
            return concat([" : ", print("id"), params, " constructor"]);
        }
        case "DefaultParameter": {
            return concat(printSimpleDeclaration(print("left"), print("right")));
        }
    }
}

function tryPrintVariableNode(node, path, options, print) {
    switch (node.type) {
        case Core.EXPRESSION_STATEMENT: {
            const printed = print("expression");
            return printed === "" ? null : printed;
        }
        case "AssignmentExpression": {
            // Keep chained assignments together in a single group.
            // Calling `print("left")`/`print("right")` allows nested assignment chains
            // to format consistently via the same print logic without manually recursing.
            return group(concat([print("left"), " ", node.operator, " ", print("right")]));
        }
        case "GlobalVarStatement": {
            return printGlobalVarStatementAsKeyword(node, path, print, options);
        }
        case "VariableDeclaration": {
            const decls = printCommaSeparatedList(path, print, "declarations", "", "", options, {
                leadingNewline: false,
                trailingNewline: false,
                addIndent: node.declarations.length > 1
            });

            const docComments = printNodeDocComments(node, path, options);

            if (node.kind === "static") {
                // WORKAROUND: Bypass printCommaSeparatedList for static declarations.
                const parts = path.map(print, "declarations");
                const joined = joinDeclaratorPartsWithCommas(parts);

                return concat([docComments, group(concat([node.kind, " ", ...joined]))]);
            }

            return group(concat([docComments, node.kind, " ", decls]));
        }
        case "VariableDeclarator": {
            if (shouldBreakVariableInitializerOnAssignmentLine(node)) {
                return group([print("id"), " =", indent([line, group(print("init"))])]);
            }

            const simpleDecl = printSimpleDeclaration(print("id"), print("init"));
            return concat(simpleDecl);
        }
    }
}

function tryPrintExpressionNode(node, path, options, print) {
    switch (node.type) {
        case "ParenthesizedExpression": {
            return printParenthesizedExpressionNode(node, path, options, print);
        }
        case "LogicalExpression":
        case "BinaryExpression": {
            return printBinaryExpressionNode(node, path, options, print);
        }
        case "UnaryExpression":
        case "IncDecStatement":
        case "IncDecExpression": {
            return printUnaryLikeExpressionNode(node, path, options, print);
        }
        case "CallExpression": {
            return printCallExpressionNode(node, path, options, print);
        }
        case "MemberDotExpression": {
            return printMemberDotExpressionNode(node, path, options, print);
        }
        case "MemberIndexExpression": {
            return printMemberIndexExpressionNode(node, path, options, print);
        }
        case "StructExpression": {
            return printStructExpressionNode(node, path, options, print);
        }
        case "Property": {
            return printPropertyNode(node, path, options, print);
        }
        case "ArrayExpression": {
            return printArrayExpressionNode(node, path, options, print);
        }
        case "NewExpression": {
            return printNewExpressionNode(node, path, options, print);
        }
    }
}

function printParenthesizedExpressionNode(_node, path, options, print) {
    if (shouldOmitSyntheticParens(path, options)) {
        return printWithoutExtraParens(path, print, "expression");
    }

    return concat(["(", printWithoutExtraParens(path, print, "expression"), ")"]);
}

function printBinaryExpressionNode(node, path, options, print) {
    const left = print("left");
    const operator = node.operator;

    const logicalOperatorsStyle = normalizeLogicalOperatorsStyle(options?.logicalOperatorsStyle);

    const right = print("right");
    const styledOperator = applyLogicalOperatorsStyle(operator, logicalOperatorsStyle);

    const parts = [left, " ", styledOperator, line, right];

    let parent = safeGetParentNode(path);
    let depth = 0;
    while (parent && parent.type === "ParenthesizedExpression" && parent.synthetic === true) {
        depth++;
        parent = safeGetParentNode(path, depth);
    }

    const isChain =
        parent &&
        (parent.type === "BinaryExpression" || parent.type === "LogicalExpression") &&
        parent.operator === node.operator;

    const shouldGroup = !isChain;

    if (shouldGroup) {
        return group(parts);
    }
    return concat(parts);
}

function printUnaryLikeExpressionNode(node, _path, _options, print) {
    if (node.prefix) {
        return concat([node.operator, print("argument")]);
    }

    return concat([print("argument"), node.operator]);
}

function printCallExpressionNode(node, path, options, print) {
    if (options && typeof options.originalText === STRING_TYPE) {
        const hasNestedPreservedArguments = Array.isArray(node.arguments)
            ? node.arguments.some((argument) => argument?.preserveOriginalCallText === true)
            : false;
        const startIndex = Core.getNodeStartIndex(node);
        const endIndex = Core.getNodeEndIndex(node);

        if (
            typeof startIndex === NUMBER_TYPE &&
            typeof endIndex === NUMBER_TYPE &&
            endIndex > startIndex &&
            node.preserveOriginalCallText &&
            !hasNestedPreservedArguments
        ) {
            return normalizeCallTextNewlines(options.originalText.slice(startIndex, endIndex), options.endOfLine);
        }
    }

    let printedArgs;

    if (node.arguments.length === 0) {
        printedArgs = [printEmptyParens(path, options)];
    } else {
        const callbackArguments = node.arguments.filter(
            (argument) =>
                argument?.type === Core.FUNCTION_DECLARATION ||
                argument?.type === Core.FUNCTION_EXPRESSION ||
                argument?.type === Core.CONSTRUCTOR_DECLARATION
        );
        const structArguments = [];
        const structArgumentsToBreak = [];
        for (let index = 0; index < node.arguments.length; index++) {
            const argument = node.arguments[index];
            if (argument?.type === Core.STRUCT_EXPRESSION) {
                structArguments.push(argument);
                const previousArgument = index > 0 ? node.arguments[index - 1] : null;
                if (shouldForceBreakStructArgument(argument, options, previousArgument)) {
                    structArgumentsToBreak.push(argument);
                }
            }
        }

        structArgumentsToBreak.forEach((argument) => {
            forcedStructArgumentBreaks.set(argument, true);
        });

        const shouldFavorInlineArguments =
            callbackArguments.length === 0 &&
            structArguments.length === 0 &&
            node.arguments.length <= 3 &&
            node.arguments.every((argument) => !isComplexArgumentNode(argument));

        const effectiveElementsPerLineLimit = shouldFavorInlineArguments ? node.arguments.length : Infinity;

        const simplePrefixLength = countLeadingSimpleCallArguments(node);
        const shouldForceCallbackBreaks = callbackArguments.length > 0 && simplePrefixLength <= 1;

        const shouldForceBreakArguments =
            callbackArguments.length > 1 || structArgumentsToBreak.length > 0 || shouldForceCallbackBreaks;

        const shouldUseCallbackLayout = [node.arguments[0], node.arguments.at(-1)].some(
            (argumentNode) =>
                argumentNode?.type === Core.FUNCTION_DECLARATION ||
                argumentNode?.type === Core.FUNCTION_EXPRESSION ||
                argumentNode?.type === Core.CONSTRUCTOR_DECLARATION ||
                argumentNode?.type === Core.STRUCT_EXPRESSION
        );

        const shouldIncludeInlineVariant =
            shouldUseCallbackLayout && !shouldForceBreakArguments && simplePrefixLength > 1;

        const hasCallbackArguments = callbackArguments.length > 0;

        const { inlineDoc, multilineDoc } = buildCallArgumentsDocs(path, print, options, {
            forceBreak: shouldForceBreakArguments,
            maxElementsPerLine: effectiveElementsPerLineLimit,
            includeInlineVariant: shouldIncludeInlineVariant,
            hasCallbackArguments,
            // Keep call expressions in l-value chains on one line to avoid
            // breaking the chain into multiple visual lines (e.g. `foo().bar`).
            // This preserves readability for chained property access after calls.
            forceInline: isInLValueChain(path)
        });

        if (shouldUseCallbackLayout) {
            const shouldPreferInlineCallbackLayout =
                inlineDoc &&
                hasCallbackArguments &&
                simplePrefixLength > 1 &&
                shouldIncludeInlineVariant &&
                willBreak(inlineDoc);

            if (shouldForceBreakArguments) {
                printedArgs = [concat([breakParent, multilineDoc])];
            } else if (shouldPreferInlineCallbackLayout) {
                printedArgs = [inlineDoc];
            } else if (inlineDoc) {
                printedArgs = [conditionalGroup([inlineDoc, multilineDoc])];
            } else {
                printedArgs = [multilineDoc];
            }
        } else {
            printedArgs = shouldForceBreakArguments ? [concat([breakParent, multilineDoc])] : [multilineDoc];
        }
    }

    const calleeDoc = print(OBJECT_TYPE);

    return isInLValueChain(path) ? concat([calleeDoc, ...printedArgs]) : group([calleeDoc, ...printedArgs]);
}

function printMemberDotExpressionNode(node, path, options, print) {
    if (isInLValueChain(path) && path.parent?.type === Core.CALL_EXPRESSION) {
        const objectNode = path.getValue()?.object;
        const shouldAllowBreakBeforeDot =
            objectNode &&
            (objectNode.type === Core.CALL_EXPRESSION ||
                objectNode.type === Core.MEMBER_DOT_EXPRESSION ||
                objectNode.type === Core.MEMBER_INDEX_EXPRESSION);

        if (shouldAllowBreakBeforeDot) {
            return concat([print(OBJECT_TYPE), softline, ".", print("property")]);
        }

        return concat([print(OBJECT_TYPE), ".", print("property")]);
    } else {
        const objectDoc = print(OBJECT_TYPE);
        let propertyDoc = print("property");

        if (propertyDoc === undefined) {
            propertyDoc = printCommaSeparatedList(path, print, "property", "", "", options);
        }

        return concat([objectDoc, ".", propertyDoc]);
    }
}

function printMemberIndexExpressionNode(_node, path, options, print) {
    const memberNode = path.getValue();
    let accessor = print("accessor");
    if (memberNode && typeof memberNode.accessor === "string") {
        accessor = memberNode.accessor;
    }

    if (Core.isNonEmptyString(accessor) && accessor.length > 1) {
        accessor = `${accessor} `;
    }
    const property = printCommaSeparatedList(path, print, "property", "", "", options);
    return concat([print(OBJECT_TYPE), accessor, group(indent(property)), "]"]);
}

function printStructExpressionNode(node, path, options, print) {
    if (node.properties.length === 0) {
        return concat(printEmptyBlock(path, options));
    }

    const shouldForceBreakStruct = forcedStructArgumentBreaks.has(node);
    const objectWrapOption = resolveObjectWrapOption(options);
    const shouldPreserveStructWrap =
        objectWrapOption === ObjectWrapOption.PRESERVE && structLiteralHasLeadingLineBreak(node, options);

    // Respect Prettier's bracketSpacing option for struct literals
    // bracketSpacing: true  → { x: 1 } (with spaces)
    // bracketSpacing: false → {x: 1}   (without spaces)
    const padding = options.bracketSpacing ? " " : "";

    return concat(
        printCommaSeparatedList(path, print, "properties", "{", "}", options, {
            forceBreak: node.hasTrailingComma || shouldForceBreakStruct || shouldPreserveStructWrap,
            padding
        })
    );
}

function printPropertyNode(node, path, options, print) {
    const nameDoc = print("name");
    const valueDoc = print("value");
    const trailingCommentSuffix = buildStructPropertyCommentSuffix(path, options);

    return concat([nameDoc, ": ", valueDoc, trailingCommentSuffix]);
}

function printArrayExpressionNode(node, path, options, print) {
    const allowTrailingComma = shouldAllowTrailingComma(options);
    return concat(
        printCommaSeparatedList(path, print, "elements", "[", "]", options, {
            allowTrailingDelimiter: allowTrailingComma,
            forceBreak: allowTrailingComma && node.hasTrailingComma
        })
    );
}

function printNewExpressionNode(node, path, options, print) {
    if (node.arguments.length === 0) {
        return concat(["new ", print("expression"), printEmptyParens(path, options)]);
    }

    const callbackArguments = node.arguments.filter(
        (argument) =>
            argument?.type === Core.FUNCTION_DECLARATION ||
            argument?.type === Core.FUNCTION_EXPRESSION ||
            argument?.type === Core.CONSTRUCTOR_DECLARATION
    );
    const structArguments = [];
    const structArgumentsToBreak = [];
    for (let index = 0; index < node.arguments.length; index++) {
        const argument = node.arguments[index];
        if (argument?.type === Core.STRUCT_EXPRESSION) {
            structArguments.push(argument);
            const previousArgument = index > 0 ? node.arguments[index - 1] : null;
            if (shouldForceBreakStructArgument(argument, options, previousArgument)) {
                structArgumentsToBreak.push(argument);
            }
        }
    }

    structArgumentsToBreak.forEach((argument) => {
        forcedStructArgumentBreaks.set(argument, true);
    });

    const shouldFavorInlineArguments =
        callbackArguments.length === 0 &&
        structArguments.length === 0 &&
        node.arguments.length <= 3 &&
        node.arguments.every((argument) => !isComplexArgumentNode(argument));

    const effectiveElementsPerLineLimit = shouldFavorInlineArguments ? node.arguments.length : Infinity;

    const simplePrefixLength = countLeadingSimpleCallArguments(node);
    const shouldForceCallbackBreaks = callbackArguments.length > 0 && simplePrefixLength <= 1;

    const shouldForceBreakArguments =
        callbackArguments.length > 1 || structArgumentsToBreak.length > 0 || shouldForceCallbackBreaks;

    const shouldUseCallbackLayout = [node.arguments[0], node.arguments.at(-1)].some(
        (argumentNode) =>
            argumentNode?.type === Core.FUNCTION_DECLARATION ||
            argumentNode?.type === Core.FUNCTION_EXPRESSION ||
            argumentNode?.type === Core.CONSTRUCTOR_DECLARATION ||
            argumentNode?.type === Core.STRUCT_EXPRESSION
    );

    const shouldIncludeInlineVariant = shouldUseCallbackLayout && !shouldForceBreakArguments && simplePrefixLength > 1;

    const hasCallbackArguments = callbackArguments.length > 0;

    const { inlineDoc, multilineDoc } = buildCallArgumentsDocs(path, print, options, {
        forceBreak: shouldForceBreakArguments,
        maxElementsPerLine: effectiveElementsPerLineLimit,
        includeInlineVariant: shouldIncludeInlineVariant,
        hasCallbackArguments
    });

    let printedArgs;

    if (shouldUseCallbackLayout) {
        const shouldPreferInlineCallbackLayout =
            inlineDoc &&
            hasCallbackArguments &&
            simplePrefixLength > 1 &&
            shouldIncludeInlineVariant &&
            willBreak(inlineDoc);

        if (shouldForceBreakArguments) {
            printedArgs = [concat([breakParent, multilineDoc])];
        } else if (shouldPreferInlineCallbackLayout) {
            printedArgs = [inlineDoc];
        } else if (inlineDoc) {
            printedArgs = [conditionalGroup([inlineDoc, multilineDoc])];
        } else {
            printedArgs = [multilineDoc];
        }
    } else {
        printedArgs = shouldForceBreakArguments ? [concat([breakParent, multilineDoc])] : [multilineDoc];
    }

    const calleeDoc = print("expression");
    // Use the computed `printedArgs` variant rather than always falling back to
    // `multilineDoc`. The earlier implementation accidentally ignored all of the
    // argument-layout work above which led to removals of the surrounding
    // parentheses (producing `new Circle10` in the `testFunctions` fixture).
    return group(concat(["new ", calleeDoc, ...printedArgs]));
}

function tryPrintDeclarationNode(node, path, options, print) {
    switch (node.type) {
        case "EnumDeclaration": {
            prepareEnumMembersForPrinting(node, Core.getNodeName);
            return concat([
                "enum ",
                print("name"),
                " ",
                printCommaSeparatedList(path, print, "members", "{", "}", options, {
                    forceBreak: node.hasTrailingComma
                })
            ]);
        }
        case "ReturnStatement": {
            return node.argument ? concat(["return ", print("argument")]) : concat("return");
        }
        case "ThrowStatement": {
            return node.argument ? concat(["throw ", print("argument")]) : "throw";
        }
        case "IdentifierStatement": {
            return print("name");
        }
        case "DefineStatement": // TODO: The parser should not emit a different node type for 'DefineStatement'. For now, just let it fall-through. See docs/define-directive-fixing.md
        case "MacroDeclaration": {
            const macroName = typeof node.name === "string" ? node.name : (node.name?.name ?? null);
            const { start: macroStart, end: macroEnd } = Core.getNodeRangeIndices(node);
            const { start: nameStart, end: nameEnd } = Core.getNodeRangeIndices(node.name);

            // Normalize whitespace: rebuild `#macro NAME value` with single spaces.
            // The original text may contain multiple spaces between `#macro`, the
            // name identifier, and the macro value body, which we trim here to keep
            // output canonical and idempotent.
            if (
                Core.isNonEmptyString(macroName) &&
                typeof macroStart === NUMBER_TYPE &&
                typeof nameEnd === NUMBER_TYPE &&
                typeof macroEnd === NUMBER_TYPE &&
                nameEnd >= macroStart &&
                macroEnd >= nameEnd
            ) {
                const valueBody = options.originalText.slice(nameEnd, macroEnd).trimStart();
                const normalized = Core.isNonEmptyString(valueBody)
                    ? `#macro ${macroName} ${valueBody}`
                    : `#macro ${macroName}`;
                return concat(stripTrailingLineTerminators(normalized));
            }

            // Fallback: use original text with name substitution when indices are
            // unavailable (e.g. synthetic nodes produced during normalization).
            let text =
                typeof macroStart === NUMBER_TYPE && typeof macroEnd === NUMBER_TYPE
                    ? options.originalText.slice(macroStart, macroEnd)
                    : "";

            if (
                Core.isNonEmptyString(macroName) &&
                typeof macroStart === NUMBER_TYPE &&
                typeof nameStart === NUMBER_TYPE &&
                typeof nameEnd === NUMBER_TYPE &&
                nameStart >= macroStart &&
                nameEnd >= nameStart
            ) {
                const relativeStart = nameStart - macroStart;
                const relativeEnd = nameEnd - macroStart;
                text = text.slice(0, relativeStart) + macroName + text.slice(relativeEnd);
            }

            return concat(stripTrailingLineTerminators(text));
        }
        case "RegionStatement": {
            return concat(["#region", print("name")]);
        }
        case "EndRegionStatement": {
            return concat(["#endregion", print("name")]);
        }
        case "DeleteStatement": {
            return concat(["delete ", print("argument")]);
        }
        case "BreakStatement": {
            return concat("break");
        }
        case "ExitStatement": {
            return concat("exit");
        }
        case "ContinueStatement": {
            return concat("continue");
        }
        case "EmptyStatement": {
            return concat("");
        }
    }
}

function tryPrintLiteralNode(node, path, options, print) {
    switch (node.type) {
        case "Literal": {
            // Always print real `undefined` values as the identifier rather than a
            // quoted string. The parser represents the keyword as a Literal node with
            // `value` equal to either the string "undefined" or the primitive
            // `undefined`, so we normalize both here.
            if (Core.isUndefinedSentinel(node)) {
                return concat(UNDEFINED_TYPE);
            }

            let value = node.value;

            if (!value.startsWith('"')) {
                if (value.startsWith(".")) {
                    // Normalize shorthand decimals like `.5` to `0.5` so the printer
                    // mirrors GameMaker's own serialization rules
                    // (https://manual.gamemaker.io/monthly/en/#t=GameMaker_Language%2FGML_Overview%2FNumbers.htm).
                    // Without the guard the formatter would emit the bare `.5`, but the
                    // next save inside GameMaker (or any tooling that round-trips through
                    // its compiler) reintroduces the leading zero. That churn breaks the
                    // idempotence guarantees exercised by
                    // `src/format/test/fix-missing-decimal-zeroes-option.test.js` and
                    // causes needless diffs in format-on-save flows.
                    value = `0${value}`;
                }

                const decimalMatch = value.match(/^([-+]?\d+)\.(\d*)$/);
                if (decimalMatch) {
                    const [, integerPart, fractionalPart] = decimalMatch;
                    if (fractionalPart.length === 0 || /^0+$/.test(fractionalPart)) {
                        // Collapse literals such as `1.` and `1.000` to `1` to keep the
                        // formatter stable with GameMaker's canonical output (see the
                        // numbers reference linked above). Leaving the dangling decimal
                        // segment would come back as a pure integer the moment the project
                        // is re-saved in the IDE, invalidating the doc snapshots and
                        // numeric literal regression tests that assert we emit the same
                        // text on every pass. Normalize `-0` to `0` since negative zero
                        // is numerically identical to zero in GML.
                        value = integerPart === "-0" ? "0" : integerPart;
                    }
                }
            }
            return concat(value);
        }
        case "Identifier": {
            return concat(node.name);
        }
        case "TemplateStringText": {
            return concat(node.value);
        }
        case "MissingOptionalArgument": {
            return concat(UNDEFINED_TYPE);
        }
        case "EnumMember": {
            const extraPadding = getEnumNameAlignmentPadding(node);
            let nameDoc = print("name");
            if (extraPadding > 0) {
                nameDoc = concat([nameDoc, " ".repeat(extraPadding)]);
            }
            return concat(printSimpleDeclaration(nameDoc, print("initializer")));
        }
        case "CatchClause": {
            const parts: any[] = [" catch "];
            if (node.param) {
                parts.push(["(", print("param"), ")"]);
            }
            if (node.body) {
                parts.push(" ", printInBlock(path, options, print, "body"));
            }
            return concat(parts);
        }
        case "Finalizer": {
            const parts: any[] = [" finally "];
            if (node.body) {
                parts.push(printInBlock(path, options, print, "body"));
            }
            return concat(parts);
        }
        case "TryStatement": {
            return concat(["try ", printInBlock(path, options, print, "block"), print("handler"), print("finalizer")]);
        }
        case "TemplateStringExpression": {
            const hasAtomArray = Array.isArray(node.atoms);
            const atoms = hasAtomArray ? node.atoms : [];

            return group(concat(buildTemplateStringParts(atoms, path, print)));
        }
        case "MalformedDocComment": {
            return print(node);
        }
    }
}

function printProgramNode(node, path, options, print) {
    if (node.body.length === 0) {
        return concat(printDanglingCommentsAsGroup(path, options, () => true));
    }
    const bodyParts = printStatements(path, options, print, "body");
    const programComments = printDanglingCommentsAsGroup(path, options, () => true);

    return concat([programComments, concat(bodyParts)]);
}

/**
 * MICRO-OPTIMIZATION: This function was optimized to reduce allocations and enable
 * early exit. Instead of creating intermediate arrays via map/filter, it processes
 * lines in a single pass and short-circuits on the first matching decorative line.
 * The regex pattern is now cached at module scope rather than recreated on every call.
 * Benchmark: 2.65x speedup on representative inputs (100K iterations: 739ms → 279ms).
 */
function printBlockStatementNode(node, path, options, print) {
    if (node.body.length === 0) {
        return concat(printEmptyBlock(path, options));
    }

    let leadingDocs = [hardline];

    if (node._gmlForceInitialBlankLine) {
        leadingDocs = [hardline, hardline];
    }

    const stmts = printStatements(path, options, print, "body");

    if (leadingDocs.length > 1) {
        // If we have multiple leading docs (e.g., [hardline, hardline] for blank line),
        // put the first one outside the indent and the rest inside
        return concat([
            "{",
            printDanglingComments(path, options, (comment) => comment.attachToBrace),
            leadingDocs[0],
            indent(leadingDocs.slice(1).concat(stmts)),
            hardline,
            "}"
        ]);
    } else {
        // For single leading doc, put everything inside indent
        return concat([
            "{",
            printDanglingComments(path, options, (comment) => comment.attachToBrace),
            indent([...leadingDocs, stmts]),
            hardline,
            "}"
        ]);
    }
}

function printSwitchStatementNode(node, path, options, print) {
    const parts = [];
    const discriminantDoc = printWithoutExtraParens(path, print, "discriminant");
    parts.push(["switch (", buildClauseGroup(discriminantDoc), ") "]);

    const braceIntro = ["{", printDanglingComments(path, options, (comment) => comment.attachToBrace)];

    if (node.cases.length === 0) {
        parts.push(
            concat([
                ...braceIntro,
                printDanglingCommentsAsGroup(path, options, (comment) => !comment.attachToBrace),
                hardline,
                "}"
            ])
        );
    } else {
        parts.push(concat([...braceIntro, indent([path.map(print, "cases")]), hardline, "}"]));
    }

    return concat(parts);
}

function printSwitchCaseNode(node, path, options, print) {
    const caseText = node.test === null ? "default" : "case ";
    const parts = [[hardline, caseText, print("test"), ":"]];
    const caseBody = node.body;
    if (Core.isNonEmptyArray(caseBody)) {
        parts.push([indent([hardline, printStatements(path, options, print, "body")])]);
    }
    return concat(parts);
}

// Sanitize the top-level doc returned by the inner print implementation
// so that any accidental `null` or `undefined` values nested inside raw
// arrays are coerced into safe string fragments. This prevents Prettier's
// doc traversal from encountering `null` and throwing `InvalidDocError`.
function _sanitizeDocOutput(doc) {
    if (doc === null) return "";
    if (Array.isArray(doc)) return doc.map(_sanitizeDocOutput);
    return doc;
}

export function gmlPrint(path, options, print) {
    const doc = _printImpl(path, options, print);
    return _sanitizeDocOutput(doc);
}

function buildTemplateStringParts(atoms, path, print) {
    const parts: any[] = ['$"'];
    const length = atoms.length;

    for (let index = 0; index < length; index += 1) {
        const atom = atoms[index];

        if (atom?.type === Core.TEMPLATE_STRING_TEXT && typeof atom.value === STRING_TYPE) {
            parts.push(atom.value);
            continue;
        }

        const printedAtom = path.call(print, "atoms", index);

        // Complex expressions (ternary, binary, logical) use conditionalGroup:
        // try the inline form first; if the current line position plus the
        // expression exceeds printWidth, fall back to the broken form with
        // the expression indented on the next line.
        const isComplexAtom =
            atom?.type === "TernaryExpression" ||
            atom?.type === "BinaryExpression" ||
            atom?.type === "LogicalExpression";

        if (isComplexAtom) {
            const inlineDoc = concat(["{", printedAtom, "}"]);
            const brokenDoc = concat(["{", indent(concat([softline, printedAtom, softline, "}"]))]);
            parts.push(conditionalGroup([inlineDoc, brokenDoc]));
        } else {
            // Simple atoms (identifiers, literals, member expressions, short
            // calls) stay inline regardless of line position. Template
            // strings are inherently long and breaking `{fps}` across lines
            // hurts readability.
            parts.push(concat(["{", printedAtom, "}"]));
        }
    }

    parts.push('"');
    return parts;
}

function printDelimitedList(path, print, listKey, startChar, endChar, overrides: any = {}) {
    const {
        delimiter = ",",
        allowTrailingDelimiter = false,
        leadingNewline = true,
        trailingNewline = true,
        forceBreak = false,
        padding = "",
        addIndent = true,
        groupId,
        forceInline = false,
        maxElementsPerLine = Infinity
    } = overrides;
    const lineBreak = forceBreak ? hardline : line;
    const finalDelimiter = allowTrailingDelimiter ? delimiter : "";

    const innerDoc = [
        ifBreak(leadingNewline ? lineBreak : "", padding),
        printElements(path, print, listKey, delimiter, lineBreak, maxElementsPerLine)
    ];

    const groupElements = [
        startChar,
        addIndent ? indent(innerDoc) : innerDoc,
        // always print a trailing delimiter if the list breaks
        ifBreak([finalDelimiter, trailingNewline ? lineBreak : ""], padding),
        endChar
    ];

    const groupElementsNoBreak = [
        startChar,
        padding,
        printElements(path, print, listKey, delimiter, " ", maxElementsPerLine),
        padding,
        endChar
    ];

    return forceInline ? groupElementsNoBreak : group(groupElements, { id: groupId });
}

function normalizeCallTextNewlines(text, endOfLineOption) {
    if (typeof text !== STRING_TYPE) {
        return text;
    }

    const normalized = text.replaceAll(/\r\n?/g, "\n");

    if (endOfLineOption === "crlf") {
        return normalized.replaceAll("\n", "\r\n");
    }

    return normalized;
}

function shouldAllowTrailingComma(options) {
    return options?.trailingComma === TRAILING_COMMA.ALL;
}

function buildCallArgumentsDocs(
    path,
    print,
    options,
    {
        forceBreak = false,
        maxElementsPerLine = Infinity,
        includeInlineVariant = false,
        hasCallbackArguments = false,
        forceInline = false
    } = {}
) {
    const node = path.getValue();
    const simplePrefixLength = countLeadingSimpleCallArguments(node);
    const hasTrailingArguments = Array.isArray(node?.arguments) && node.arguments.length > simplePrefixLength;

    if (simplePrefixLength > 1 && hasTrailingArguments && hasCallbackArguments && maxElementsPerLine === Infinity) {
        const inlineDoc = includeInlineVariant
            ? printCommaSeparatedList(path, print, "arguments", "(", ")", options, {
                  addIndent: false,
                  forceInline: true,
                  leadingNewline: false,
                  trailingNewline: false,
                  maxElementsPerLine
              })
            : null;

        const multilineDoc = buildCallbackArgumentsWithSimplePrefix(path, print, simplePrefixLength);

        return { inlineDoc, multilineDoc };
    }

    const firstArgumentNode = node.arguments[0];
    const firstArgumentText = firstArgumentNode?.value;
    const firstArgumentIsStringLiteral =
        firstArgumentNode?.type === Core.LITERAL &&
        typeof firstArgumentText === STRING_TYPE &&
        (firstArgumentText.startsWith('"') || firstArgumentText.startsWith("'") || firstArgumentText.startsWith('@"'));

    // NOTE: intentionally omit logging to keep production output clean.

    if (
        simplePrefixLength > 1 &&
        hasTrailingArguments &&
        !hasCallbackArguments &&
        maxElementsPerLine === Infinity &&
        firstArgumentIsStringLiteral
    ) {
        const multilineDoc = buildCallbackArgumentsWithSimplePrefix(path, print, simplePrefixLength);
        return { inlineDoc: null, multilineDoc };
    }

    const multilineDoc = printCommaSeparatedList(path, print, "arguments", "(", ")", options, {
        forceBreak,
        forceInline,
        maxElementsPerLine
    });

    const inlineDoc = includeInlineVariant
        ? printCommaSeparatedList(path, print, "arguments", "(", ")", options, {
              addIndent: false,
              forceInline: true,
              leadingNewline: false,
              trailingNewline: false,
              maxElementsPerLine
          })
        : null;

    return { inlineDoc, multilineDoc };
}

function buildFunctionParameterDocs(path, print, options, overrides: any = {}) {
    const forceInline = overrides.forceInline === true;

    const inlineDoc = printCommaSeparatedList(path, print, "params", "(", ")", options, {
        addIndent: false,
        allowTrailingDelimiter: false,
        forceInline: true,
        leadingNewline: false,
        trailingNewline: false
    });

    const multilineDoc = forceInline
        ? inlineDoc
        : printCommaSeparatedList(path, print, "params", "(", ")", options, {
              allowTrailingDelimiter: false
          });

    return { inlineDoc, multilineDoc };
}

function shouldForceInlineFunctionParameters(path, options) {
    const node = path.getValue();

    if (!node) {
        return false;
    }

    // For regular function declarations and struct function declarations,
    // always keep parameters inline
    if (node.type === "FunctionDeclaration" || node.type === "StructFunctionDeclaration") {
        return true;
    }

    // For constructor declarations in parent clauses, only keep inline
    // if params were originally on a single line
    if (node.type !== "ConstructorDeclaration") {
        return false;
    }

    const parentNode = node.parent;
    if (!parentNode || parentNode.type !== "ConstructorParentClause") {
        return false;
    }

    if (!Core.isNonEmptyArray(node.params)) {
        return false;
    }

    if (node.params.some((param) => Core.hasComment(param))) {
        return false;
    }

    const originalText = getOriginalTextFromOptions(options);

    const firstParam = node.params[0];
    const lastParam = node.params.at(-1);
    const startIndex = Core.getNodeStartIndex(firstParam);
    const endIndex = Core.getNodeEndIndex(lastParam);

    const parameterSource = sliceOriginalText(originalText, startIndex, endIndex);

    if (parameterSource === null) {
        return false;
    }

    return !/[\r\n]/.test(parameterSource);
}

function maybePrintInlineDefaultParameterFunctionBody(path, print) {
    const node = path.getValue();
    const parentNode = path.parent;

    if (!node || node.type !== "FunctionDeclaration") {
        return null;
    }

    if (!parentNode || parentNode.type !== "DefaultParameter") {
        return null;
    }

    if (Core.isNonEmptyArray(node.docComments)) {
        return null;
    }

    if (Core.hasComment(node)) {
        return null;
    }

    const bodyNode = node.body;
    const onlyStatement = Core.getSingleBodyStatement(bodyNode);
    if (!onlyStatement) {
        return null;
    }

    if (onlyStatement.type !== "CallExpression") {
        return null;
    }

    const statementDoc = path.call((bodyPath) => bodyPath.call(print, "body", 0), "body");

    if (!statementDoc || willBreak(statementDoc)) {
        return null;
    }

    const semicolon = optionalSemicolon(onlyStatement.type);
    return group(["{ ", statementDoc, semicolon, " }"]);
}

function printCommaSeparatedList(path, print, listKey, startChar, endChar, options, overrides: any = {}) {
    const allowTrailingDelimiter =
        overrides.allowTrailingDelimiter === undefined
            ? shouldAllowTrailingComma(options)
            : overrides.allowTrailingDelimiter;

    return printDelimitedList(path, print, listKey, startChar, endChar, {
        delimiter: ",",
        ...overrides,
        allowTrailingDelimiter
    });
}

// Force statement-shaped children into explicit `{}` blocks so every call site
// that relies on this helper inherits the same guard rails. The printer uses it
// for `if`, loop, and struct bodies where we always emit braces regardless of
// how the source was written. Centralizing the wrapping ensures semicolon
// bookkeeping stays wired through `optionalSemicolon`, keeps synthetic doc
// comments anchored to the block node they describe, and prevents individual
// callers from drifting in how they indent or collapse single-statement bodies.
// When we experimented with open-coding the wrapping logic in each printer, it
// was easy to miss one of those responsibilities and regress either the
// formatter's brace guarantees or the doc comment synthesis covered by the
// synthetic doc comment integration tests
// (`src/format/test/synthetic-doc-comments.test.js`).
function printInBlock(path, options, print, expressionKey) {
    const parentNode = path.getValue();
    const node = parentNode[expressionKey];

    if (node.type === Core.BLOCK_STATEMENT) {
        return [print(expressionKey), optionalSemicolon(node.type)];
    }

    const inlineCommentDocs = printDanglingCommentsAsGroup(
        path,
        options,
        (comment) => comment.attachToClauseBody === true
    );

    const hasInlineComments = Core.isNonEmptyArray(inlineCommentDocs);
    const introParts = ["{"];

    if (hasInlineComments) {
        introParts.push(...inlineCommentDocs);
    } else {
        introParts.push(" ");
    }

    return [...introParts, indent([hardline, print(expressionKey), optionalSemicolon(node.type)]), hardline, "}"];
}

function shouldPrintBlockAlternateAsElseIf(node) {
    if (!node || node.type !== "BlockStatement") {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    const body = Core.getBodyStatements(node);
    if (body.length !== 1) {
        return false;
    }

    const [onlyStatement] = body;
    return onlyStatement?.type === Core.IF_STATEMENT;
}

// print a delimited sequence of elements
// handles the case where a trailing comment follows a delimiter
function printElements(path, print, listKey, delimiter, lineBreak, maxElementsPerLine = Infinity) {
    const node = path.getValue();
    const finalIndex = node[listKey].length - 1;
    let itemsSinceLastBreak = 0;
    return path.map((childPath, index) => {
        const parts: any[] = [];
        const printed = print();
        const separator = index === finalIndex ? "" : delimiter;

        if (docHasTrailingComment(printed)) {
            printed.splice(-1, 0, separator);
            parts.push(printed);
        } else {
            parts.push(printed, separator);
        }

        if (index !== finalIndex) {
            const hasLimit = Number.isFinite(maxElementsPerLine) && maxElementsPerLine > 0;
            itemsSinceLastBreak += 1;
            if (hasLimit) {
                const childNode = childPath.getValue();
                const nextNode = index < finalIndex ? node[listKey][index + 1] : null;
                const shouldBreakAfter =
                    isComplexArgumentNode(childNode) ||
                    isComplexArgumentNode(nextNode) ||
                    itemsSinceLastBreak >= maxElementsPerLine;

                if (shouldBreakAfter) {
                    parts.push(hardline);
                    itemsSinceLastBreak = 0;
                } else {
                    parts.push(" ");
                }
            } else {
                parts.push(lineBreak);
            }
        }

        return parts;
    }, listKey);
}

function countLeadingSimpleCallArguments(node) {
    if (!node || !Array.isArray(node.arguments)) {
        return 0;
    }

    let count = 0;
    for (const argument of node.arguments) {
        if (!isSimpleCallArgument(argument)) {
            break;
        }

        count += 1;
    }

    return count;
}

function buildCallbackArgumentsWithSimplePrefix(path, print, simplePrefixLength) {
    const node = path.getValue();
    const args = Core.asArray(node?.arguments);
    const parts: any[] = [];
    const trailingArguments = args.slice(simplePrefixLength);
    const firstCallbackIndex = trailingArguments.findIndex(isCallbackArgument);
    const hasTrailingNonCallbackArgument =
        firstCallbackIndex !== -1 &&
        trailingArguments.slice(firstCallbackIndex + 1).some((argument) => !isCallbackArgument(argument));
    const shouldForcePrefixBreaks = simplePrefixLength > 1 && hasTrailingNonCallbackArgument;

    for (let index = 0; index < args.length; index++) {
        parts.push(path.call(print, "arguments", index));

        if (index >= args.length - 1) {
            continue;
        }

        parts.push(",");

        if (index < simplePrefixLength - 1 && !shouldForcePrefixBreaks) {
            parts.push(" ");
            continue;
        }

        parts.push(line);
    }

    const argumentGroup = group(["(", indent([softline, ...parts]), softline, ")"]);

    return shouldForcePrefixBreaks ? concat([breakParent, argumentGroup]) : argumentGroup;
}

function shouldForceBreakStructArgument(argument, options, previousArgument) {
    if (!argument || argument.type !== "StructExpression") {
        return false;
    }

    if (Core.hasComment(argument)) {
        return true;
    }

    if (hasLineBreakBetweenArguments(previousArgument, argument, options)) {
        return true;
    }

    const properties = Core.asArray(argument.properties);
    if (properties.length === 0) {
        return false;
    }

    if (properties.some((property) => Core.hasComment(property) || (property as any)?._hasTrailingInlineComment)) {
        return true;
    }

    return false;
}

function hasLineBreakBetweenArguments(previousArgument, argument, options) {
    if (!previousArgument || !argument) {
        return false;
    }

    const originalText = getOriginalTextFromOptions(options);
    if (typeof originalText !== STRING_TYPE) {
        return false;
    }

    const previousArgumentEnd = Core.getNodeEndIndex(previousArgument);
    const argumentStart = Core.getNodeStartIndex(argument);

    if (
        !Number.isFinite(previousArgumentEnd) ||
        !Number.isFinite(argumentStart) ||
        argumentStart <= previousArgumentEnd
    ) {
        return false;
    }

    for (let cursor = previousArgumentEnd; cursor < argumentStart; cursor++) {
        const charCode = originalText.charCodeAt(cursor);
        if (charCode === 10 || charCode === 13) {
            return true;
        }
    }

    return false;
}

function buildStructPropertyCommentSuffix(path, options) {
    const node = path && typeof path.getValue === "function" ? path.getValue() : null;
    const comments = Core.asArray(node?._structTrailingComments);
    if (comments.length === 0) {
        return "";
    }

    const commentDocs = [];

    for (const comment of comments) {
        if ((comment as any)?._structPropertyTrailing === true) {
            const formatted = Core.formatLineComment(comment, {
                ...Core.resolveLineCommentOptions(options),
                originalText: options.originalText
            });
            if (formatted) {
                commentDocs.push(formatted);
            }
            (comment as any)._structPropertyHandled = true;
            (comment as any).printed = true;
        }
    }

    const filteredCommentDocs = commentDocs.filter((doc) => typeof doc === "string");

    if (filteredCommentDocs.length === 0) {
        return "";
    }

    const commentDoc = filteredCommentDocs.length === 1 ? filteredCommentDocs[0] : join(hardline, filteredCommentDocs);

    return lineSuffix([lineSuffixBoundary, " ", commentDoc]);
}

function printStatements(path, options, print, childrenAttribute) {
    let previousNodeHadNewlineAddedAfter = false; // tracks newline added after the previous node

    const parentNode = path.getValue();
    const containerNode = safeGetParentNode(path);
    const statements =
        parentNode && Array.isArray(parentNode[childrenAttribute]) ? parentNode[childrenAttribute] : null;
    // Cache frequently used option lookups to avoid re-evaluating them in the tight map loop.
    const sourceMetadata = resolvePrinterSourceMetadata(options);
    const originalTextCache = sourceMetadata.originalText ?? options?.originalText ?? null;

    return path.map((childPath, index) => {
        const result = buildStatementPartsForPrinter({
            childPath,
            index,
            print,
            options,
            originalTextCache,
            sourceMetadata,
            statements,
            containerNode,
            previousNodeHadNewlineAddedAfter
        });
        previousNodeHadNewlineAddedAfter = result.previousNodeHadNewlineAddedAfter;
        return result.parts;
    }, childrenAttribute);
}

function buildStatementPartsForPrinter({
    childPath,
    index,
    print,
    options,
    originalTextCache,
    sourceMetadata,
    statements,
    containerNode,
    previousNodeHadNewlineAddedAfter
}) {
    const parts: any[] = [];
    const node = childPath.getValue();
    if (!node) {
        return { parts, previousNodeHadNewlineAddedAfter };
    }
    const isTopLevel = childPath.parent?.type === Core.PROGRAM;
    const printed = print();

    if (printed == null || (printed === "" && node.type !== Core.EMPTY_STATEMENT)) {
        return { parts, previousNodeHadNewlineAddedAfter };
    }

    let semi = optionalSemicolon(node.type);
    const { startIndex: nodeStartIndex, endIndex: nodeEndIndex } = resolveNodeIndexRangeWithSource(
        node,
        sourceMetadata
    );

    const currentNodeRequiresNewline = shouldAddNewlinesAroundStatement(node) && isTopLevel;

    if (isTopLevel && index === 0 && Core.isFunctionAssignmentStatement(node)) {
        parts.push(hardline);
    }

    addLeadingStatementSpacing({
        parts,
        currentNodeRequiresNewline,
        previousNodeHadNewlineAddedAfter,
        isTopLevel,
        index,
        options,
        originalTextCache,
        nodeStartIndex
    });

    const isFirstStatementInBlock = index === 0 && childPath.parent?.type !== Core.PROGRAM;

    const textForSemicolons = originalTextCache || "";
    let hasTerminatingSemicolon = false;
    if (nodeEndIndex !== null) {
        let cursor = nodeEndIndex;
        while (
            cursor < textForSemicolons.length &&
            isSkippableSemicolonWhitespace(textForSemicolons.charCodeAt(cursor))
        ) {
            cursor++;
        }
        hasTerminatingSemicolon = textForSemicolons[cursor] === ";";
    }

    const isVariableDeclaration = node.type === Core.VARIABLE_DECLARATION;
    const isStaticDeclaration = isVariableDeclaration && node.kind === "static";
    const hasFunctionInitializer =
        isVariableDeclaration &&
        Array.isArray(node.declarations) &&
        node.declarations.some((declaration) => {
            const initType = declaration?.init?.type;
            return initType === Core.FUNCTION_EXPRESSION || initType === Core.FUNCTION_DECLARATION;
        });

    if (isFirstStatementInBlock && isStaticDeclaration) {
        const hasExplicitBlankLineBeforeStatic =
            typeof originalTextCache === STRING_TYPE &&
            typeof nodeStartIndex === NUMBER_TYPE &&
            util.isPreviousLineEmpty(originalTextCache, nodeStartIndex);

        if (hasExplicitBlankLineBeforeStatic) {
            parts.push(hardline);
        }
    }

    semi = normalizeStatementSemicolon({
        node,
        semi,
        hasTerminatingSemicolon,
        isStaticDeclaration
    });

    // Preserve the `statement; // trailing comment` shape that GameMaker
    // authors rely on. When the child doc ends with a trailing comment token
    // we cannot blindly append the semicolon because Prettier would render
    // `statement // comment;`, effectively moving the comment past the
    // terminator. Inserting the semicolon right before the comment keeps the
    // formatter's "always add the final `;`" guarantee intact without
    // rewriting author comments or dropping the semicolon entirely
    if (docHasTrailingComment(printed)) {
        printed.splice(-1, 0, semi);
        parts.push(printed);
    } else {
        parts.push(printed, semi);
    }

    // Clear the state flag that signals whether the previous statement in
    // the loop emitted trailing whitespace. This reset ensures each
    // statement begins evaluation with a clean slate: if the current node
    // determines it needs a leading blank line (via the "BEFORE" check
    // above), that decision will not be incorrectly suppressed by stale
    // state from an earlier iteration. The flag is then conditionally set
    // to `true` in the "AFTER" logic below whenever this statement
    // contributes a trailing hardline, allowing the next iteration to
    // coordinate spacing without doubling up blank lines.
    const nextPreviousNodeHadNewlineAddedAfter = applyTrailingSpacing({
        childPath,
        parts,
        statements,
        index,
        node,
        isTopLevel,
        options,
        hardline,
        currentNodeRequiresNewline,
        nodeEndIndex,
        suppressFollowingEmptyLine: false, // Don't suppress blank lines after the first statement
        isStaticDeclaration,
        hasFunctionInitializer,
        containerNode
    });

    return {
        parts,
        previousNodeHadNewlineAddedAfter: nextPreviousNodeHadNewlineAddedAfter
    };
}

function addLeadingStatementSpacing({
    parts,
    currentNodeRequiresNewline,
    previousNodeHadNewlineAddedAfter,
    isTopLevel,
    index,
    options,
    originalTextCache,
    nodeStartIndex
}) {
    if (!currentNodeRequiresNewline || previousNodeHadNewlineAddedAfter) {
        return;
    }

    const hasLeadingComment = isTopLevel ? Core.hasCommentImmediatelyBefore(originalTextCache, nodeStartIndex) : false;

    if (
        isTopLevel &&
        index > 0 &&
        !util.isPreviousLineEmpty(options.originalText, nodeStartIndex) &&
        !hasLeadingComment
    ) {
        parts.push(hardline);
    }
}

function normalizeStatementSemicolon({ node, semi, hasTerminatingSemicolon, isStaticDeclaration }) {
    if (semi !== ";") {
        return semi;
    }

    const initializerIsFunctionExpression =
        node.type === Core.VARIABLE_DECLARATION &&
        Array.isArray(node.declarations) &&
        node.declarations.length === 1 &&
        (node.declarations[0]?.init?.type === Core.FUNCTION_EXPRESSION ||
            node.declarations[0]?.init?.type === Core.FUNCTION_DECLARATION);

    if (initializerIsFunctionExpression && !hasTerminatingSemicolon) {
        return semi;
    }

    const assignmentExpressionForSemicolonCheck =
        node.type === Core.ASSIGNMENT_EXPRESSION
            ? node
            : node.type === Core.EXPRESSION_STATEMENT && node.expression?.type === Core.ASSIGNMENT_EXPRESSION
              ? node.expression
              : null;

    const isFunctionAssignmentExpression =
        assignmentExpressionForSemicolonCheck?.operator === "=" &&
        assignmentExpressionForSemicolonCheck?.right?.type === "FunctionDeclaration";

    if (isFunctionAssignmentExpression && !hasTerminatingSemicolon) {
        // Preserve the explicit terminator when normalizing anonymous
        // function assignments so the formatter emits `= function () {};`
        // instead of silently dropping the semicolon. The semicolon is part
        // of the statement boundary rather than the function expression
        // itself, so we add it whenever the source omitted one and rely on the
        // caller to elide it when the original text already contained a
        // trailing `;`.
        return semi;
    }

    // Check for static function assignments - these should have semicolons
    if (!hasTerminatingSemicolon && isStaticDeclaration) {
        const hasFunctionInitializer =
            Array.isArray(node.declarations) &&
            node.declarations.some((declaration) => {
                const initType = declaration?.init?.type;
                return initType === "FunctionExpression" || initType === "FunctionDeclaration";
            });

        if (hasFunctionInitializer) {
            return semi;
        }
    }

    return semi;
}

function applyTrailingSpacing({
    childPath,
    parts,
    statements,
    index,
    node,
    isTopLevel,
    options,
    hardline: hardlineDoc,
    currentNodeRequiresNewline,
    nodeEndIndex,
    suppressFollowingEmptyLine,
    isStaticDeclaration,
    hasFunctionInitializer,
    containerNode
}) {
    if (!isLastStatement(childPath)) {
        return handleIntermediateTrailingSpacing({
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
        });
    }

    if (isTopLevel) {
        parts.push(hardlineDoc);
        return false;
    }

    return handleTerminalTrailingSpacing({
        childPath,
        parts,
        node,
        options,
        hardline: hardlineDoc,
        nodeEndIndex,
        suppressFollowingEmptyLine,
        isStaticDeclaration,
        hasFunctionInitializer,
        containerNode
    });
}

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

function printGlobalVarStatementAsKeyword(node, path, print, options) {
    const decls =
        node.declarations.length > 1
            ? printCommaSeparatedList(path, print, "declarations", "", "", options, {
                  leadingNewline: false,
                  trailingNewline: false
              })
            : path.map(print, "declarations");

    const keyword = typeof node.kind === STRING_TYPE ? node.kind : "globalvar";

    return concat([keyword, " ", decls]);
}

function getSourceTextForNode(node, options) {
    if (!node) {
        return null;
    }

    const { originalText, locStart, locEnd } = resolvePrinterSourceMetadata(options);

    if (originalText === null) {
        return null;
    }

    const startIndex = typeof locStart === "function" ? locStart(node) : Core.getNodeStartIndex(node);
    const endIndex = typeof locEnd === "function" ? locEnd(node) : Core.getNodeEndIndex(node);

    if (typeof startIndex !== NUMBER_TYPE || typeof endIndex !== NUMBER_TYPE) {
        return null;
    }

    if (endIndex <= startIndex) {
        return null;
    }

    return originalText.slice(startIndex, endIndex).trim();
}

function structLiteralHasLeadingLineBreak(node, options) {
    if (!node) {
        return false;
    }

    const originalText = getOriginalTextFromOptions(options);

    if (!Core.isNonEmptyArray(node.properties)) {
        return false;
    }

    const { start, end } = Core.getNodeRangeIndices(node);
    const source = sliceOriginalText(originalText, start, end);
    if (source === null) {
        return false;
    }
    const openBraceIndex = source.indexOf("{");
    if (openBraceIndex === -1) {
        return false;
    }

    for (let index = openBraceIndex + 1; index < source.length; index += 1) {
        const character = source[index];

        if (character === "\n") {
            return true;
        }

        if (character === "\r") {
            if (source[index + 1] === "\n") {
                return true;
            }
            return true;
        }

        if (character.trim() === "") {
            continue;
        }

        if (character === "/") {
            const lookahead = source[index + 1];

            if (lookahead === "/") {
                const result = consumeSingleLineComment(source, index + 2);
                if (result.foundLineBreak) {
                    return true;
                }
                index = result.index;
                continue;
            }

            if (lookahead === "*") {
                const result = consumeBlockComment(source, index + 2);
                if (result.foundLineBreak) {
                    return true;
                }
                index = result.index;
                continue;
            }
        }

        if (character === "}") {
            return false;
        }

        return false;
    }

    return false;
}

function consumeSingleLineComment(source, startIndex) {
    let current = startIndex;
    while (current < source.length) {
        const commentChar = source[current];
        if (commentChar === "\n") {
            return { index: current, foundLineBreak: true };
        }
        if (commentChar === "\r") {
            return { index: current + 1, foundLineBreak: true };
        }

        current += 1;
    }

    return { index: current, foundLineBreak: false };
}

function consumeBlockComment(source, startIndex) {
    let current = startIndex;
    while (current < source.length - 1) {
        const commentChar = source[current];
        if (commentChar === "\n") {
            return { index: current, foundLineBreak: true };
        }
        if (commentChar === "\r") {
            return { index: current + 1, foundLineBreak: true };
        }

        if (commentChar === "*" && source[current + 1] === "/") {
            return { index: current + 1, foundLineBreak: false };
        }

        current += 1;
    }

    return { index: current, foundLineBreak: false };
}

/**
 * Builds the document representation for an if statement, ensuring that the
 * orchestration logic in the main printer delegates the clause assembly and
 * alternate handling to a single abstraction layer.
 */
function buildIfStatementDoc(path, options, print, node) {
    const parts: any[] = [printSingleClauseStatement(path, options, print, "if", "test", "consequent")];

    const elseDoc = buildIfAlternateDoc(path, options, print, node);
    if (elseDoc) {
        parts.push([" else ", elseDoc]);
    }

    return concat(parts);
}

function buildIfAlternateDoc(path, options, print, node) {
    if (!node || node.alternate === null) {
        return null;
    }

    const alternateNode = node.alternate;

    if (alternateNode.type === "IfStatement") {
        // Keep chained `else if` statements unwrapped. Printing the alternate
        // with braces would produce `else { if (...) ... }`, which breaks the
        // cascade that GameMaker expects, introduces an extra block for the
        // runtime to evaluate, and diverges from the control-structure style
        // documented in the GameMaker manual's Else If guidance.
        // By delegating directly to the child printer we preserve the
        // flattened `else if` ladder that authors wrote and that downstream
        // tools rely on when parsing the control flow.
        return print("alternate");
    }

    if (shouldPrintBlockAlternateAsElseIf(alternateNode)) {
        return path.call((alternatePath) => alternatePath.call(print, "body", 0), "alternate");
    }

    return printInBlock(path, options, print, "alternate");
}

function docHasTrailingComment(doc) {
    if (!Core.isNonEmptyArray(doc)) {
        return false;
    }

    const lastItem = doc.at(-1);
    if (!Core.isNonEmptyArray(lastItem)) {
        return false;
    }

    const commentArr = lastItem[0];
    if (!Core.isNonEmptyArray(commentArr)) {
        return false;
    }

    return commentArr.some((item) => {
        return typeof item === STRING_TYPE && (item.startsWith("//") || item.startsWith("/*"));
    });
}

function printWithoutExtraParens(path, print, ...keys) {
    return path.call((childPath) => unwrapParenthesizedExpression(childPath, print), ...keys);
}

function getBinaryOperatorInfo(operator) {
    if (operator === undefined) {
        return;
    }
    return Core.BINARY_OPERATORS[operator];
}

function shouldOmitSyntheticParens(path, _options) {
    void _options;
    const node = safeGetPathValue(path);
    if (!node || node.type !== "ParenthesizedExpression") {
        return false;
    }

    // Focus on synthetic parentheses (those inserted by the parser or formatter for
    // precedence disambiguation) rather than explicit parentheses written by the
    // user. Removing user-written parentheses could alter intended grouping or
    // emphasis, while synthetic ones exist solely to clarify operator precedence
    // and can be safely omitted when the context makes precedence unambiguous.
    const isSynthetic = node.synthetic === true;

    const parent = safeGetParentNode(path);
    if (!parent) {
        return false;
    }

    const parentKey = safeGetPathName(path);
    const expression = node.expression;

    if (shouldStripStandaloneAdditiveParentheses(parent, parentKey, expression)) {
        return true;
    }

    if (parent.type === "TernaryExpression") {
        return shouldFlattenTernaryTest(parentKey, expression);
    }

    // Always strip redundant parentheses around simple identifiers and literals
    if (
        expression &&
        (expression.type === "Identifier" ||
            expression.type === "Literal" ||
            expression.type === "CurrentArgsExpression" ||
            expression.type === "TemplateLiteral" ||
            expression.type === "UnaryExpression")
    ) {
        // Exception: new (Foo) vs new Foo? No, GML doesn't have `new` operator syntax quirks like that usually.
        // Exception: (1).toString()? GML doesn't have method calls on literals like JS.
        // For UnaryExpression, only dangerous if parent is MemberExpression accessing result
        if (expression.type === "UnaryExpression" && parent.type === "MemberExpression" && parent.object === node) {
            return false;
        }

        return true;
    }

    // For non-ternary cases, only process synthetic parentheses
    if (!isSynthetic) {
        if (parent.type === "BinaryExpression" && expression?.type === "BinaryExpression") {
            const parentInfo = getBinaryOperatorInfo(parent.operator);
            const childInfo = getBinaryOperatorInfo(expression.operator);

            // If child precedence is strictly higher, parens are redundant
            // e.g. (a * b) + c -> * > +
            if (childInfo && parentInfo && childInfo.prec > parentInfo.prec) {
                // Aggressively strip non-synthetic parentheses for arithmetic operations.
                if (childInfo.type === "arithmetic") {
                    return !hasImmediateExplicitArithmeticGrouping(expression);
                }

                // For comparison operations inside logical expressions, check for consistent grouping style.
                // If only one operand is parenthesized (e.g. `(a > b) && c`), strip it as noise.
                // If both operands are parenthesized (e.g. `(a > b) || (c < d)`), preserve the intent.
                if (
                    childInfo.type === "comparison" &&
                    parentInfo.type === "logical" &&
                    expression === node.expression // verifying we are checking the content
                ) {
                    // Check if sibling is parenthesized
                    const otherOperand = parent.left === node ? parent.right : parent.left;
                    // We check the raw node in AST to see if it's ParenthesizedExpression
                    // But print.ts receives the path... wait.
                    // The `node` variable in `shouldOmitSyntheticParens` is the ParenthesizedExpression itself.
                    // `parent` is the LogicalExpression.

                    // If parent.left === node, sibling is parent.right.
                    // But we need to use path-based access to be safe?
                    // Or just raw node access since we have `parent`.
                    // Prettier ensures AST nodes are stable.

                    if (otherOperand.type !== "ParenthesizedExpression" || otherOperand.synthetic === true) {
                        return true;
                    }
                }
            }

            if (shouldFlattenSyntheticBinary(parent, expression, path)) {
                return true;
            }
        }

        return shouldFlattenMultiplicationChain(parent, expression, path);
    }

    if (parent.type === "CallExpression") {
        return shouldFlattenSyntheticCall(parent, expression, path);
    }

    if (parent.type !== "BinaryExpression") {
        return false;
    }

    // Same-precedence binary chains (e.g. a + b + c, a && b && c) and
    // comparisons inside logical tests (e.g. a >= 1 or b < 70) are always
    // flattened regardless of the _flattenSyntheticNumericParens flag.
    if (expression?.type === "BinaryExpression" && shouldFlattenSyntheticBinary(parent, expression, path)) {
        return true;
    }

    const parentInfo = getBinaryOperatorInfo(parent.operator);
    if (expression?.type === "BinaryExpression" && parentInfo !== undefined) {
        const childInfo = getBinaryOperatorInfo(expression.operator);

        if (
            childInfo !== undefined &&
            childInfo.prec > parentInfo.prec &&
            shouldFlattenComparisonLogicalTest(parent, expression, path)
        ) {
            return true;
        }

        if (
            childInfo !== undefined &&
            childInfo.type === "arithmetic" &&
            parentInfo.type === "arithmetic" &&
            childInfo.prec > parentInfo.prec &&
            !hasImmediateExplicitArithmeticGrouping(expression)
        ) {
            return true;
        }
    }

    // Numeric parenthesization (e.g. a + (b * c)) requires explicit opt-in
    if (!isSyntheticParenFlatteningEnabled(path)) {
        return false;
    }

    if (expression?.type === "BinaryExpression" && parentInfo !== undefined) {
        const childInfo = getBinaryOperatorInfo(expression.operator);

        if (childInfo !== undefined && childInfo.prec > parentInfo.prec) {
            const numericDecision = evaluateNumericBinaryFlattening(parent, expression, path);
            if (numericDecision === "allow") {
                return true;
            }
            if (numericDecision === "deny") {
                return false;
            }
        }

        if (shouldFlattenMultiplicationChain(parent, expression, path)) {
            return true;
        }
    }

    if (parent.operator !== "+") {
        return false;
    }

    if (!binaryExpressionContainsString(parent)) {
        return false;
    }

    let depth = 1;
    while (true) {
        const ancestor = safeGetParentNode(path, depth - 1);
        if (!ancestor) {
            return false;
        }

        if (ancestor.type === "ParenthesizedExpression" && ancestor.synthetic !== true) {
            return true;
        }

        depth += 1;
    }
}

// For ternary expressions, omit unnecessary parentheses around simple identifiers
// or member expressions in the guard/test position. This mirrors the previous
// inline logic that only trimmed parentheses when they added no semantic value,
// keeping the formatter's promise of minimal grouping while avoiding precedence
// changes in more complex logical expressions.
function shouldFlattenTernaryTest(parentKey, expression) {
    if (parentKey !== "test") {
        return false;
    }

    const expressionType = expression?.type;
    if (!expressionType) {
        return false;
    }

    return (
        expressionType === "Identifier" ||
        expressionType === "MemberDotExpression" ||
        expressionType === "MemberIndexExpression"
    );
}

function shouldWrapTernaryExpression(path) {
    const node = safeGetPathValue(path);
    if (node && node.__skipTernaryParens) {
        return false;
    }

    // Do not wrap ternary expressions in parentheses by default.
    // The golden fixture tests expect ternary expressions to remain unwrapped
    // in variable declarations, assignments, and template strings.
    return false;
}

function printTernaryExpressionNode(_node, path, _options, print) {
    const testDoc = path.call(print, "test");
    const consequentDoc = path.call(print, "consequent");
    const alternateDoc = path.call(print, "alternate");

    const ternaryDoc = group([testDoc, indent([line, "? ", consequentDoc, line, ": ", alternateDoc])]);

    return shouldWrapTernaryExpression(path) ? concat(["(", ternaryDoc, ")"]) : ternaryDoc;
}

function hasImmediateExplicitArithmeticGrouping(node) {
    if (!node || node.type !== "BinaryExpression") {
        return false;
    }

    for (const operand of [node.left, node.right]) {
        if (operand?.type !== "ParenthesizedExpression" || operand.synthetic === true) {
            continue;
        }

        const innerExpression = operand.expression;
        if (
            (node.operator === "*" || node.operator === "/") &&
            innerExpression?.type === "BinaryExpression" &&
            (innerExpression.operator === "*" || innerExpression.operator === "/")
        ) {
            continue;
        }

        return true;
    }

    return false;
}

function shouldStripStandaloneAdditiveParentheses(parent, parentKey, expression) {
    if (!parent || !expression) {
        return false;
    }

    if (!isNumericComputationNode(expression)) {
        return false;
    }

    const isBinaryExpression = expression.type === "BinaryExpression";
    if (isBinaryExpression && binaryExpressionContainsString(expression)) {
        return false;
    }

    const operatorText = isBinaryExpression ? Core.getNormalizedOperator(expression) : null;
    const isMultiplicativeExpression =
        isBinaryExpression && operatorText !== null && MULTIPLICATIVE_BINARY_OPERATORS.has(operatorText);

    switch (parent.type) {
        case "VariableDeclarator": {
            return parentKey === "init";
        }
        case "AssignmentExpression": {
            return parentKey === "right";
        }
        case "ExpressionStatement": {
            return parentKey === "expression";
        }
        case "ReturnStatement":
        case "ThrowStatement": {
            return parentKey === "argument";
        }
        case "BinaryExpression": {
            if (isMultiplicativeExpression) {
                return false;
            }
            if (parent.operator === "+") {
                return parentKey === "left" || parentKey === "right";
            }

            if (parent.operator === "-") {
                return parentKey === "left";
            }

            return false;
        }
        default: {
            return false;
        }
    }
}

// Synthetic parenthesis flattening only treats select call expressions as
// numeric so we avoid unwrapping macro invocations that expand to complex
// expressions. The list is intentionally small and can be extended as other
// numeric helpers require the same treatment.

function binaryExpressionContainsString(node) {
    if (!node || node.type !== "BinaryExpression") {
        return false;
    }

    if (node.operator !== "+") {
        return false;
    }

    return expressionIsStringLike(node.left) || expressionIsStringLike(node.right);
}

function unwrapParensForInitializer(node) {
    let current = node;
    while (current?.type === "ParenthesizedExpression") {
        current = current.expression;
    }
    return current;
}

function shouldBreakVariableInitializerOnAssignmentLine(node): boolean {
    if (!node || node.type !== "VariableDeclarator") {
        return false;
    }

    const initializer = unwrapParensForInitializer(node.init);
    return initializer?.type === "BinaryExpression" && binaryExpressionContainsString(initializer);
}

function unwrapParenthesizedExpression(childPath, print) {
    const childNode = childPath.getValue();
    if (childNode?.type === "ParenthesizedExpression") {
        return childPath.call((innerPath) => unwrapParenthesizedExpression(innerPath, print), "expression");
    }

    return print();
}

function getInnermostClauseExpression(node) {
    return unwrapParensForInitializer(node);
}

function buildClauseGroup(doc) {
    return group([indent([ifBreak(line), doc]), ifBreak(line)]);
}

function wrapInClauseParens(path, print, clauseKey) {
    const clauseNode = path.getValue()?.[clauseKey];
    const clauseDoc = printWithoutExtraParens(path, print, clauseKey);

    const clauseExpressionNode = getInnermostClauseExpression(clauseNode);

    if (clauseExpressionNode?.type === "CallExpression" && clauseExpressionNode.preserveOriginalCallText) {
        return concat(["(", clauseDoc, ")"]);
    }

    return concat(["(", buildClauseGroup(clauseDoc), ")"]);
}

function resolveInlineClauseBodySourceText(bodyNode, options): string | null {
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

function shouldInlineClauseByPrintWidth(keyword, clauseNode, bodyNode, options): boolean {
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

    const inlineBodySource = resolveInlineClauseBodySourceText(bodyNode, options);
    if (inlineBodySource === null || inlineBodySource.includes("\n") || inlineBodySource.includes("\r")) {
        return false;
    }

    const configuredPrintWidth =
        typeof options?.printWidth === NUMBER_TYPE && Number.isFinite(options.printWidth) && options.printWidth > 0
            ? options.printWidth
            : DEFAULT_PRINT_WIDTH;

    // `if (` + clause + `) { ` + body + ` }`
    const estimatedInlineLength = keyword.length + 2 + clauseSource.trim().length + 4 + inlineBodySource.length + 2;

    return estimatedInlineLength <= configuredPrintWidth;
}

// prints any statement that matches the structure [keyword, clause, statement]
function printSingleClauseStatement(path, options, print, keyword, clauseKey, bodyKey) {
    const node = path.getValue();
    const clauseNode = node?.[clauseKey];
    const clauseExpressionNode = getInnermostClauseExpression(clauseNode);
    const clauseDoc = wrapInClauseParens(path, print, clauseKey);
    const bodyNode = node?.[bodyKey];
    const allowInlineControlFlowBlocks = options?.allowInlineControlFlowBlocks ?? false;
    const clauseIsPreservedCall =
        clauseExpressionNode?.type === "CallExpression" && clauseExpressionNode.preserveOriginalCallText === true;

    const allowCollapsedGuard =
        bodyNode &&
        !clauseIsPreservedCall &&
        allowInlineControlFlowBlocks &&
        shouldInlineClauseByPrintWidth(keyword, clauseNode, bodyNode, options);

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

function printSimpleDeclaration(leftDoc, rightDoc) {
    return rightDoc ? [leftDoc, " = ", rightDoc] : leftDoc;
}

// prints empty parens with dangling comments
function printEmptyParens(path, options) {
    return group(
        [
            "(",
            indent([printDanglingCommentsAsGroup(path, options, (comment) => !comment.attachToBrace)]),
            ifBreak(line, "", { groupId: Symbol.for("emptyparen") }),
            ")"
        ],
        { id: Symbol.for("emptyparen") }
    );
}

// prints an empty block with dangling comments
function printEmptyBlock(path, options) {
    const node = path.getValue();
    const inlineCommentDoc = maybePrintInlineEmptyBlockComment(path, options);

    if (inlineCommentDoc) {
        return inlineCommentDoc;
    }

    const comments = Core.getCommentArray(node);
    const hasPrintableComments = comments.some(Core.isCommentNode as any);

    if (hasPrintableComments) {
        const sourceMetadata = resolvePrinterSourceMetadata(options);
        const shouldAddTrailingBlankLine =
            sourceMetadata.originalText !== null &&
            hasBlankLineBetweenLastCommentAndClosingBrace(node, sourceMetadata, sourceMetadata.originalText);

        const trailingDocs = [hardline, "}"];
        if (shouldAddTrailingBlankLine) {
            trailingDocs.unshift(lineSuffixBoundary as any, hardline as any);
        }

        const inlineDangling = printDanglingComments(path, options, (comment) => comment.attachToBrace);
        const groupedDangling = printDanglingCommentsAsGroup(path, options, (comment) => !comment.attachToBrace);
        if (groupedDangling) {
            return ["{", inlineDangling, indent([groupedDangling]), ...trailingDocs];
        }

        // an empty block with comments
        return ["{", inlineDangling, ...trailingDocs];
    } else {
        return "{}";
    }
}

function maybePrintInlineEmptyBlockComment(path, options) {
    const node = path.getValue();
    if (!node) {
        return null;
    }

    const comments = Core.getCommentArray(node);
    if (comments.length === 0) {
        return null;
    }

    const inlineIndex = findInlineBlockCommentIndex(comments);

    if (inlineIndex < 0) {
        return null;
    }

    const comment = comments[inlineIndex];
    const commentLeadingWS =
        typeof comment === "object" && comment !== null && "leadingWS" in comment
            ? (comment as { leadingWS: unknown }).leadingWS
            : undefined;
    const commentTrailingWS =
        typeof comment === "object" && comment !== null && "trailingWS" in comment
            ? (comment as { trailingWS: unknown }).trailingWS
            : undefined;
    const leadingSpacing = getInlineBlockCommentSpacing(commentLeadingWS, " ");
    const trailingSpacing = getInlineBlockCommentSpacing(commentTrailingWS, " ");

    return [
        "{",
        leadingSpacing,
        path.call((commentPath) => printComment(commentPath, options), "comments", inlineIndex),
        trailingSpacing,
        "}"
    ];
}

function findInlineBlockCommentIndex(comments) {
    let inlineIndex = -1;

    for (const [index, comment] of comments.entries()) {
        if (!Core.isCommentNode(comment)) {
            continue;
        }

        if (!isInlineEmptyBlockComment(comment)) {
            return -1;
        }

        if (inlineIndex !== -1) {
            return -1;
        }

        inlineIndex = index;
    }

    return inlineIndex;
}

function getInlineBlockCommentSpacing(text, fallback) {
    if (typeof text !== STRING_TYPE || text.length === 0) {
        return fallback;
    }

    return hasLineBreak(text) ? fallback : text;
}

function shouldFlattenSyntheticBinary(parent, expression, _path) {
    const parentInfo = getBinaryOperatorInfo(parent.operator);
    const expressionInfo = getBinaryOperatorInfo(expression.operator);

    if (!parentInfo || !expressionInfo) {
        return false;
    }

    const parentKey = safeGetPathName(_path);

    if (parent.operator === expression.operator) {
        if ((parent.operator === "-" || parent.operator === "/") && parentKey === "right") {
            return false;
        }
        return true;
    }

    const parentIsAdditive = parent.operator === "+" || parent.operator === "-";
    const expressionIsAdditive = expression.operator === "+" || expression.operator === "-";
    if (!parentIsAdditive || !expressionIsAdditive) {
        return false;
    }

    // Flatten additive synthetic parentheses when associativity is preserved.
    // Safe: (a + b) - c, (a - b) + c, a + (b - c), a + (b + c)
    // Unsafe: a - (b + c), a - (b - c)
    if (parentKey === "left") {
        return true;
    }

    return parentKey === "right" && parent.operator === "+";
}

function shouldFlattenMultiplicationChain(parent, expression, _path) {
    const parentInfo = getBinaryOperatorInfo(parent.operator);
    const expressionInfo = getBinaryOperatorInfo(expression.operator);

    if (!parentInfo || !expressionInfo) {
        return false;
    }

    const parentOperandKey = safeGetPathName(_path);

    if (parent.operator === "/" && parentOperandKey === "right") {
        return false;
    }

    // Multiplication associativity
    return (
        (parent.operator === "*" || parent.operator === "/") &&
        (expression.operator === "*" || expression.operator === "/")
    );
}

function shouldFlattenSyntheticCall(_parent, _expression, _path) {
    return false;
}

function shouldFlattenComparisonLogicalTest(parent, expression, _path) {
    const parentInfo = getBinaryOperatorInfo(parent.operator);
    const expressionInfo = getBinaryOperatorInfo(expression.operator);

    if (!parentInfo || !expressionInfo) {
        return false;
    }

    // Flatten logic inside logic (e.g. `(a && b) || c`) if precedence allows
    if (parentInfo.type === "logical" && (expressionInfo.type === "comparison" || expressionInfo.type === "logical")) {
        return true;
    }

    // Flatten arithmetic inside comparison (e.g. `a < (b * c)`) if precedence allows
    if (parentInfo.type === "comparison" && expressionInfo.type === "arithmetic") {
        return true;
    }

    return false;
}

function evaluateNumericBinaryFlattening(parent, expression, _path) {
    const parentInfo = getBinaryOperatorInfo(parent.operator);
    const expressionInfo = getBinaryOperatorInfo(expression.operator);

    if (!parentInfo || !expressionInfo) {
        return;
    }

    // Always flatten standard arithmetic chains if safe (e.g. `a + b * c` where precedence allows)
    // The caller ensures childInfo.prec > parentInfo.prec before checking "allow"
    if (parentInfo.type === "arithmetic" && expressionInfo.type === "arithmetic") {
        // Exception: modulo? No, precedence handles it.
        return "allow";
    }

    // Flatten bitwise inside comparison/arithmetic if safe
    if (parentInfo.type === "bitwise" || expressionInfo.type === "bitwise") {
        return "allow";
    }
}
