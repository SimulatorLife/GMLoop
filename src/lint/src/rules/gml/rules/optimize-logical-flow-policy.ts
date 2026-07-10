/**
 * Policy evaluator for the `gml/optimize-logical-flow` lint rule.
 *
 * This module isolates the **policy decisions** (signal patterns, candidate
 * eligibility heuristics, skip conditions) from the **mechanism** that
 * applies logical normalization to AST nodes.  By keeping the two layers
 * separate:
 *
 * 1. Policy logic is testable in isolation without touching the rule's
 *    visitor, autofix reporting, or source-text rewriting.
 * 2. Signal patterns and eligibility thresholds can be inspected and
 *    overridden by callers without coupling them to the rewrite path.
 * 3. Future contributors can extend the rule by composing new policy
 *    evaluators while leaving the mechanism code unchanged.
 *
 * The policy exposes a small set of pure predicates grouped under the
 * `optimizeLogicalFlowPolicy` namespace, plus a typed decision shape for
 * nodes that need a richer multi-flag evaluation result.
 */

import { Core } from "@gmloop/core";

import { findPreviousNonWhitespaceIndex } from "../rule-base-helpers.js";

/**
 * Signal patterns that mark source text as a candidate for logical-flow
 * normalization.  These are compiled once at module-evaluation time and
 * reused across all calls.  Centralising them here makes it trivial to
 * extend the recognised operator vocabulary without touching the rule.
 */
export type LogicalFlowSignalPatterns = Readonly<{
    /**
     * Matches any character or keyword that signals logical syntax
     * (e.g., `&&`, `||`, `^^`, `and`, `or`, `xor`).
     */
    logicalNormalizationSignal: RegExp;
    /**
     * Matches the leading characters of a comment (`//` or `/*`); used as
     * a cheap pre-check before the more expensive comment scan.
     */
    commentSequence: RegExp;
}>;

/**
 * Default signal patterns for logical-flow candidate detection.  The set of
 * recognised operators is the GML canonical logical vocabulary: the C-style
 * symbolic forms (`&&`, `||`, `^^`) plus their keyword aliases (`and`, `or`,
 * `xor`) and the boolean literals (`true`, `false`).
 */
export const DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS: LogicalFlowSignalPatterns = Object.freeze({
    logicalNormalizationSignal: /&&|\|\||\^\^|\b(?:and|or|xor|true|false)\b/u,
    commentSequence: /\/\/|\/\*/u
});

/**
 * Input shape for a source-text-only logical-flow evaluation.
 */
export type LogicalFlowSourceTextContext = Readonly<{
    /** Full source text of the file under inspection. */
    fullSourceText: string;
    /** Slised source text of the candidate node (within `fullSourceText`). */
    sourceText: string;
    /** Start offset of the candidate within `fullSourceText`. */
    nodeStartIndex: number;
}>;

/**
 * Result of evaluating whether a source-text slice is a viable candidate
 * for logical-flow normalization.
 *
 * The fields are intentionally independent so the mechanism code can read
 * only the decisions it needs (typically `hasLogicalSignal` for the cheap
 * gate and `hasUnsafeComment` for the rejection gate).
 */
export type LogicalFlowCandidateEvaluation = Readonly<{
    /** Whether the slice contains a recognized logical operator or boolean literal. */
    hasLogicalSignal: boolean;
    /** Whether the slice contains a comment that would be unsafe to rewrite. */
    hasUnsafeComment: boolean;
}>;

/**
 * Pure evaluator: decides whether a candidate source-text slice is worth
 * handing to the normalization transform.
 *
 * This is the cheap "should we even consider this node?" gate.  It performs
 * no AST mutations and is safe to call for every node the visitor visits.
 */
export function evaluateLogicalFlowCandidate(
    context: LogicalFlowSourceTextContext,
    signalPatterns: LogicalFlowSignalPatterns = DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS
): LogicalFlowCandidateEvaluation {
    const hasLogicalSignal = signalPatterns.logicalNormalizationSignal.test(context.sourceText);
    const hasUnsafeComment = evaluateUnsafeCommentSyntax(context.sourceText, signalPatterns.commentSequence);

    return Object.freeze({ hasLogicalSignal, hasUnsafeComment });
}

/**
 * Pure evaluator: returns `true` when `sourceText` contains a real
 * comment that would make normalization unsafe.  The pre-check on
 * `commentSequence` is purely a fast path — if no `//` or `/*` is present
 * the function short-circuits without scanning.
 */
