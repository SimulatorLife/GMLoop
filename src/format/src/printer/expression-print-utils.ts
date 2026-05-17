/**
 * Expression-level printing utilities for the GML formatter.
 *
 * This module contains three cohesive groups of helpers that were previously
 * embedded at the tail of `print.ts`:
 *
 *  1. **Parenthesis-flattening** – `shouldOmitSyntheticParens` and the full
 *     decision tree it delegates to (`shouldFlattenSyntheticBinary`,
 *     `shouldFlattenComparisonLogicalTest`, etc.).  The goal is to remove
 *     redundant synthetic parentheses that the parser inserts for precedence
 *     disambiguation while preserving user-written grouping.
 *
 *  2. **Ternary expression printing** – `printTernaryExpressionNode` and its
 *     guard `shouldWrapTernaryExpression`.
 *
 *  3. **Primitive node-printing utilities** – small helpers shared across
 *     multiple node-type printers: `printSimpleDeclaration`,
 *     `printEmptyParens`, `printEmptyBlock`, etc.
 */
import { Core } from "@gmloop/core";

import { printComment, printDanglingComments, printDanglingCommentsAsGroup } from "../comments/comment-printer.js";
import { MULTIPLICATIVE_BINARY_OPERATORS, STRING_TYPE } from "./constants.js";
import { safeGetParentNode, safeGetPathName, safeGetPathValue } from "./path-utils.js";
import { concat, group, hardline, ifBreak, indent, line, lineSuffixBoundary } from "./prettier-doc-builders.js";
import { hasBlankLineBetweenLastCommentAndClosingBrace, resolvePrinterSourceMetadata } from "./source-text.js";
import {
    expressionIsStringLike,
    hasLineBreak,
    isInlineEmptyBlockComment,
    isNumericComputationNode,
    isSyntheticParenFlatteningEnabled
} from "./type-guards.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the last item in `doc` is a trailing comment token
 * (a `//` or `/*` string inside the final nested array).  Used by the
 * statement printer to insert semicolons *before* the comment rather than
 * after it.
 */
export function docHasTrailingComment(doc: any): boolean {
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

    return commentArr.some((item: any) => {
        return typeof item === STRING_TYPE && (item.startsWith("//") || item.startsWith("/*"));
    });
}

/**
 * Calls `print` on the given `keys`, stripping any outermost
 * `ParenthesizedExpression` wrapper so that synthetic parentheses added by
 * the parser are not re-emitted unnecessarily.
 */
export function printWithoutExtraParens(path: any, print: any, ...keys: any[]): any {
    return path.call((childPath: any) => unwrapParenthesizedExpression(childPath, print), ...keys);
}

/**
 * Decides whether a `ParenthesizedExpression` node's wrapping parens should
 * be omitted in the final output.  Synthetic parentheses inserted by the
 * parser for precedence disambiguation are removed when the surrounding
 * context makes them redundant; user-written parentheses are only removed
 * when they provide no semantic value (e.g. `(x)` where `x` is a simple
 * identifier).
 */
