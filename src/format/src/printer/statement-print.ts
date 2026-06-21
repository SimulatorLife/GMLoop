/**
 * Statement-level print helpers for the GML formatter.
 *
 * The functions in this module were previously inlined at the tail of
 * `print.ts` and formed a single, ~480-line block of tightly related logic
 * covering:
 *
 *  1. **Statement sequence printing** – `printStatements` and
 *     `buildStatementPartsForPrinter` walk a parent node's `body` array and
 *     emit each child wrapped with the appropriate leading / trailing
 *     spacing and terminating semicolon.
 *  2. **Statement-shape helpers** – `addLeadingStatementSpacing`,
 *     `normalizeStatementSemicolon`, and `applyTrailingSpacing` capture
 *     the per-statement spacing and semicolon-bookkeeping policy.
 *  3. **Globalvar statement printing** – `printGlobalVarStatementAsKeyword`
 *     renders `globalvar` / `global` declarations that the parser produces
 *     as variable declarations with a non-standard `kind`.
 *  4. **Original-source probing** – `getSourceTextForNode`,
 *     `structLiteralHasLeadingLineBreak`, `consumeSingleLineComment`, and
 *     `consumeBlockComment` look at the raw source to decide whether
 *     preserved blank lines, comments, or block layouts are present.
 *  5. **If-statement printing** – `buildIfStatementDoc`,
 *     `buildIfAlternateDoc`, and `shouldPrintBlockAlternateAsElseIf`
 *     compose the `if` / `else` / `else if` ladder output.
 *
 * Splitting this block out of `print.ts` keeps the central dispatcher
 * focused on the per-node-type `try*` / `print*` routers while the
 * statement-sequence policy lives in a single, cohesive module.
 */

import { Core } from "@gmloop/core";
import { util } from "prettier";

import { NUMBER_TYPE, STRING_TYPE } from "./constants.js";
import { printCommaSeparatedList } from "./delimited-list.js";
import { docHasTrailingComment, printWithoutExtraParens } from "./expression-print-utils.js";
import { safeGetParentNode } from "./path-utils.js";
import { concat, hardline } from "./prettier-doc-builders.js";
import { printInBlock } from "./print.js";
import { isLastStatement, isSkippableSemicolonWhitespace, optionalSemicolon } from "./semicolons.js";
import { printSingleClauseStatement } from "./single-clause-statement.js";
import { shouldAddNewlinesAroundStatement } from "./statement-spacing-policy.js";
import { handleIntermediateTrailingSpacing, handleTerminalTrailingSpacing } from "./statement-traversal-spacing.js";

export function printStatements(path, options, print, childrenAttribute) {
    let previousNodeHadNewlineAddedAfter = false; // tracks newline added after the previous node

    const parentNode = path.getValue();
    const containerNode = safeGetParentNode(path);
    const statements =
        parentNode && Array.isArray(parentNode[childrenAttribute]) ? parentNode[childrenAttribute] : null;
    // Cache frequently used option lookups to avoid re-evaluating them in the tight map loop.
    const sourceMetadata = Core.resolvePrinterSourceMetadata(options);
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
    const { startIndex: nodeStartIndex, endIndex: nodeEndIndex } = Core.resolveNodeIndexRangeWithSource(
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

export function printGlobalVarStatementAsKeyword(node, path, print, options) {
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

export function getSourceTextForNode(node, options) {
    if (!node) {
        return null;
    }

    const { originalText, locStart, locEnd } = Core.resolvePrinterSourceMetadata(options);

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

export function structLiteralHasLeadingLineBreak(node, options) {
    if (!node) {
        return false;
    }

    const originalText = Core.getOriginalTextFromOptions(options);

    if (!Core.isNonEmptyArray(node.properties)) {
        return false;
    }

    const { start, end } = Core.getNodeRangeIndices(node);
    const source = Core.sliceOriginalText(originalText, start, end);
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

export function buildIfStatementDoc(path, options, print, node) {
    const parts: any[] = [
        printSingleClauseStatement(path, options, print, "if", "test", "consequent", {
            printInBlock,
            printWithoutExtraParens,
            getSourceTextForNode
        })
    ];

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
