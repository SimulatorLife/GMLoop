import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, findPreviousNonWhitespaceIndex, resolveLocFromIndex } from "../rule-base-helpers.js";
import { applyLogicalNormalizationWithChangeMetadata } from "../transforms/logical-expression-traversal-normalization.js";

/**
 * Normalize whitespace for structural expression comparisons.
 */
function normalizeWhitespaceForComparison(value: string): string {
    return value.replaceAll(/\s+/g, " ");
}

type SourceTextRange = Readonly<{ start: number; end: number }>;

const LOGICAL_NORMALIZATION_SIGNAL_PATTERN = /&&|\|\||!|\b(?:and|or|not|true|false)\b/u;
const COMMENT_SEQUENCE_PATTERN = /\/\/|\/\*/u;

function containsLogicalNormalizationSignal(sourceText: string): boolean {
    return LOGICAL_NORMALIZATION_SIGNAL_PATTERN.test(sourceText);
}

function containsUnsafeCommentSyntax(sourceText: string): boolean {
    if (!COMMENT_SEQUENCE_PATTERN.test(sourceText)) {
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

function isElsePrefixedIfAtIndex(fullSourceText: string, ifKeywordStartIndex: number): boolean {
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

function unwrapForRule(node: unknown) {
    return Core.unwrapParenthesizedExpression(node);
}

function isIfNodeInElseIfChain(node: unknown): boolean {
    const ifNode = unwrapForRule(node);
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

function canIfStatementBenefitFromNormalization(node: unknown): boolean {
    const ifNode = unwrapForRule(node);
    if (!ifNode || (ifNode as { type?: string }).type !== "IfStatement") {
        return false;
    }

    if (canBooleanLiteralComparisonBenefitFromNormalization((ifNode as { test?: unknown }).test)) {
        return true;
    }

    const consequentStatement = (ifNode as { consequent?: unknown }).consequent;
    const alternateStatement = (ifNode as { alternate?: unknown }).alternate;

    if (consequentStatement && alternateStatement) {
        if (
            (consequentStatement as { type?: string }).type === "ReturnStatement" &&
            (alternateStatement as { type?: string }).type === "ReturnStatement"
        ) {
            const consequentValue = Core.getBooleanLiteralValue(
                (consequentStatement as { argument?: unknown }).argument,
                {
                    acceptBooleanPrimitives: true
                }
            );
            const alternateValue = Core.getBooleanLiteralValue(
                (alternateStatement as { argument?: unknown }).argument,
                {
                    acceptBooleanPrimitives: true
                }
            );
            return (
                (consequentValue === "true" && alternateValue === "false") ||
                (consequentValue === "false" && alternateValue === "true")
            );
        }

        const consequentBody =
            (consequentStatement as { type?: string }).type === "BlockStatement"
                ? ((consequentStatement as { body?: unknown[] }).body ?? [])
                : [consequentStatement];
        const alternateBody =
            (alternateStatement as { type?: string }).type === "BlockStatement"
                ? ((alternateStatement as { body?: unknown[] }).body ?? [])
                : [alternateStatement];

        if (consequentBody.length === 1 && alternateBody.length === 1) {
            const consequentExpr = (consequentBody[0] as { expression?: unknown })?.expression;
            const alternateExpr = (alternateBody[0] as { expression?: unknown })?.expression;
            if (
                consequentExpr &&
                alternateExpr &&
                (consequentExpr as { type?: string }).type === "AssignmentExpression" &&
                (alternateExpr as { type?: string }).type === "AssignmentExpression" &&
                (consequentExpr as { operator?: string }).operator === "=" &&
                (alternateExpr as { operator?: string }).operator === "="
            ) {
                return areComparableAssignmentTargetsEquivalent(
                    (consequentExpr as { left?: unknown }).left,
                    (alternateExpr as { left?: unknown }).left
                );
            }
        }
    }

    const consequentBody =
        (consequentStatement as { type?: string }).type === "BlockStatement"
            ? ((consequentStatement as { body?: unknown[] }).body ?? [])
            : [consequentStatement];
    if (consequentBody.length === 1) {
        const consequentExpr = (consequentBody[0] as { expression?: unknown })?.expression;
        if (
            consequentExpr &&
            (consequentExpr as { type?: string }).type === "AssignmentExpression" &&
            (consequentExpr as { operator?: string }).operator === "="
        ) {
            return isUndefinedCheckAgainstTarget(
                (ifNode as { test?: unknown }).test,
                (consequentExpr as { left?: unknown }).left
            );
        }
    }

    return false;
}

function isUndefinedCheckAgainstTarget(test: unknown, target: unknown): boolean {
    const testNode = unwrapForRule(test);
    const targetNode = target as { type?: string } | null;

    if (!testNode || !targetNode) {
        return false;
    }

    const callee =
        (testNode as { callee?: unknown; object?: unknown }).callee ?? (testNode as { object?: unknown }).object;
    const argumentsList = (testNode as { arguments?: unknown[] }).arguments ?? [];
    if (
        (testNode as { type?: string }).type === "CallExpression" &&
        callee &&
        (callee as { type?: string }).type === "Identifier" &&
        (callee as { name?: string }).name === "is_undefined" &&
        argumentsList.length === 1
    ) {
        return areComparableAssignmentTargetsEquivalent(argumentsList[0], target);
    }

    if (
        (testNode as { type?: string }).type !== "BinaryExpression" ||
        (testNode as { operator?: string }).operator !== "=="
    ) {
        return false;
    }

    const left = (testNode as { left?: unknown }).left;
    const right = (testNode as { right?: unknown }).right;

    const leftNode = left as { type?: string; name?: string; value?: unknown } | null;
    const rightNode = right as { type?: string; name?: string; value?: unknown } | null;

    const leftUndefined =
        leftNode &&
        ((leftNode.type === "Identifier" && leftNode.name === "undefined") ||
            (leftNode.type === "Literal" && (leftNode.value === undefined || leftNode.value === "undefined")));
    const rightUndefined =
        rightNode &&
        ((rightNode.type === "Identifier" && rightNode.name === "undefined") ||
            (rightNode.type === "Literal" && (rightNode.value === undefined || rightNode.value === "undefined")));

    return (
        (leftUndefined && areComparableAssignmentTargetsEquivalent(right, target)) ||
        (rightUndefined && areComparableAssignmentTargetsEquivalent(left, target))
    );
}

function areComparableAssignmentTargetsEquivalent(left: unknown, right: unknown): boolean {
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
                areComparableAssignmentTargetsEquivalent(leftRecord.object, rightRecord.object) &&
                areComparableAssignmentTargetsEquivalent(leftRecord.property, rightRecord.property)
            );
        }
        case "MemberIndexExpression": {
            return (
                areComparableAssignmentTargetsEquivalent(leftRecord.object, rightRecord.object) &&
                areComparableAssignmentTargetsEquivalent(leftRecord.index, rightRecord.index)
            );
        }
        default: {
            return false;
        }
    }
}

function canBooleanLiteralComparisonBenefitFromNormalization(node: unknown): boolean {
    const comparisonNode = unwrapForRule(node);
    if (
        !comparisonNode ||
        (comparisonNode as { type?: string }).type !== "BinaryExpression" ||
        ((comparisonNode as { operator?: string }).operator !== "==" &&
            (comparisonNode as { operator?: string }).operator !== "!=")
    ) {
        return false;
    }

    const left = unwrapForRule((comparisonNode as { left?: unknown }).left);
    const right = unwrapForRule((comparisonNode as { right?: unknown }).right);
    if (!left || !right) {
        return false;
    }

    const leftBoolean = Core.getBooleanLiteralValue(left, { acceptBooleanPrimitives: true });
    const rightBoolean = Core.getBooleanLiteralValue(right, { acceptBooleanPrimitives: true });
    const hasLeftBoolean = leftBoolean === "true" || leftBoolean === "false";
    const hasRightBoolean = rightBoolean === "true" || rightBoolean === "false";
    return hasLeftBoolean !== hasRightBoolean;
}

function canUnaryExpressionBenefitFromNormalization(node: unknown): boolean {
    const unaryExpression = node as { type?: string; operator?: string; argument?: unknown };
    if (!unaryExpression || unaryExpression.type !== "UnaryExpression" || unaryExpression.operator !== "!") {
        return false;
    }

    const argument = unwrapForRule(unaryExpression.argument);
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

function canLogicalExpressionBenefitFromNormalization(node: unknown): boolean {
    const logicalExpression = node as { type?: string; operator?: string; left?: unknown; right?: unknown };
    if (
        !logicalExpression ||
        (logicalExpression.type !== "LogicalExpression" && logicalExpression.type !== "BinaryExpression") ||
        (logicalExpression.operator !== "&&" && logicalExpression.operator !== "||")
    ) {
        return false;
    }

    const left = unwrapForRule(logicalExpression.left);
    const right = unwrapForRule(logicalExpression.right);
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
    // At this point the operator is guaranteed to be "&&" or "||" (checked above).
    // Both operators share the same structural heuristic: normalize when either
    // operand is itself a logical/binary expression that could be further simplified.
    return (
        leftType === "LogicalExpression" ||
        rightType === "LogicalExpression" ||
        leftType === "BinaryExpression" ||
        rightType === "BinaryExpression"
    );
}

function getNodeRange(node: unknown): SourceTextRange | null {
    const nodeStart = Core.getNodeStartIndex(node);
    const nodeEnd = Core.getNodeEndIndex(node);
    if (
        typeof nodeStart !== "number" ||
        typeof nodeEnd !== "number" ||
        !Number.isFinite(nodeStart) ||
        !Number.isFinite(nodeEnd) ||
        nodeEnd <= nodeStart
    ) {
        return null;
    }

    return Object.freeze({
        start: nodeStart,
        end: nodeEnd
    });
}

function isRangeInsideAnyRange(range: SourceTextRange, existingRanges: ReadonlyArray<SourceTextRange>): boolean {
    return existingRanges.some((existingRange) => range.start >= existingRange.start && range.end <= existingRange.end);
}

export function createOptimizeLogicalFlowRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const rewrittenNodeRanges: SourceTextRange[] = [];

            return Object.freeze({
                "BlockStatement, LogicalExpression, BinaryExpression, UnaryExpression[operator='!'], IfStatement"(
                    node: any
                ) {
                    const nodeRange = getNodeRange(node);
                    if (!nodeRange) {
                        return;
                    }

                    if (isRangeInsideAnyRange(nodeRange, rewrittenNodeRanges)) {
                        return;
                    }

                    const fullSourceText = context.sourceCode.text;
                    const sourceText = fullSourceText.slice(nodeRange.start, nodeRange.end);
                    if (Core.hasComment(node) || containsUnsafeCommentSyntax(sourceText)) {
                        return;
                    }

                    if (
                        node.type === "IfStatement" &&
                        (isIfNodeInElseIfChain(node) || isElsePrefixedIfAtIndex(fullSourceText, nodeRange.start))
                    ) {
                        return;
                    }

                    if (
                        (node.type === "BlockStatement" ||
                            node.type === "LogicalExpression" ||
                            node.type === "BinaryExpression" ||
                            node.type === "UnaryExpression") &&
                        !containsLogicalNormalizationSignal(sourceText)
                    ) {
                        return;
                    }

                    if (node.type === "IfStatement" && !canIfStatementBenefitFromNormalization(node)) {
                        return;
                    }

                    if (node.type === "UnaryExpression" && !canUnaryExpressionBenefitFromNormalization(node)) {
                        return;
                    }

                    if (
                        (node.type === "LogicalExpression" || node.type === "BinaryExpression") &&
                        !canLogicalExpressionBenefitFromNormalization(node)
                    ) {
                        return;
                    }

                    const cloned = Core.cloneAstNode(node) as MutableGameMakerAstNode;
                    if (!cloned) {
                        return;
                    }

                    const normalizationResult = applyLogicalNormalizationWithChangeMetadata(cloned);
                    if (!normalizationResult.changed) {
                        return;
                    }

                    const newText = gmlRuleAutofixServices.printNodeForAutofix(normalizationResult.ast, fullSourceText);

                    if (normalizeWhitespaceForComparison(sourceText) !== normalizeWhitespaceForComparison(newText)) {
                        rewrittenNodeRanges.push(nodeRange);

                        context.report({
                            loc: resolveLocFromIndex(context, fullSourceText, Core.getNodeStartIndex(node) ?? 0),
                            messageId: definition.messageId,
                            fix(fixer) {
                                return fixer.replaceTextRange([nodeRange.start, nodeRange.end], newText);
                            }
                        });
                    }
                }
            });
        }
    });
}
