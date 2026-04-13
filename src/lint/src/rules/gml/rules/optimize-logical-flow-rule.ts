import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { printNodeForAutofix } from "../print-expression.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";
import { applyLogicalNormalizationWithChangeMetadata } from "../transforms/logical-expression-traversal-normalization.js";

/**
 * Normalize whitespace for structural expression comparisons.
 */
function normalizeWhitespaceForComparison(value: string): string {
    return value.replaceAll(/\s+/g, " ");
}

type SourceTextRange = Readonly<{ start: number; end: number }>;
type BooleanLiteralInput = Parameters<typeof Core.getBooleanLiteralValue>[0];

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
    let cursor = ifKeywordStartIndex - 1;
    while (cursor >= 0 && /\s/u.test(fullSourceText[cursor])) {
        cursor -= 1;
    }

    const elseStart = cursor - 3;
    if (elseStart < 0) {
        return false;
    }

    if (fullSourceText.slice(elseStart, cursor + 1).toLowerCase() !== "else") {
        return false;
    }

    const beforeElse = elseStart > 0 ? fullSourceText[elseStart - 1] : "";
    return beforeElse === "" || Core.isIdentifierBoundaryCharacter(beforeElse);
}

type AstRecord = Record<string, unknown> & Readonly<{ type?: string }>;

function asAstRecord(value: unknown): AstRecord | null {
    if (!Core.isObjectLike(value)) {
        return null;
    }

    return value as AstRecord;
}

function unwrapSingleStatement(node: unknown): AstRecord | null {
    const record = asAstRecord(node);
    if (!record) {
        return null;
    }

    if (record.type !== "BlockStatement") {
        return record;
    }

    const body = Array.isArray(record.body) ? record.body : [];
    const [firstStatement] = body;
    const firstStatementRecord = asAstRecord(firstStatement);
    if (body.length !== 1 || !firstStatementRecord) {
        return null;
    }

    return firstStatementRecord;
}

