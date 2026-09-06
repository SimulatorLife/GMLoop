import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import {
    type AstNodeRecord,
    type AstNodeWithType,
    type CommentTokenRangeIndex,
    createCommentTokenRangeIndex,
    createMeta,
    getLineIndentationAtOffset,
    isAstNodeRecord,
    isAstNodeWithType,
    rangeContainsCommentToken,
    readObjectOption,
    unwrapParenthesizedExpression,
    walkAstNodes,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";
import {
    collectLoopMutationSummary,
    evaluateChoosePreferredHoistName,
    evaluateExpressionHoistability,
    evaluateIsDisallowedContextForReplacement,
    evaluateShouldSkipGeneratedHoistInitializer,
    evaluateSourceSegmentContainsCompoundAssignment,
    type ExpressionAssessment,
    type LoopMutationSummary,
    normalizeIdentifierName
} from "./prefer-loop-invariant-expressions-rule-policy.js";

const { getNodeStartIndex, getNodeEndIndex } = Core;

type LoopNode = AstNodeWithType &
    Readonly<{
        type: "ForStatement" | "WhileStatement" | "RepeatStatement" | "DoUntilStatement";
        body: unknown;
    }>;

function isLoopNode(node: unknown): node is LoopNode {
    return Core.isLoopLikeNode(node);
}

type LoopContainerContext = Readonly<{
    loopNode: LoopNode;
}>;

type LoopCandidate = Readonly<{
    expressionNode: AstNodeWithType;
    expressionStart: number;
    expressionEnd: number;
    preferredHoistName: string;
    score: number;
}>;

type LoopCandidateAnalysis = Readonly<{
    bestCandidate: LoopCandidate | null;
    replacementCandidates: ReadonlyArray<LoopCandidate>;
}>;

type ParentVisitContext = Readonly<{
    node: AstNodeWithType;
    parent: AstNodeWithType | null;
    parentKey: string | null;
}>;

type LoopReplacementTarget = Readonly<{
    expressionStart: number;
    expressionEnd: number;
}>;

function readIdentifierName(node: unknown): string | null {
    const unwrapped = unwrapParenthesizedExpression(node);
    if (!isAstNodeRecord(unwrapped) || unwrapped.type !== "Identifier") {
        return null;
    }
    return typeof unwrapped.name === "string" ? unwrapped.name : null;
}

function collectLoopContainerContexts(programNode: unknown): ReadonlyArray<LoopContainerContext> {
    const contexts: Array<LoopContainerContext> = [];

    walkAstNodesWithParent(programNode, (visitContext) => {
        const { node, parent, parentKey, parentIndex } = visitContext;
        if (!isLoopNode(node)) {
            return;
        }

        if (parent === null || parentKey !== "body" || typeof parentIndex !== "number") {
            return;
        }

        if (parent.type !== "Program" && parent.type !== "BlockStatement") {
            return;
        }

        contexts.push(
            Object.freeze({
                loopNode: node
            })
        );
    });

    return contexts;
}

function collectIdentifierNamesInProgram(programNode: unknown): ReadonlySet<string> {
    const names = new Set<string>();

    walkAstNodes(programNode, (node) => {
        const identifierName = readIdentifierName(node);
        if (identifierName) {
            names.add(identifierName);
        }
    });

    return names;
}

function collectNormalizedIdentifierNames(identifierNames: ReadonlySet<string>): Set<string> {
    const normalizedNames = new Set<string>();
    for (const identifierName of identifierNames) {
        normalizedNames.add(normalizeIdentifierName(identifierName));
    }

    return normalizedNames;
}

function loopControlSourceContainsCompoundAssignment(loopNode: LoopNode, sourceText: string): boolean {
    const loopStart = getNodeStartIndex(loopNode);
    const loopEnd = getNodeEndIndex(loopNode);
    const bodyStart = getNodeStartIndex(loopNode.body);
    const bodyEnd = getNodeEndIndex(loopNode.body);
    if (
        typeof loopStart !== "number" ||
        typeof loopEnd !== "number" ||
        typeof bodyStart !== "number" ||
        typeof bodyEnd !== "number"
    ) {
        return true;
    }

    return (
        evaluateSourceSegmentContainsCompoundAssignment(sourceText.slice(loopStart, bodyStart)) ||
        evaluateSourceSegmentContainsCompoundAssignment(sourceText.slice(bodyEnd, loopEnd))
    );
}

function collectLoopCandidateAnalysis(parameters: {
    commentTokenRangeIndex: CommentTokenRangeIndex;
    loopContext: LoopContainerContext;
    mutationSummary: LoopMutationSummary;
    assessmentCache: WeakMap<AstNodeRecord, ExpressionAssessment | null>;
    minComplexity: number;
}): LoopCandidateAnalysis {
    let bestCandidate: LoopCandidate | null = null;
    const replacementCandidates: LoopCandidate[] = [];
    const rootNode = parameters.loopContext.loopNode.body;
    if (!isAstNodeWithType(rootNode)) {
        return Object.freeze({
            bestCandidate,
            replacementCandidates: Object.freeze(replacementCandidates),
            minComplexity: parameters.minComplexity
        });
    }

    const stack: ParentVisitContext[] = [{ node: rootNode, parent: null, parentKey: null }];
    const seen = new WeakSet<object>();

    while (stack.length > 0) {
        const visitContext = stack.pop();
        if (!visitContext) {
            continue;
        }

        const { node, parent, parentKey } = visitContext;
        const nodeObject = node as object;
        if (seen.has(nodeObject)) {
            continue;
        }

        seen.add(nodeObject);

        if (node.type === "ParenthesizedExpression") {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (evaluateIsDisallowedContextForReplacement(parent, parentKey)) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (evaluateShouldSkipGeneratedHoistInitializer(parent, parentKey)) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const expressionStart = getNodeStartIndex(node);
        const expressionEnd = getNodeEndIndex(node);
        if (
            typeof expressionStart !== "number" ||
            typeof expressionEnd !== "number" ||
            expressionEnd <= expressionStart
        ) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const assessment = evaluateExpressionHoistability(node, parameters.mutationSummary, parameters.assessmentCache);
        if (!assessment) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const effectiveMinComplexity =
            node.type === "TemplateStringExpression" ? Math.min(parameters.minComplexity, 2) : parameters.minComplexity;
        if (assessment.complexity < effectiveMinComplexity) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (parameters.mutationSummary.hasImpureCall && assessment.readsMemberAccess) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        if (rangeContainsCommentToken(parameters.commentTokenRangeIndex, expressionStart, expressionEnd)) {
            pushChildNodesForLoopCandidateTraversal(stack, node);
            continue;
        }

        const preferredHoistName = evaluateChoosePreferredHoistName(parent, parentKey, node);
        const score = assessment.complexity * 1000 + (expressionEnd - expressionStart);
        const candidate: LoopCandidate = {
            expressionNode: node,
            expressionStart,
            expressionEnd,
            preferredHoistName,
            score
        };

        replacementCandidates.push(candidate);

        if (
            bestCandidate === null ||
            candidate.score > bestCandidate.score ||
            (candidate.score === bestCandidate.score && candidate.expressionStart < bestCandidate.expressionStart)
        ) {
            bestCandidate = candidate;
        }
    }

    return Object.freeze({
        bestCandidate,
        replacementCandidates: Object.freeze(replacementCandidates),
        minComplexity: parameters.minComplexity
    });
}

function pushChildNodesForLoopCandidateTraversal(stack: ParentVisitContext[], node: AstNodeWithType): void {
    if (
        isLoopNode(node) ||
        Core.isFunctionLikeNode(node) ||
        node.type === "WithStatement" ||
        node.type === "TryStatement"
    ) {
        return;
    }

    for (const key of Object.keys(node)) {
        if (key === "parent") {
            continue;
        }

        const value = node[key];
        if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index -= 1) {
                const child = value[index];
                if (!isAstNodeWithType(child)) {
                    continue;
                }

                stack.push({
                    node: child,
                    parent: node,
                    parentKey: key
                });
            }

            continue;
        }

        if (!isAstNodeWithType(value)) {
            continue;
        }

        stack.push({
            node: value,
            parent: node,
            parentKey: key
        });
    }
}

