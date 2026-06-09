import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";
import { applyLogicalNormalizationWithChangeMetadata } from "../transforms/logical-expression-traversal-normalization.js";
import { optimizeLogicalFlowPolicy } from "./optimize-logical-flow-policy.js";

/**
 * Normalize whitespace for structural expression comparisons.
 */
function normalizeWhitespaceForComparison(value: string): string {
    return value.replaceAll(/\s+/g, " ");
}

type SourceTextRange = Readonly<{ start: number; end: number }>;

const {
    evaluateHasLogicalNormalizationSignal,
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateCanIfStatementBenefitFromNormalization,
    evaluateCanUnaryExpressionBenefitFromNormalization,
    evaluateCanLogicalExpressionBenefitFromNormalization,
    evaluateUnsafeCommentSyntax
} = optimizeLogicalFlowPolicy;

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
                    if (Core.hasComment(node) || evaluateUnsafeCommentSyntax(sourceText)) {
                        return;
                    }

                    if (
                        node.type === "IfStatement" &&
                        (evaluateIsIfNodeInElseIfChain(node) ||
                            evaluateIsElsePrefixedIfAtIndex(fullSourceText, nodeRange.start))
                    ) {
                        return;
                    }

                    if (
                        (node.type === "BlockStatement" ||
                            node.type === "LogicalExpression" ||
                            node.type === "BinaryExpression" ||
                            node.type === "UnaryExpression") &&
                        !evaluateHasLogicalNormalizationSignal(sourceText)
                    ) {
                        return;
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