function areComparableAssignmentTargetsEquivalent(left: unknown, right: unknown): boolean {
    const leftRecord = asAstRecord(left);
    const rightRecord = asAstRecord(right);
    if (!leftRecord || !rightRecord) {
        return false;
    }

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

function isUndefinedCheckAgainstTarget(test: unknown, target: unknown): boolean {
    let testRecord = asAstRecord(test);
    while (testRecord && testRecord.type === "ParenthesizedExpression") {
        testRecord = asAstRecord(testRecord.expression);
    }

    const targetRecord = asAstRecord(target);
    if (!testRecord || !targetRecord) {
        return false;
    }

    const callee = asAstRecord(testRecord.callee ?? testRecord.object);
    const argumentsList = Array.isArray(testRecord.arguments) ? testRecord.arguments : [];
    if (
        testRecord.type === "CallExpression" &&
        callee &&
        callee.type === "Identifier" &&
        callee.name === "is_undefined" &&
        argumentsList.length === 1
    ) {
        return areComparableAssignmentTargetsEquivalent(argumentsList[0], targetRecord);
    }

    if (testRecord.type !== "BinaryExpression" || testRecord.operator !== "==") {
        return false;
    }

    const left = asAstRecord(testRecord.left);
    const right = asAstRecord(testRecord.right);

    const leftUndefined =
        left &&
        ((left.type === "Identifier" && left.name === "undefined") ||
            (left.type === "Literal" && (left.value === undefined || left.value === "undefined")));
    const rightUndefined =
        right &&
        ((right.type === "Identifier" && right.name === "undefined") ||
            (right.type === "Literal" && (right.value === undefined || right.value === "undefined")));

    return (
        (leftUndefined && areComparableAssignmentTargetsEquivalent(right, targetRecord)) ||
        (rightUndefined && areComparableAssignmentTargetsEquivalent(left, targetRecord))
    );
}

function extractAssignmentExpressionFromStatementNode(statementNode: AstRecord | null): AstRecord | null {
    if (!statementNode) {
        return null;
    }

    if (statementNode.type === "AssignmentExpression") {
        return statementNode;
    }

    if (statementNode.type !== "ExpressionStatement") {
        return null;
    }

    const expression = asAstRecord(statementNode.expression);
    if (!expression || expression.type !== "AssignmentExpression") {
        return null;
    }

    return expression;
}

function canIfStatementBenefitFromNormalization(node: unknown): boolean {
    const ifNode = asAstRecord(node);
    if (!ifNode || ifNode.type !== "IfStatement") {
        return false;
    }

    if (canBooleanLiteralComparisonBenefitFromNormalization(ifNode.test)) {
        return true;
    }

    const consequentStatement = unwrapSingleStatement(ifNode.consequent);
    const alternateStatement = unwrapSingleStatement(ifNode.alternate);

    if (consequentStatement && alternateStatement) {
        if (consequentStatement.type === "ReturnStatement" && alternateStatement.type === "ReturnStatement") {
            const consequentValue = Core.getBooleanLiteralValue(consequentStatement.argument as BooleanLiteralInput, {
                acceptBooleanPrimitives: true
            });
            const alternateValue = Core.getBooleanLiteralValue(alternateStatement.argument as BooleanLiteralInput, {
                acceptBooleanPrimitives: true
            });
            return (
                (consequentValue === "true" && alternateValue === "false") ||
                (consequentValue === "false" && alternateValue === "true")
            );
        }

        const consequentExpression = extractAssignmentExpressionFromStatementNode(consequentStatement);
        const alternateExpression = extractAssignmentExpressionFromStatementNode(alternateStatement);
        if (!consequentExpression || !alternateExpression) {
            return false;
        }

        if (consequentExpression.operator !== "=" || alternateExpression.operator !== "=") {
            return false;
        }

        return areComparableAssignmentTargetsEquivalent(consequentExpression.left, alternateExpression.left);
    }

    const consequentExpression = extractAssignmentExpressionFromStatementNode(consequentStatement);
    if (!consequentExpression) {
        return false;
    }

    if (consequentExpression.operator !== "=") {
        return false;
    }

    return isUndefinedCheckAgainstTarget(ifNode.test, consequentExpression.left);
}

function isIfNodeInElseIfChain(node: unknown): boolean {
    const ifNode = asAstRecord(node);
    if (!ifNode || ifNode.type !== "IfStatement") {
        return false;
    }

    const parent = asAstRecord(ifNode.parent);
    if (!parent) {
        return false;
    }

    if (parent.type === "IfStatement" && parent.alternate === ifNode) {
        return true;
    }

    if (
        parent.type === "BlockStatement" &&
        Array.isArray(parent.body) &&
        parent.body.length === 1 &&
        parent.body[0] === ifNode
    ) {
        const grandParent = asAstRecord(parent.parent);
        return Boolean(grandParent && grandParent.type === "IfStatement" && grandParent.alternate === parent);
    }
    return false;
}

function canBooleanLiteralComparisonBenefitFromNormalization(node: unknown): boolean {
    const comparisonNode = unwrapParenthesizedNode(node);
    if (
        !comparisonNode ||
        comparisonNode.type !== "BinaryExpression" ||
        (comparisonNode.operator !== "==" && comparisonNode.operator !== "!=")
    ) {
        return false;
    }

    const left = unwrapParenthesizedNode(comparisonNode.left);
    const right = unwrapParenthesizedNode(comparisonNode.right);
    if (!left || !right) {
        return false;
    }

    const leftBoolean = Core.getBooleanLiteralValue(left as BooleanLiteralInput, {
        acceptBooleanPrimitives: true
    });
    const rightBoolean = Core.getBooleanLiteralValue(right as BooleanLiteralInput, {
        acceptBooleanPrimitives: true
    });
    const hasLeftBoolean = leftBoolean === "true" || leftBoolean === "false";
    const hasRightBoolean = rightBoolean === "true" || rightBoolean === "false";
    return hasLeftBoolean !== hasRightBoolean;
}

function unwrapParenthesizedNode(node: unknown): AstRecord | null {
    let current = asAstRecord(node);
    while (current && current.type === "ParenthesizedExpression") {
        current = asAstRecord(current.expression);
    }
    return current;
}

function canUnaryExpressionBenefitFromNormalization(node: unknown): boolean {
    const unaryExpression = asAstRecord(node);
    if (!unaryExpression || unaryExpression.type !== "UnaryExpression" || unaryExpression.operator !== "!") {
        return false;
    }

    const argument = unwrapParenthesizedNode(unaryExpression.argument);
    if (!argument) {
        return false;
    }

    return (
        argument.type === "UnaryExpression" ||
        argument.type === "LogicalExpression" ||
        (argument.type === "BinaryExpression" && (argument.operator === "&&" || argument.operator === "||")) ||
        argument.type === "ParenthesizedExpression"
    );
}

function canLogicalExpressionBenefitFromNormalization(node: unknown): boolean {
    const logicalExpression = asAstRecord(node);
    if (
        !logicalExpression ||
        (logicalExpression.type !== "LogicalExpression" && logicalExpression.type !== "BinaryExpression") ||
        (logicalExpression.operator !== "&&" && logicalExpression.operator !== "||")
    ) {
        return false;
    }

    const left = unwrapParenthesizedNode(logicalExpression.left);
    const right = unwrapParenthesizedNode(logicalExpression.right);
    if (!left || !right) {
        return false;
    }

    if (
        Core.isBooleanLiteral(left as BooleanLiteralInput, { acceptBooleanPrimitives: true }) ||
        Core.isBooleanLiteral(right as BooleanLiteralInput, { acceptBooleanPrimitives: true })
    ) {
        return true;
    }

    // At this point the operator is guaranteed to be "&&" or "||" (checked above).
    // Both operators share the same structural heuristic: normalize when either
    // operand is itself a logical/binary expression that could be further simplified.
    return (
        left.type === "LogicalExpression" ||
        right.type === "LogicalExpression" ||
        left.type === "BinaryExpression" ||
        right.type === "BinaryExpression"
    );
}

function getNodeRange(node: unknown): SourceTextRange | null {
    const nodeStart = Core.getNodeStartIndex(node as any);
    const nodeEnd = Core.getNodeEndIndex(node as any);
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
    return existingRanges.some((existingRange) => {
        return range.start >= existingRange.start && range.end <= existingRange.end;
    });
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
                    const originalNode = node;
                    const nodeRange = getNodeRange(originalNode);
                    if (!nodeRange) {
                        return;
                    }

                    if (isRangeInsideAnyRange(nodeRange, rewrittenNodeRanges)) {
                        return;
                    }

                    const fullSourceText = context.sourceCode.text;
                    const sourceText = fullSourceText.slice(nodeRange.start, nodeRange.end);
                    if (Core.hasComment(originalNode) || containsUnsafeCommentSyntax(sourceText)) {
                        return;
                    }

                    if (
                        originalNode.type === "IfStatement" &&
                        (isIfNodeInElseIfChain(originalNode) ||
                            isElsePrefixedIfAtIndex(fullSourceText, nodeRange.start))
                    ) {
                        return;
                    }

                    if (
                        (originalNode.type === "BlockStatement" ||
                            originalNode.type === "LogicalExpression" ||
                            originalNode.type === "BinaryExpression" ||
                            originalNode.type === "UnaryExpression") &&
                        !containsLogicalNormalizationSignal(sourceText)
                    ) {
                        return;
                    }

                    if (originalNode.type === "IfStatement" && !canIfStatementBenefitFromNormalization(originalNode)) {
                        return;
                    }

                    if (
                        originalNode.type === "UnaryExpression" &&
                        !canUnaryExpressionBenefitFromNormalization(originalNode)
                    ) {
                        return;
                    }

                    if (
                        originalNode.type === "LogicalExpression" &&
                        !canLogicalExpressionBenefitFromNormalization(originalNode)
                    ) {
                        return;
                    }

                    if (
                        originalNode.type === "BinaryExpression" &&
                        !canLogicalExpressionBenefitFromNormalization(originalNode)
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

                    const newText = printNodeForAutofix(normalizationResult.ast, fullSourceText);

                    if (normalizeWhitespaceForComparison(sourceText) !== normalizeWhitespaceForComparison(newText)) {
                        rewrittenNodeRanges.push(nodeRange);

                        context.report({
                            loc: resolveLocFromIndex(
                                context,
                                fullSourceText,
                                Core.getNodeStartIndex(originalNode) ?? 0
                            ),
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