export function evaluateUnsafeCommentSyntax(
    sourceText: string,
    commentSequence: RegExp = DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS.commentSequence
): boolean {
    if (!commentSequence.test(sourceText)) {
        return false;
    }

    const sourceLength = sourceText.length;
    const scanState = Core.createStringCommentScanState();
    for (let index = 0; index < sourceLength; ) {
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
 * Pure evaluator: returns `true` when the source text contains a logical
 * operator or boolean literal that the normalization transform knows how
 * to simplify.
 */
export function evaluateHasLogicalNormalizationSignal(
    sourceText: string,
    signalPatterns: LogicalFlowSignalPatterns = DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS
): boolean {
    return signalPatterns.logicalNormalizationSignal.test(sourceText);
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

/**
 * Pure evaluator: returns `true` when the given `IfStatement` matches one
 * of the recognised normalization shapes:
 *
 * - `if (cond) return true; else return false;` → `return cond;`
 * - `if (cond) return false; else return true;` → `return !cond;`
 * - `if (cond) x = A; else x = B;` → `x = cond ? A : B;`
 *
 * The evaluator only inspects shape; it does not mutate the AST.
 */
export function evaluateCanIfStatementBenefitFromNormalization(node: unknown): boolean {
    const ifNode = Core.unwrapParenthesizedExpression(node);
    if (!ifNode || (ifNode as { type?: string }).type !== "IfStatement") {
        return false;
    }

    const consequentStatement = (ifNode as { consequent?: unknown }).consequent;
    const alternateStatement = (ifNode as { alternate?: unknown }).alternate;

    const consequentBody =
        (consequentStatement as { type?: string } | null)?.type === "BlockStatement"
            ? ((consequentStatement as { body?: unknown[] }).body ?? [])
            : [consequentStatement];
    const alternateBody = alternateStatement
        ? (alternateStatement as { type?: string }).type === "BlockStatement"
            ? ((alternateStatement as { body?: unknown[] }).body ?? [])
            : [alternateStatement]
        : [];

    if (consequentStatement && alternateStatement) {
        const consequentReturn = extractSingleReturnStatement(consequentStatement);
        const alternateReturn = extractSingleReturnStatement(alternateStatement);
        if (consequentReturn && alternateReturn) {
            const consequentValue = Core.getBooleanLiteralValue(consequentReturn.argument, {
                acceptBooleanPrimitives: true
            });
            const alternateValue = Core.getBooleanLiteralValue(alternateReturn.argument, {
                acceptBooleanPrimitives: true
            });
            return (
                (consequentValue === "true" && alternateValue === "false") ||
                (consequentValue === "false" && alternateValue === "true")
            );
        }

        if (consequentBody.length === 1 && alternateBody.length === 1) {
            const consequentExpr = readAssignmentExpr(consequentBody[0]);
            const alternateExpr = readAssignmentExpr(alternateBody[0]);
            if (consequentExpr && alternateExpr && consequentExpr.operator === "=" && alternateExpr.operator === "=") {
                return evaluateAreComparableAssignmentTargetsEquivalent(consequentExpr.left, alternateExpr.left);
            }
        }
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

/**
 * Pure evaluator: returns `true` when the supplied `UnaryExpression` is a
 * `!` whose argument is a unary, logical, parenthesized, or short-circuit
 * binary expression — the shapes the normalizer can rewrite via De Morgan
 * or double-negation elimination.
 */
export function evaluateCanUnaryExpressionBenefitFromNormalization(node: unknown): boolean {
    const unaryExpression = node as { type?: string; operator?: string; argument?: unknown };
    if (!unaryExpression || unaryExpression.type !== "UnaryExpression" || unaryExpression.operator !== "!") {
        return false;
    }

    const argument = Core.unwrapParenthesizedExpression(unaryExpression.argument);
    if (!argument) {
        return false;
    }

    const argType = (argument as { type?: string }).type ?? "";
    return (
        argType === "UnaryExpression" ||
        argType === "LogicalExpression" ||
        argType === "ParenthesizedExpression" ||
        (argType === "BinaryExpression" &&
            ((argument as { operator?: string }).operator === "&&" ||
                (argument as { operator?: string }).operator === "||"))
    );
}

/**
 * Pure evaluator: returns `true` when the supplied `LogicalExpression` or
 * short-circuit `BinaryExpression` has a shape the normalizer can simplify:
 * a boolean-literal operand, or nested logical/binary operands on either
 * side that may absorb/distribute.
 */
export function evaluateCanLogicalExpressionBenefitFromNormalization(node: unknown): boolean {
    const logicalExpression = node as { type?: string; operator?: string; left?: unknown; right?: unknown };
    if (
        !logicalExpression ||
        (logicalExpression.type !== "LogicalExpression" && logicalExpression.type !== "BinaryExpression") ||
        (logicalExpression.operator !== "&&" && logicalExpression.operator !== "||")
    ) {
        return false;
    }

    const left = Core.unwrapParenthesizedExpression(logicalExpression.left);
    const right = Core.unwrapParenthesizedExpression(logicalExpression.right);
    if (!left || !right) {
        return false;
    }

    if (
        Core.isBooleanLiteral(left, { acceptBooleanPrimitives: true }) ||
        Core.isBooleanLiteral(right, { acceptBooleanPrimitives: true })
    ) {
        return true;
    }

    const leftType = (left as { type?: string }).type ?? "";
    const rightType = (right as { type?: string }).type ?? "";

    return (
        leftType === "LogicalExpression" ||
        rightType === "LogicalExpression" ||
        leftType === "BinaryExpression" ||
        rightType === "BinaryExpression"
    );
}

/**
 * Pure structural-equality predicate over the assignment-target shapes
 * the rule cares about: identifiers and member access (dot and index).
 *
 * Returns `true` when `left` and `right` are the same kind of node and
 * their contents match recursively.  Other node kinds are deliberately
 * rejected — the normalizer only rewrites assignments to identifier-like
 * targets.
 */
export function evaluateAreComparableAssignmentTargetsEquivalent(left: unknown, right: unknown): boolean {
    if (!Core.isObjectLike(left) || !Core.isObjectLike(right)) {
        return false;
    }

    const leftRecord = left as { type?: string; name?: string; object?: unknown; property?: unknown; index?: unknown };
    const rightRecord = right as {
        type?: string;
        name?: string;
        object?: unknown;
        property?: unknown;
        index?: unknown;
    };

    if (leftRecord.type !== rightRecord.type) {
        return false;
    }

    switch (leftRecord.type) {
        case "Identifier": {
            return typeof leftRecord.name === "string" && leftRecord.name === rightRecord.name;
        }
        case "MemberDotExpression": {
            return (
                evaluateAreComparableAssignmentTargetsEquivalent(leftRecord.object, rightRecord.object) &&
                evaluateAreComparableAssignmentTargetsEquivalent(leftRecord.property, rightRecord.property)
            );
        }
        case "MemberIndexExpression": {
            return (
                evaluateAreComparableAssignmentTargetsEquivalent(leftRecord.object, rightRecord.object) &&
                evaluateAreComparableAssignmentTargetsEquivalent(leftRecord.index, rightRecord.index)
            );
        }
        default: {
            return false;
        }
    }
}

function readAssignmentExpr(statement: unknown): { left: unknown; right: unknown; operator: string } | null {
    if (!statement || typeof statement !== "object") {
        return null;
    }

    if ((statement as { type?: string }).type === "AssignmentExpression") {
        return statement as { left: unknown; right: unknown; operator: string };
    }

    if ((statement as { type?: string }).type === "ExpressionStatement") {
        const expression = (statement as { expression?: unknown }).expression;
        if (expression && (expression as { type?: string }).type === "AssignmentExpression") {
            return expression as { left: unknown; right: unknown; operator: string };
        }
    }

    return null;
}

/**
 * Namespace bundling the policy layer of the `gml/optimize-logical-flow`
 * rule.  Importers should reach for these predicates instead of
 * re-implementing eligibility checks inline; the mechanism code is in
 * `optimize-logical-flow-rule.ts`.
 */
export const optimizeLogicalFlowPolicy = Object.freeze({
    evaluateLogicalFlowCandidate,
    evaluateUnsafeCommentSyntax,
    evaluateHasLogicalNormalizationSignal,
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateCanIfStatementBenefitFromNormalization,
    evaluateCanDirectBooleanReturnBenefitFromNormalization,
    evaluateCanUnaryExpressionBenefitFromNormalization,
    evaluateCanLogicalExpressionBenefitFromNormalization,
    evaluateAreComparableAssignmentTargetsEquivalent,
    DEFAULT_LOGICAL_FLOW_SIGNAL_PATTERNS
});
