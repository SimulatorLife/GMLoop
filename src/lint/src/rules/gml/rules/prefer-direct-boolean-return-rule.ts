import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";
import { applyLogicalNormalizationWithChangeMetadata } from "../transforms/logical-expression-traversal-normalization.js";
import {
    evaluateCanDirectBooleanReturnBenefitFromNormalization,
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateUnsafeCommentSyntax
} from "./optimize-logical-flow-policy.js";

type SourceTextRange = Readonly<{ start: number; end: number }>;
type ReturnStatementNode = Readonly<{ type: "ReturnStatement"; argument: unknown }> & Record<string, unknown>;
type IfStatementNode = Readonly<{
    type: "IfStatement";
    test: unknown;
    consequent: unknown;
    alternate?: unknown;
    parent?: unknown;
}>;

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

    return Object.freeze({ start: nodeStart, end: nodeEnd });
}

function unwrapSingleReturnStatement(statement: unknown): ReturnStatementNode | null {
    const unwrappedStatement = Core.unwrapParenthesizedExpression(statement);
    if (!unwrappedStatement || typeof unwrappedStatement !== "object") {
        return null;
    }

    if ((unwrappedStatement as { type?: string }).type === "ReturnStatement") {
        const argument = (unwrappedStatement as { argument?: unknown }).argument;
        return argument === undefined ? null : (unwrappedStatement as ReturnStatementNode);
    }

    if ((unwrappedStatement as { type?: string }).type !== "BlockStatement") {
        return null;
    }

    const body = (unwrappedStatement as { body?: unknown[] }).body;
    if (!Array.isArray(body) || body.length !== 1) {
        return null;
    }

    return unwrapSingleReturnStatement(body[0]);
}

function readParentBody(node: IfStatementNode): ReadonlyArray<unknown> | null {
    const parent = Core.unwrapParenthesizedExpression(node.parent);
    if (!parent || typeof parent !== "object") {
        return null;
    }

    const body = (parent as { body?: unknown }).body;
    return Array.isArray(body) ? body : null;
}

function readFollowingStatement(node: IfStatementNode): unknown {
    const parentBody = readParentBody(node);
    if (!parentBody) {
        return null;
    }

    const index = parentBody.indexOf(node);
    if (index === -1 || index + 1 >= parentBody.length) {
        return null;
    }

    return parentBody[index + 1];
}

function includeTrailingSemicolon(fullSourceText: string, end: number): number {
    return fullSourceText[end] === ";" ? end + 1 : end;
}

function readReplacementRange(
    node: IfStatementNode,
    trailingReturn: ReturnStatementNode | null,
    fullSourceText: string
): SourceTextRange | null {
    const start = Core.getNodeStartIndex(node);
    const rawEnd = trailingReturn ? Core.getNodeEndIndex(trailingReturn) : Core.getNodeEndIndex(node);
    const end = typeof rawEnd === "number" ? includeTrailingSemicolon(fullSourceText, rawEnd) : rawEnd;
    if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        end <= start
    ) {
        return null;
    }

    return Object.freeze({ start, end });
}

function shouldNegateReturnArgument(consequentArgument: unknown, alternateArgument: unknown): boolean | null {
    const consequentValue = Core.getBooleanLiteralValue(consequentArgument, { acceptBooleanPrimitives: true });
    const alternateValue = Core.getBooleanLiteralValue(alternateArgument, { acceptBooleanPrimitives: true });
    if (consequentValue === "true" && alternateValue === "false") {
        return false;
    }
    if (consequentValue === "false" && alternateValue === "true") {
        return true;
    }
    return null;
}

function createReturnArgument(test: unknown, shouldNegate: boolean): MutableGameMakerAstNode {
    const clonedTest = Core.cloneAstNode(test) as MutableGameMakerAstNode;
    if (!shouldNegate) {
        return clonedTest;
    }

    const negatedArgument: MutableGameMakerAstNode = {
        type: "UnaryExpression",
        operator: "!",
        prefix: true,
        argument: clonedTest
    };
    return negatedArgument;
}

function createReturnStatementText(test: unknown, shouldNegate: boolean, fullSourceText: string): string {
    const returnStatement = {
        type: "ReturnStatement",
        argument: createReturnArgument(test, shouldNegate)
    } as MutableGameMakerAstNode;
    const normalizationResult = applyLogicalNormalizationWithChangeMetadata(returnStatement);
    return gmlRuleAutofixServices.printNodeForAutofix(normalizationResult.ast, fullSourceText);
}

function hasUnsafeSourceComments(fullSourceText: string, range: SourceTextRange): boolean {
    return evaluateUnsafeCommentSyntax(fullSourceText.slice(range.start, range.end));
}

/**
 * Creates the `gml/prefer-direct-boolean-return` rule.
 */
export function createPreferDirectBooleanReturnRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                IfStatement(node: unknown) {
                    if (!node || typeof node !== "object" || (node as { type?: string }).type !== "IfStatement") {
                        return;
                    }

                    const ifNode = node as IfStatementNode;
                    const nodeRange = getNodeRange(ifNode);
                    if (!nodeRange) {
                        return;
                    }

                    const fullSourceText = context.sourceCode.text;
                    if (
                        Core.hasComment(ifNode) ||
                        hasUnsafeSourceComments(fullSourceText, nodeRange) ||
                        evaluateIsIfNodeInElseIfChain(ifNode) ||
                        evaluateIsElsePrefixedIfAtIndex(fullSourceText, nodeRange.start)
                    ) {
                        return;
                    }

                    const consequentReturn = unwrapSingleReturnStatement(ifNode.consequent);
                    if (!consequentReturn || Core.hasComment(consequentReturn.argument)) {
                        return;
                    }

                    const followingStatement = readFollowingStatement(ifNode);
                    const alternateReturn = ifNode.alternate
                        ? unwrapSingleReturnStatement(ifNode.alternate)
                        : unwrapSingleReturnStatement(followingStatement);
                    if (!alternateReturn || Core.hasComment(alternateReturn.argument)) {
                        return;
                    }

                    if (
                        !evaluateCanDirectBooleanReturnBenefitFromNormalization(
                            ifNode,
                            ifNode.alternate ? null : followingStatement
                        )
                    ) {
                        return;
                    }

                    const shouldNegate = shouldNegateReturnArgument(
                        consequentReturn.argument,
                        alternateReturn.argument
                    );
                    if (shouldNegate === null) {
                        return;
                    }

                    const trailingReturn = ifNode.alternate ? null : alternateReturn;
                    const replacementRange = readReplacementRange(ifNode, trailingReturn, fullSourceText);
                    if (!replacementRange) {
                        return;
                    }

                    if (hasUnsafeSourceComments(fullSourceText, replacementRange)) {
                        return;
                    }

                    const replacementText = createReturnStatementText(ifNode.test, shouldNegate, fullSourceText);
                    const sourceText = fullSourceText.slice(replacementRange.start, replacementRange.end);
                    if (sourceText === replacementText) {
                        return;
                    }

                    context.report({
                        loc: resolveLocFromIndex(context, fullSourceText, replacementRange.start),
                        messageId: definition.messageId,
                        fix(fixer) {
                            return fixer.replaceTextRange(
                                [replacementRange.start, replacementRange.end],
                                replacementText
                            );
                        }
                    });
                }
            });
        }
    });
}