export function shouldOmitSyntheticParens(path: any, _options: any): boolean {
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

/** Prints a `TernaryExpression` node (`test ? consequent : alternate`). */
export function printTernaryExpressionNode(_node: any, path: any, _options: any, print: any): any {
    const testDoc = path.call(print, "test");
    const consequentDoc = path.call(print, "consequent");
    const alternateDoc = path.call(print, "alternate");

    const ternaryDoc = group([testDoc, indent([line, "? ", consequentDoc, line, ": ", alternateDoc])]);

    return shouldWrapTernaryExpression(path) ? concat(["(", ternaryDoc, ")"]) : ternaryDoc;
}

/**
 * Returns `true` when the variable declarator's initializer is a binary
 * `+` expression that contains a string operand; such declarators are broken
 * across the assignment line for readability.
 */
export function shouldBreakVariableInitializerOnAssignmentLine(node: any): boolean {
    if (!node || node.type !== "VariableDeclarator") {
        return false;
    }

    const initializer = Core.unwrapParenthesizedExpression(node.init);
    return initializer?.type === "BinaryExpression" && binaryExpressionContainsString(initializer);
}

/** Renders `left = right` (or just `left` when `rightDoc` is falsy). */
export function printSimpleDeclaration(leftDoc: any, rightDoc: any): any {
    return rightDoc ? [leftDoc, " = ", rightDoc] : leftDoc;
}

/** Prints `()` with any dangling comments preserved inside. */
export function printEmptyParens(path: any, options: any): any {
    return group(
        [
            "(",
            indent([printDanglingCommentsAsGroup(path, options, (comment: any) => !comment.attachToBrace)]),
            ifBreak(line, "", { groupId: Symbol.for("emptyparen") }),
            ")"
        ],
        { id: Symbol.for("emptyparen") }
    );
}

/** Prints `{}` (or the block with its dangling comments when present). */
export function printEmptyBlock(path: any, options: any): any {
    const node = path.getValue();
    const inlineCommentDoc = maybePrintInlineEmptyBlockComment(path, options);

    if (inlineCommentDoc) {
        return inlineCommentDoc;
    }

    const comments = Core.getCommentArray(node);
    const hasPrintableComments = comments.some(Core.isCommentNode);

    if (hasPrintableComments) {
        const sourceMetadata = resolvePrinterSourceMetadata(options);
        const shouldAddTrailingBlankLine =
            sourceMetadata.originalText !== null &&
            hasBlankLineBetweenLastCommentAndClosingBrace(node, sourceMetadata, sourceMetadata.originalText);

        const trailingDocs = [hardline, "}"];
        if (shouldAddTrailingBlankLine) {
            trailingDocs.unshift(lineSuffixBoundary as any, hardline);
        }

        const inlineDangling = printDanglingComments(path, options, (comment: any) => comment.attachToBrace);
        const groupedDangling = printDanglingCommentsAsGroup(path, options, (comment: any) => !comment.attachToBrace);
        if (groupedDangling) {
            return ["{", inlineDangling, indent([groupedDangling]), ...trailingDocs];
        }

        // an empty block with comments
        return ["{", inlineDangling, ...trailingDocs];
    } else {
        return "{}";
    }
}

// ---------------------------------------------------------------------------
// Private helpers – parenthesis-flattening decision tree
// ---------------------------------------------------------------------------

function getBinaryOperatorInfo(operator: any): any {
    if (operator === undefined) {
        return;
    }
    return Core.BINARY_OPERATORS[operator];
}

// For ternary expressions, omit unnecessary parentheses around simple identifiers
// or member expressions in the guard/test position. This mirrors the previous
// inline logic that only trimmed parentheses when they added no semantic value,
// keeping the formatter's promise of minimal grouping while avoiding precedence
// changes in more complex logical expressions.
function shouldFlattenTernaryTest(parentKey: any, expression: any): boolean {
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

function shouldWrapTernaryExpression(path: any): boolean {
    const node = safeGetPathValue(path);
    if (node && node.__skipTernaryParens) {
        return false;
    }

    // Do not wrap ternary expressions in parentheses by default.
    // The golden fixture tests expect ternary expressions to remain unwrapped
    // in variable declarations, assignments, and template strings.
    return false;
}

function hasImmediateExplicitArithmeticGrouping(node: any): boolean {
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

function shouldStripStandaloneAdditiveParentheses(parent: any, parentKey: any, expression: any): boolean {
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

function binaryExpressionContainsString(node: any): boolean {
    if (!node || node.type !== "BinaryExpression") {
        return false;
    }

    if (node.operator !== "+") {
        return false;
    }

    return expressionIsStringLike(node.left) || expressionIsStringLike(node.right);
}

function unwrapParenthesizedExpression(childPath: any, print: any): any {
    const childNode = childPath.getValue();
    if (childNode?.type === "ParenthesizedExpression") {
        return childPath.call((innerPath: any) => unwrapParenthesizedExpression(innerPath, print), "expression");
    }

    return print();
}

function shouldFlattenSyntheticBinary(parent: any, expression: any, _path: any): boolean {
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

    // Flatten additive synthetic parentheses only when left-to-right associativity
    // guarantees the result is unchanged. This relies on precedence (all additive ops
    // share prec 12) and associativity: a - b + c == (a - b) + c, but a - (b + c) !=
    // a - b + c, and a - (b - c) != (a - b) - c. The comment below enumerates the
    // safe cases so future readers can verify the guard before extending the logic.
    // Safe (associativity preserved): (a + b) - c, (a - b) + c, a + (b - c), a + (b + c)
    // Unsafe (changes result): a - (b + c), a - (b - c)
    if (parentKey === "left") {
        return true;
    }

    // For the right operand, only flatten when the parent operator is "+" — subtraction
    // on the right is non-associative and would change the result. For example,
    // a - (b + c) should NOT flatten to a - b + c since subtraction is not commutative.
    return parentKey === "right" && parent.operator === "+";
}

function shouldFlattenMultiplicationChain(parent: any, expression: any, _path: any): boolean {
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

function shouldFlattenSyntheticCall(_parent: any, _expression: any, _path: any): boolean {
    return false;
}

function shouldFlattenComparisonLogicalTest(parent: any, expression: any, _path: any): boolean {
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

function evaluateNumericBinaryFlattening(parent: any, expression: any, _path: any): string | undefined {
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

// ---------------------------------------------------------------------------
// Private helpers – inline empty-block comment handling
// ---------------------------------------------------------------------------

function maybePrintInlineEmptyBlockComment(path: any, options: any): any {
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
        typeof comment === "object" && comment !== null && "leadingWS" in comment ? comment.leadingWS : undefined;
    const commentTrailingWS =
        typeof comment === "object" && comment !== null && "trailingWS" in comment ? comment.trailingWS : undefined;
    const leadingSpacing = getInlineBlockCommentSpacing(commentLeadingWS, " ");
    const trailingSpacing = getInlineBlockCommentSpacing(commentTrailingWS, " ");

    return [
        "{",
        leadingSpacing,
        path.call((commentPath: any) => printComment(commentPath, options), "comments", inlineIndex),
        trailingSpacing,
        "}"
    ];
}

function findInlineBlockCommentIndex(comments: readonly unknown[]): number {
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

function getInlineBlockCommentSpacing(text: unknown, fallback: string): string {
    if (typeof text !== STRING_TYPE || (text as string).length === 0) {
        return fallback;
    }

    return hasLineBreak(text) ? fallback : (text as string);
}