function collectEquivalentLoopReplacementTargets(
    replacementCandidates: ReadonlyArray<LoopCandidate>,
    targetExpressionNode: AstNodeWithType,
    sourceText: string
): ReadonlyArray<LoopReplacementTarget> {
    const replacementTargets: LoopReplacementTarget[] = [];
    const targetStart = getNodeStartIndex(targetExpressionNode);
    const targetEnd = getNodeEndIndex(targetExpressionNode);
    const shouldUseTextGate =
        replacementCandidates.length > 100 && typeof targetStart === "number" && typeof targetEnd === "number";
    const targetLength = shouldUseTextGate ? targetEnd - targetStart : 0;
    const targetText = shouldUseTextGate ? sourceText.slice(targetStart, targetEnd) : "";

    for (const candidate of replacementCandidates) {
        if (shouldUseTextGate && candidate.expressionEnd - candidate.expressionStart !== targetLength) {
            continue;
        }

        if (shouldUseTextGate && sourceText.slice(candidate.expressionStart, candidate.expressionEnd) !== targetText) {
            continue;
        }

        if (!Core.areExpressionNodesEquivalentIgnoringParentheses(candidate.expressionNode, targetExpressionNode)) {
            continue;
        }

        replacementTargets.push(
            Object.freeze({
                expressionStart: candidate.expressionStart,
                expressionEnd: candidate.expressionEnd
            })
        );
    }

    return replacementTargets;
}

