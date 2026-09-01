import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { type AstNodeRecord, createMeta, isAstNodeRecord } from "../rule-base-helpers.js";

const { unwrapParenthesizedExpression } = Core;

/**
 * Resolved rewrite that replaces a `value (==|!=) undefined` comparison with
 * the equivalent `is_undefined(value)` (or its negation). `range` is the source
 * span to overwrite — it spans the inner binary comparison when the caller is
 * the `BinaryExpression` visitor, and the surrounding `UnaryExpression` when
 * the caller is the `UnaryExpression` visitor.
 */
type UndefinedCheckRewrite = Readonly<{
    range: readonly [number, number];
    replacement: string;
}>;

/**
 * Detected `value (==|!=) undefined` comparison, normalised so the
 * `is_undefined(...)` rewrite can be built once and reused by every visitor.
 *
 * Two AST shapes both surface the same logical comparison:
 *   - A direct `BinaryExpression` (the `BinaryExpression` visitor)
 *   - A `UnaryExpression(!)` whose argument is a `BinaryExpression` (the
 *     `UnaryExpression` visitor)
 * The visitor that observed the node also dictates which range should be
 * overwritten — the binary node itself for the first shape, the entire
 * unary node for the second. The detected outer negation is exposed
 * uniformly as `isExternallyNegated` so both visitors can share the
 * replacement-text builder.
 */
type UndefinedComparisonTarget = Readonly<{
    binary: AstNodeRecord;
    isExternallyNegated: boolean;
    outerRange: readonly [number, number];
}>;

function isUndefinedIdentifier(expression: unknown): boolean {
    if (!isAstNodeRecord(expression)) {
        return false;
    }

    if (expression.type === "Identifier") {
        return typeof expression.name === "string" && expression.name.toLowerCase() === "undefined";
    }

    if (expression.type === "Literal" && typeof expression.value === "string") {
        return expression.value.toLowerCase() === "undefined";
    }

    return false;
}

function isUndefinedComparisonBinary(node: unknown): node is AstNodeRecord & {
    type: "BinaryExpression";
    operator: "==" | "!=";
} {
    if (!isAstNodeRecord(node) || node.type !== "BinaryExpression") {
        return false;
    }

    if (node.operator !== "==" && node.operator !== "!=") {
        return false;
    }

    return isUndefinedIdentifier(node.left) || isUndefinedIdentifier(node.right);
}

function resolveImmediateNegatedWrapperRange(sourceText: string, start: number, end: number): [number, number] | null {
    const wrapperStart = start - 2;
    if (wrapperStart < 0 || end >= sourceText.length) {
        return null;
    }

    return sourceText.slice(wrapperStart, start) === "!(" && sourceText[end] === ")" ? [wrapperStart, end + 1] : null;
}

function resolveUndefinedComparisonTarget(node: unknown, sourceText: string): UndefinedComparisonTarget | null {
    if (!isAstNodeRecord(node)) {
        return null;
    }

    if (node.type === "UnaryExpression" && node.operator === "!") {
        const inner = unwrapParenthesizedExpression(node.argument);
        if (!isUndefinedComparisonBinary(inner)) {
            return null;
        }

        const start = Core.getNodeStartIndex(node);
        const end = Core.getNodeEndIndex(node);
        if (typeof start !== "number" || typeof end !== "number") {
            return null;
        }

        return {
            binary: inner,
            isExternallyNegated: true,
            outerRange: [start, end]
        };
    }

    if (!isUndefinedComparisonBinary(node)) {
        return null;
    }

    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }

    const wrapperRange = resolveImmediateNegatedWrapperRange(sourceText, start, end);
    return {
        binary: node,
        isExternallyNegated: wrapperRange !== null,
        outerRange: wrapperRange ?? [start, end]
    };
}

/**
 * Resolves the rewrite that replaces `value (==|!=) undefined` with an
 * `is_undefined(value)` call. The base comparison `value == undefined` is
 * positive (`is_undefined(value)`); the `!=` variant or an outer `!(...)`
 * wrapper flips the polarity.
 *
 * Returns `null` when `node` does not match the pattern, so callers can use
 * the result directly as a "report-or-skip" gate.
 */
export function tryResolveUndefinedCheckRewrite(node: unknown, sourceText: string): UndefinedCheckRewrite | null {
    const target = resolveUndefinedComparisonTarget(node, sourceText);
    if (!target) {
        return null;
    }

    const otherSide = isUndefinedIdentifier(target.binary.left) ? target.binary.right : target.binary.left;
    const otherStart = Core.getNodeStartIndex(otherSide);
    const otherEnd = Core.getNodeEndIndex(otherSide);
    if (typeof otherStart !== "number" || typeof otherEnd !== "number") {
        return null;
    }

    const otherText = sourceText.slice(otherStart, otherEnd);
    const isPositiveComparison = target.binary.operator === "==";
    // The base comparison `value == undefined` reads as "is this undefined?",
    // so it maps to the positive `is_undefined(value)` form. Either an
    // operator flip (`!=`) or an outer `!(...)` wrapper negates the sense of
    // the question, so we emit `!is_undefined(value)` when exactly one of
    // those two conditions holds.
    const shouldWritePositiveForm = isPositiveComparison !== target.isExternallyNegated;
    const replacement = shouldWritePositiveForm ? `is_undefined(${otherText})` : `!is_undefined(${otherText})`;

    return Object.freeze({
        range: target.outerRange,
        replacement
    });
}

export function createPreferIsUndefinedCheckRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const sourceText = context.sourceCode.text;

            // The `BinaryExpression` and `UnaryExpression` visitors share an
            // identical body: resolve the rewrite via the shared helper and,
            // when it succeeds, report a single diagnostic with the matching
            // autofix. Extracting that body into one closure lets the rule's
            // visitor declaration read as a flat mapping (`{ BinaryExpression:
            // fn, UnaryExpression: fn }`) and guarantees the two entry points
            // stay in lock-step if the rewrite shape ever grows.
            const reportUndefinedCheckRewrite = (node: unknown): void => {
                const rewrite = tryResolveUndefinedCheckRewrite(node, sourceText);
                if (!rewrite) {
                    return;
                }

                context.report({
                    node: node as Rule.Node,
                    messageId: definition.messageId,
                    fix: (fixer) => fixer.replaceTextRange(rewrite.range, rewrite.replacement)
                });
            };

            return Object.freeze({
                BinaryExpression: reportUndefinedCheckRewrite,
                UnaryExpression: reportUndefinedCheckRewrite
            });
        }
    });
}
