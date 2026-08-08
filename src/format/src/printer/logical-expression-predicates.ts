/**
 * Predicates that recognise the "logical comparison clause" pattern used by
 * the formatter's single-clause control-flow printer.
 *
 * The shape these helpers look for mirrors what GameMaker authors typically
 * write inside an `if`, `while`, or `for` test expression when they expect
 * the formatter to be able to keep the body inline: a top-level `||` whose
 * left and right operands are both `&&` expressions of the form
 * `<comparison> <op> <simple operand>`. For example:
 *
 *     if (x > 0 && y or a == 1 && ready) { ... }
 *
 * The single-clause printer uses {@link isLogicalComparisonClause} as a
 * "this clause is safe to leave in its original compound form" signal so
 * it can preserve adjacency between the closing paren and the opening
 * brace of a body written on the same line. Breaking that adjacency would
 * be a behaviour change for callers relying on the inline form, so the
 * predicate is intentionally narrow: it only matches the exact conjunction
 * shape, not arbitrary `||` / `&&` nesting. All public entry points
 * unwrap parenthesised expressions so the predicates accept the
 * parenthesised surface form found in source.
 */
import { Core } from "@gmloop/core";

/**
 * Determine whether `node` matches the "logical comparison clause" pattern:
 * a parenthesised `||` binary expression whose left and right operands are
 * both `&&` expressions of a comparison joined to a simple operand.
 *
 * Returning `true` is the signal that the single-clause printer may keep
 * the body adjacent to the closing paren on the same source line. Anything
 * that does not strictly match the conjunction shape returns `false` so
 * the printer falls back to the regular expanded layout.
 *
 * @param node - Candidate clause expression to inspect.
 * @returns `true` when `node` matches the conjunction shape.
 */
export function isLogicalComparisonClause(node: any): boolean {
    const clauseExpression = Core.unwrapParenthesizedExpression(node);
    if (clauseExpression?.type !== "BinaryExpression") {
        return false;
    }

    if (!Core.isLogicalOrOperator(clauseExpression.operator)) {
        return false;
    }

    return isComparisonAndConjunction(clauseExpression.left) && isComparisonAndConjunction(clauseExpression.right);
}

/**
 * Match a `&&` binary expression whose operands are simple logical values and
 * include at least one comparison.
 *
 * This is one half of the conjunction required by
 * {@link isLogicalComparisonClause}; accepting either operand order keeps the
 * predicate aligned with the commutative shape of a logical conjunction while
 * still excluding nested `&&`/`||` expressions from this leaf check.
 *
 * @param node - Candidate conjunction operand to inspect.
 * @returns `true` when `node` contains a comparison and simple operands.
 */
function isComparisonAndConjunction(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (expression?.type !== "BinaryExpression") {
        return false;
    }

    if (!Core.isLogicalAndOperator(expression.operator)) {
        return false;
    }

    const hasComparisonOperand = isComparisonExpression(expression.left) || isComparisonExpression(expression.right);
    return hasComparisonOperand && isSimpleLogicalOperand(expression.left) && isSimpleLogicalOperand(expression.right);
}

/**
 * Match a `BinaryExpression` whose operator is a GML comparison
 * (`==`, `!=`, `<>`, `<`, `<=`, `>`, `>=`).
 *
 * Used as the left-hand shape of a conjunction in
 * {@link isComparisonAndConjunction} and as a fallback leaf in
 * {@link isSimpleLogicalOperand} so nested comparison expressions also
 * count as "simple" operands.
 *
 * @param node - Candidate expression to inspect.
 * @returns `true` when `node` is a comparison expression.
 */
function isComparisonExpression(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    return expression?.type === "BinaryExpression" && Core.isComparisonBinaryOperator(expression.operator);
}

/**
 * Match a "simple" logical operand: an identifier, a literal, a unary
 * expression over a simple operand, or a nested comparison expression.
 *
 * The recursion into `UnaryExpression` keeps patterns like `!flag` or
 * `-count` eligible as the right-hand side of an `&&` conjunct. Falling
 * through to {@link isComparisonExpression} accepts nested comparisons
 * such as `(a > b)` so the conjunction shape stays tolerant of the
 * parenthesisation GameMaker authors commonly introduce for clarity.
 *
 * @param node - Candidate operand to inspect.
 * @returns `true` when `node` fits the simple-operand shape.
 */
function isSimpleLogicalOperand(node: any): boolean {
    const expression = Core.unwrapParenthesizedExpression(node);
    if (!expression) {
        return false;
    }

    if (expression.type === "Identifier") {
        return true;
    }

    if (expression.type === "Literal") {
        return true;
    }

    if (expression.type === "UnaryExpression") {
        return isSimpleLogicalOperand(expression.argument);
    }

    return isComparisonExpression(expression);
}