function resolveUniqueHoistIdentifierName(parameters: {
    preferredName: string;
    normalizedLocalIdentifierNames: ReadonlySet<string>;
}): string | null {
    const baseName = parameters.preferredName.length > 0 ? parameters.preferredName : "cached_value";
    for (let suffix = 0; suffix <= 1000; suffix += 1) {
        const candidateName = suffix === 0 ? baseName : `${baseName}_${suffix}`;
        if (!parameters.normalizedLocalIdentifierNames.has(normalizeIdentifierName(candidateName))) {
            return candidateName;
        }
    }

    return null;
}

/**
 * Creates the `gml/prefer-loop-invariant-expressions` rule.
 *
 * The rule hoists a single provably-safe invariant expression per loop into a
 * cached `var` declaration inserted immediately before the loop.
 *
 * Implementation note: every policy decision (pure-function catalogue,
 * mutation summary, hoistability assessment, candidate selection naming) is
 * delegated to `prefer-loop-invariant-expressions-rule-policy.ts`.  This
 * module only owns the **mechanism** — the visitor wiring, the per-loop
 * traversal, and the autofix emission that turns the chosen candidate into
 * a cached declaration.  Keeping the two layers separate means tests can
 * exercise the policy in isolation and future contributors can extend the
 * policy without touching the rule's autofix path.
 */
export function createPreferLoopInvariantExpressionsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const sourceText = context.sourceCode.text;
                    const lineEnding = Core.dominantLineEnding(sourceText);
                    const localIdentifierNames = new Set(collectIdentifierNamesInProgram(programNode));
                    const normalizedLocalIdentifierNames = collectNormalizedIdentifierNames(localIdentifierNames);
                    const loopContexts = collectLoopContainerContexts(programNode);
                    const commentTokenRangeIndex = createCommentTokenRangeIndex(sourceText);

                    const options = readObjectOption(context);
                    const minComplexityRaw = options.minComplexity;
                    const minComplexity =
                        typeof minComplexityRaw === "number" && Number.isFinite(minComplexityRaw)
                            ? Math.max(2, Math.floor(minComplexityRaw))
                            : 3;

                    for (const loopContext of loopContexts) {
                        if (loopControlSourceContainsCompoundAssignment(loopContext.loopNode, sourceText)) {
                            continue;
                        }

                        const mutationSummary = collectLoopMutationSummary(loopContext.loopNode);
                        const assessmentCache = new WeakMap<AstNodeRecord, ExpressionAssessment | null>();
                        const candidateAnalysis = collectLoopCandidateAnalysis({
                            commentTokenRangeIndex,
                            loopContext,
                            mutationSummary,
                            assessmentCache,
                            minComplexity
                        });
                        const { bestCandidate } = candidateAnalysis;
                        if (!bestCandidate) {
                            continue;
                        }

                        const hoistIdentifierName = resolveUniqueHoistIdentifierName({
                            preferredName: bestCandidate.preferredHoistName,
                            normalizedLocalIdentifierNames
                        });
                        if (!hoistIdentifierName) {
                            continue;
                        }

                        localIdentifierNames.add(hoistIdentifierName);
                        normalizedLocalIdentifierNames.add(normalizeIdentifierName(hoistIdentifierName));

                        const loopStart = getNodeStartIndex(loopContext.loopNode);
                        if (typeof loopStart !== "number") {
                            continue;
                        }

                        const indentation = getLineIndentationAtOffset(sourceText, loopStart);
                        const declarationInsertionStart = loopStart - indentation.length;
                        const expressionText = sourceText.slice(
                            bestCandidate.expressionStart,
                            bestCandidate.expressionEnd
                        );
                        const replacementTargets = collectEquivalentLoopReplacementTargets(
                            candidateAnalysis.replacementCandidates,
                            bestCandidate.expressionNode,
                            sourceText
                        );
                        const declarationText =
                            `${indentation}var ${hoistIdentifierName} = ${expressionText};` + `${lineEnding}`;

                        context.report({
                            node: bestCandidate.expressionNode,
                            messageId: definition.messageId,
                            fix: (fixer) => [
                                fixer.replaceTextRange(
                                    [declarationInsertionStart, declarationInsertionStart],
                                    declarationText
                                ),
                                ...replacementTargets.map((replacementTarget) =>
                                    fixer.replaceTextRange(
                                        [replacementTarget.expressionStart, replacementTarget.expressionEnd],
                                        hoistIdentifierName
                                    )
                                )
                            ]
                        });
                    }
                }
            });
        }
    });
}
