/**
 * Shared policy predicates for focused logical-normalization rules.
 *
 * This module isolates the **policy decisions** (candidate eligibility
 * heuristics, skip conditions) from the **mechanism** that applies
 * logical normalization to AST nodes.  By keeping the two layers separate
 * the policy logic is testable in isolation without touching the rule's
 * visitor, autofix reporting, or source-text rewriting.
 */

import { Core } from "@gmloop/core";

import { findPreviousNonWhitespaceIndex } from "../rule-base-helpers.js";

/**
 * Matches the leading characters of a comment (`//` or `/*`); used as a
 * cheap pre-check before the more expensive comment scan.
 */
const COMMENT_START_PATTERN = /\/\/|\/\*/u;

/**
 * Pure evaluator: returns `true` when `sourceText` contains a real
 * comment that would make normalization unsafe.  The pre-check on
 * `COMMENT_START_PATTERN` is purely a fast path — if no `//` or `/*` is
 * present the function short-circuits without scanning.
 */
export function evaluateUnsafeCommentSyntax(sourceText: string): boolean {
    if (!COMMENT_START_PATTERN.test(sourceText)) {
        return false;
    }

    const sourceLength = sourceText.length;
    const scanState = Core.createStringCommentScanState();
    for (let index = 0; index < sourceLength;) {
        const nextIndex = Core.advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
        if (nextIndex !== index) {
            if (scanState.inLineComment || scanState.inBlockComment) {
                return true;
            }

            index = nextIndex;
            continue;
        }

        index += 1;
    }

    return false;
}

/**
 * Pure evaluator: returns `true` when the `if` keyword at
 * `ifKeywordStartIndex` is immediately preceded by an `else` token.  The
 * check is bounded to a fixed lookback distance (4 characters) so it never
 * walks arbitrary distances through the source.
 */
export function evaluateIsElsePrefixedIfAtIndex(fullSourceText: string, ifKeywordStartIndex: number): boolean {
    const previousNonWhitespaceIndex = findPreviousNonWhitespaceIndex(fullSourceText, ifKeywordStartIndex, false);
    if (previousNonWhitespaceIndex === null) {
        return false;
    }

    const elseStart = previousNonWhitespaceIndex - 3;
    if (elseStart < 0) {
        return false;
    }

    if (fullSourceText.slice(elseStart, previousNonWhitespaceIndex + 1).toLowerCase() !== "else") {
        return false;
    }

    const beforeElse = elseStart > 0 ? fullSourceText[elseStart - 1] : "";
    return beforeElse === "" || Core.isIdentifierBoundaryCharacter(beforeElse);
}

/**
 * Pure evaluator: returns `true` when the given `IfStatement` is part of an
 * `else if` chain (directly or through a single-statement block).  An
 * `else if` chain is intentionally not collapsed into a ternary because
 * doing so harms readability and would change the meaning of multi-clause
 * else-if ladders.
 */
export function evaluateIsIfNodeInElseIfChain(node: unknown): boolean {
    const ifNode = Core.unwrapParenthesizedExpression(node);
    if (!ifNode || (ifNode as { type?: string }).type !== "IfStatement") {
        return false;
    }

    const parent = Core.unwrapParenthesizedExpression((ifNode as { parent?: unknown }).parent);
    if (!parent) {
        return false;
    }

    const parentType = (parent as { type?: string }).type;
    if (parentType === "IfStatement" && (parent as { alternate?: unknown }).alternate === ifNode) {
        return true;
    }

    if (
        parentType === "BlockStatement" &&
        Array.isArray((parent as { body?: unknown[] }).body) &&
        (parent as { body: unknown[] }).body.length === 1 &&
        (parent as { body: unknown[] }).body[0] === ifNode
    ) {
        const grandParent = Core.unwrapParenthesizedExpression((parent as { parent?: unknown }).parent);
        return Boolean(
            grandParent &&
            (grandParent as { type?: string }).type === "IfStatement" &&
            (grandParent as { alternate?: unknown }).alternate === parent
        );
    }
    return false;
}

function extractSingleReturnStatement(statement: unknown): { argument?: unknown } | null {
    const unwrappedStatement = Core.unwrapParenthesizedExpression(statement);
    if (!unwrappedStatement || typeof unwrappedStatement !== "object") {
        return null;
    }

    if ((unwrappedStatement as { type?: string }).type === "ReturnStatement") {
        return unwrappedStatement;
    }

    if ((unwrappedStatement as { type?: string }).type !== "BlockStatement") {
        return null;
    }

    const body = (unwrappedStatement as { body?: unknown[] }).body;
    if (!Array.isArray(body) || body.length !== 1) {
        return null;
    }

    const onlyStatement = Core.unwrapParenthesizedExpression(body[0]);
    if (!onlyStatement || (onlyStatement as { type?: string }).type !== "ReturnStatement") {
        return null;
    }

    return onlyStatement;
}

function areOppositeBooleanReturnArguments(left: unknown, right: unknown): boolean {
    const leftBoolean = Core.getBooleanLiteralValue(left, { acceptBooleanPrimitives: true });
    const rightBoolean = Core.getBooleanLiteralValue(right, { acceptBooleanPrimitives: true });
    return (
        ((leftBoolean === "true" && rightBoolean === "false") ||
            (leftBoolean === "false" && rightBoolean === "true")) &&
        leftBoolean !== rightBoolean
    );
}

/**
 * Pure evaluator: returns `true` when an `IfStatement` is a direct boolean
 * return candidate owned by `gml/prefer-direct-boolean-return`.
 */
export function evaluateCanDirectBooleanReturnBenefitFromNormalization(
    node: unknown,
    followingStatement: unknown = null
): boolean {
    const ifNode = Core.unwrapParenthesizedExpression(node);
    if (!ifNode || (ifNode as { type?: string }).type !== "IfStatement") {
        return false;
    }

    const consequentReturn = extractSingleReturnStatement((ifNode as { consequent?: unknown }).consequent);
    if (!consequentReturn || !Object.hasOwn(consequentReturn, "argument")) {
        return false;
    }

    const alternateStatement = (ifNode as { alternate?: unknown }).alternate;
    if (alternateStatement) {
        const alternateReturn = extractSingleReturnStatement(alternateStatement);
        return (
            alternateReturn !== null &&
            Object.hasOwn(alternateReturn, "argument") &&
            areOppositeBooleanReturnArguments(consequentReturn.argument, alternateReturn.argument)
        );
    }

    const trailingReturn = extractSingleReturnStatement(followingStatement);
    return (
        trailingReturn !== null &&
        Object.hasOwn(trailingReturn, "argument") &&
        areOppositeBooleanReturnArguments(consequentReturn.argument, trailingReturn.argument)
    );
}
