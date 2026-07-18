import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";
import {
    applyLogicalNormalizationWithChangeMetadata,
    type LogicalNormalizationKind
} from "../transforms/logical-expression-traversal-normalization.js";
import {
    evaluateIsElsePrefixedIfAtIndex,
    evaluateIsIfNodeInElseIfChain,
    evaluateUnsafeCommentSyntax
} from "./logical-normalization-rule-policy.js";

type SourceTextRange = Readonly<{ start: number; end: number }>;

function readNodeRange(node: unknown): SourceTextRange | null {
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
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

function isInsideRange(range: SourceTextRange, ranges: ReadonlyArray<SourceTextRange>): boolean {
    return ranges.some((existing) => range.start >= existing.start && range.end <= existing.end);
}

/**
 * Creates one lint rule for one logical normalization operation.
 *
 * The shared implementation owns only safe range handling, cloning, printing,
 * and comment preservation. The supplied normalization kind is the rule's
 * complete semantic scope.
 */
export function createLogicalNormalizationRule(
    definition: GmlRuleDefinition,
    kind: Exclude<LogicalNormalizationKind, "all" | "logical-not-call">
): Rule.RuleModule {
    const selector =
        kind === "conditional-assignment"
            ? "IfStatement"
            : kind === "de-morgan" || kind === "negation-parentheses"
              ? "LogicalExpression, BinaryExpression, UnaryExpression[operator='!'], CallExpression"
              : "LogicalExpression, BinaryExpression, UnaryExpression[operator='!']";

    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const rewrittenRanges: SourceTextRange[] = [];

            return Object.freeze({
                [selector](node: unknown) {
                    const range = readNodeRange(node);
                    if (!range || isInsideRange(range, rewrittenRanges)) {
                        return;
                    }

                    const sourceText = context.sourceCode.text;
                    const candidateText = sourceText.slice(range.start, range.end);
                    if (Core.hasComment(node) || evaluateUnsafeCommentSyntax(candidateText)) {
                        return;
                    }

                    if (
                        kind === "conditional-assignment" &&
                        (evaluateIsIfNodeInElseIfChain(node) ||
                            evaluateIsElsePrefixedIfAtIndex(sourceText, range.start))
                    ) {
                        return;
                    }

                    const cloned = Core.cloneAstNode(node) as MutableGameMakerAstNode;
                    if (!cloned) {
                        return;
                    }

                    const result = applyLogicalNormalizationWithChangeMetadata(cloned, undefined, kind);
                    if (!result.changed) {
                        return;
                    }

                    const replacementText = gmlRuleAutofixServices.printNodeForAutofix(result.ast, sourceText);
                    if (candidateText.replaceAll(/\s+/gu, " ") === replacementText.replaceAll(/\s+/gu, " ")) {
                        return;
                    }

                    rewrittenRanges.push(range);
                    context.report({
                        loc: resolveLocFromIndex(context, sourceText, range.start),
                        messageId: definition.messageId,
                        fix(fixer) {
                            return fixer.replaceTextRange([range.start, range.end], replacementText);
                        }
                    });
                }
            });
        }
    });
}
