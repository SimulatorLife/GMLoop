import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";
import { applyLogicalNormalizationWithChangeMetadata } from "../transforms/logical-expression-traversal-normalization.js";
import {
    evaluateCanDirectBooleanReturnBenefitFromNormalization,
    evaluateCanIfStatementBenefitFromNormalization,
    evaluateCanLogicalExpressionBenefitFromNormalization,
    evaluateCanUnaryExpressionBenefitFromNormalization,
    evaluateHasLogicalNormalizationSignal,
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateUnsafeCommentSyntax
} from "./optimize-logical-flow-policy.js";

/**
 * Normalize whitespace for structural expression comparisons.
 */
function normalizeWhitespaceForComparison(value: string): string {
    return value.replaceAll(/\s+/g, " ");
}

type SourceTextRange = Readonly<{ start: number; end: number }>;

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

function readFollowingStatement(node: unknown): unknown {
    const parent = Core.unwrapParenthesizedExpression((node as { parent?: unknown }).parent);
    if (!parent || typeof parent !== "object") {
        return null;
    }

    const body = (parent as { body?: unknown }).body;
    if (!Array.isArray(body)) {
        return null;
    }

    const index = body.indexOf(node);
    if (index === -1 || index + 1 >= body.length) {
        return null;
    }

    return body[index + 1];
}

export function createOptimizeLogicalFlowRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const rewrittenNodeRanges: SourceTextRange[] = [];
            const skippedNodeRanges: SourceTextRange[] = [];

            return Object.freeze({
                "LogicalExpression, BinaryExpression, UnaryExpression[operator='!'], IfStatement"(node: any) {
                    const nodeRange = getNodeRange(node);
                    if (!nodeRange) {
                        return;
                    }

                    if (
                        isRangeInsideAnyRange(nodeRange, rewrittenNodeRanges) ||
                        isRangeInsideAnyRange(nodeRange, skippedNodeRanges)
                    ) {
                        return;
                    }

                    const fullSourceText = context.sourceCode.text;
                    const sourceText = fullSourceText.slice(nodeRange.start, nodeRange.end);
                    if (Core.hasComment(node) || evaluateUnsafeCommentSyntax(sourceText)) {
                        return;
                    }

                    const isElseIfNode =
                        node.type === "IfStatement" &&
                        (evaluateIsIfNodeInElseIfChain(node) ||
                            evaluateIsElsePrefixedIfAtIndex(fullSourceText, nodeRange.start));
                    const isDirectBooleanReturn =
                        node.type === "IfStatement" &&
                        evaluateCanDirectBooleanReturnBenefitFromNormalization(node, readFollowingStatement(node));

                    if (
                        (node.type === "LogicalExpression" ||
                            node.type === "BinaryExpression" ||
                            node.type === "UnaryExpression") &&
                        !evaluateHasLogicalNormalizationSignal(sourceText)
                    ) {
                        return;
                    }

                    if (node.type === "IfStatement") {
                        if (isDirectBooleanReturn && !isElseIfNode) {
                            skippedNodeRanges.push(nodeRange);
                            return;
                        }
                        if (isElseIfNode && !isDirectBooleanReturn) {
                            return;
                        }
                    }

                    if (node.type === "IfStatement" && !evaluateCanIfStatementBenefitFromNormalization(node)) {
                        return;
                    }

                    if (node.type === "UnaryExpression" && !evaluateCanUnaryExpressionBenefitFromNormalization(node)) {
                        return;
                    }

                    if (
                        (node.type === "LogicalExpression" || node.type === "BinaryExpression") &&
                        !evaluateCanLogicalExpressionBenefitFromNormalization(node)
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

                    const printedText = gmlRuleAutofixServices.printNodeForAutofix(
                        normalizationResult.ast,
                        fullSourceText
                    );
                    const newText = isElseIfNode && isDirectBooleanReturn ? `{ ${printedText} }` : printedText;

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
