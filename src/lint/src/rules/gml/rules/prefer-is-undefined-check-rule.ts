import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { type AstNodeRecord, createMeta, getNodeRange, isAstNodeRecord } from "../rule-base-helpers.js";

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
 * Three AST shapes all surface the same logical comparison:
 *   - A direct `BinaryExpression` (the `BinaryExpression` visitor)
 *   - A `UnaryExpression(!)` whose argument is a `BinaryExpression` (the
 *     `UnaryExpression` visitor)
 *   - A `CallExpression` whose callee is the `!` identifier and whose sole
 *     argument is a `BinaryExpression` (the `CallExpression` visitor) — the
 *     GML grammar parses a `!` immediately followed by `(` as a call rather
 *     than a unary expression (see `isLogicalNotCallExpression`), so this
 *     shape is how `!(value == undefined)` actually arrives from the parser.
 * The visitor that observed the node also dictates which range should be
 * overwritten — the binary node itself for the first shape, the entire
 * wrapper node for the other two. The detected outer negation is exposed
 * uniformly as `isExternallyNegated` so all three visitors can share the
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

/**
 * Detects the GML parser's call-shaped rendering of `!(...)`. The grammar
 * treats a `!` immediately followed by `(` as a call expression whose callee
 * is the `!` identifier rather than as a `UnaryExpression`, so this is the
 * structural (whitespace-agnostic) equivalent of `UnaryExpression(!)` for
 * that source shape. `logical-expression-traversal-normalization.ts` relies
 * on the same parser quirk when it canonicalizes `!(...)` back into a real
 * `UnaryExpression`.
 */
function isLogicalNotCallExpression(
    node: AstNodeRecord
): node is AstNodeRecord & { type: "CallExpression"; arguments: [unknown] } {
    if (node.type !== "CallExpression" || !Array.isArray(node.arguments) || node.arguments.length !== 1) {
        return false;
    }

    const callee = node.callee ?? node.object;
    return isAstNodeRecord(callee) && callee.type === "Identifier" && callee.name === "!";
}

/** Structural negation wrapper: either a real `!` unary node or its call-shaped equivalent. */
function isNegationWrapperNode(node: unknown): node is AstNodeRecord & { type: "UnaryExpression" | "CallExpression" } {
    if (!isAstNodeRecord(node)) {
        return false;
    }

    return (node.type === "UnaryExpression" && node.operator === "!") || isLogicalNotCallExpression(node);
}

function getNegationArgument(node: AstNodeRecord & { type: "UnaryExpression" | "CallExpression" }): unknown {
    return node.type === "UnaryExpression" ? node.argument : (node.arguments as [unknown])[0];
}

/**
 * Determines whether `node` is the immediate (parenthesis-unwrapped) operand
 * of an ancestor negation wrapper. When it is, the wrapper's own visit
 * already resolves and reports the combined rewrite, so the plain
 * `BinaryExpression` visit should defer rather than reporting the inner
 * range on its own.
 */
function isDirectOperandOfNegationWrapper(node: AstNodeRecord): boolean {
    let current = (node as { parent?: unknown }).parent;
    while (isAstNodeRecord(current) && current.type === "ParenthesizedExpression") {
        current = (current as { parent?: unknown }).parent;
    }

    return isNegationWrapperNode(current);
}

function resolveUndefinedComparisonTarget(node: unknown): UndefinedComparisonTarget | null {
    if (!isAstNodeRecord(node)) {
        return null;
    }

    if (isNegationWrapperNode(node)) {
        const inner = unwrapParenthesizedExpression(getNegationArgument(node));
        if (!isUndefinedComparisonBinary(inner)) {
            return null;
        }

        const range = getNodeRange(node);
        if (!range) {
            return null;
        }

        return {
            binary: inner,
            isExternallyNegated: true,
            outerRange: [range.start, range.end]
        };
    }

    if (!isUndefinedComparisonBinary(node) || isDirectOperandOfNegationWrapper(node)) {
        return null;
    }

    const range = getNodeRange(node);
    if (!range) {
        return null;
    }

    return {
        binary: node,
        isExternallyNegated: false,
        outerRange: [range.start, range.end]
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
    const target = resolveUndefinedComparisonTarget(node);
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

            // The `BinaryExpression`, `UnaryExpression`, and `CallExpression`
            // visitors share an identical body: resolve the rewrite via the
            // shared helper and, when it succeeds, report a single diagnostic
            // with the matching autofix. Extracting that body into one closure
            // lets the rule's visitor declaration read as a flat mapping and
            // guarantees the entry points stay in lock-step if the rewrite
            // shape ever grows. `CallExpression` is required alongside
            // `UnaryExpression` because the GML grammar parses `!(...)` as a
            // call to the `!` identifier rather than as a unary expression
            // (see `isLogicalNotCallExpression`).
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
                UnaryExpression: reportUndefinedCheckRewrite,
                CallExpression: reportUndefinedCheckRewrite
            });
        }
    });
}
