/**
 * Metadata describing a binary operator's precedence and associativity.
 *
 * The precedence value determines the order in which operators are evaluated
 * when multiple operators appear in an expression without explicit parentheses.
 * Higher values bind more tightly.
 *
 * Associativity controls how operators of the same precedence are grouped:
 * - "left": `a op b op c` parses as `(a op b) op c`
 * - "right": `a op b op c` parses as `a op (b op c)`
 */
type BinaryOperatorMeta = {
    prec: number;
    assoc: "left" | "right";
};

type BinaryDelegateConfig = {
    operators: Record<string, BinaryOperatorMeta>;
};

/**
 * Handles binary expression parsing while respecting operator precedence and
 * associativity rules. Ensures the AST correctly represents the intended
 * evaluation order without requiring explicit parentheses in the source.
 *
 * During parsing, the delegate inspects nested binary expressions and inserts
 * synthetic ParenthesizedExpression nodes when precedence or associativity
 * would otherwise produce incorrect grouping. This keeps the AST structurally
 * accurate for downstream consumers like the printer and transpiler.
 */
export default class BinaryExpressionDelegate {
    private readonly operators: Record<string, BinaryOperatorMeta>;

    constructor({ operators }: BinaryDelegateConfig) {
        this.operators = operators ?? {};
    }

    /**
     * Process a binary expression parse context, recursively visiting operands
     * and wrapping the result in synthetic parentheses when precedence rules
     * require explicit grouping.
     *
     * @param ctx ANTLR parse context representing the binary expression rule.
     * @param visit Function to recursively visit child parse contexts.
     * @param astNode Factory for constructing AST nodes with location metadata.
     * @param isEmbeddedExpression Whether this expression is nested within another
     *        binary expression. When `true`, the delegate checks precedence and may
     *        insert synthetic parentheses to preserve evaluation order.
     * @returns The constructed BinaryExpression AST node, optionally wrapped in a
     *          ParenthesizedExpression if precedence rules require it.
     */
    handle(ctx, { visit, astNode }, isEmbeddedExpression = false) {
        if (!ctx || !Object.hasOwn(ctx, "expression")) {
            return visit(ctx);
        }

        const childExpressions = ctx.expression();

        if (!childExpressions || childExpressions.length > 2) {
            return visit(ctx);
        }

        let leftNode;
        let rightNode;

        if (childExpressions.length === 1) {
            leftNode = visit(childExpressions[0]);
        } else {
            const [leftCtx, rightCtx] = childExpressions;
            const leftIsBinary = Object.hasOwn(leftCtx, "expression") && typeof leftCtx.expression === "function";
            const rightIsBinary = Object.hasOwn(rightCtx, "expression") && typeof rightCtx.expression === "function";
            const leftShouldRecurse = leftIsBinary && leftCtx !== ctx;
            const rightShouldRecurse = rightIsBinary && rightCtx !== ctx;

            leftNode = leftShouldRecurse ? this.handle(leftCtx, { visit, astNode }, true) : visit(leftCtx);

            rightNode = rightShouldRecurse ? this.handle(rightCtx, { visit, astNode }, true) : visit(rightCtx);
        }

        if (!ctx.children || ctx.children.length < 2 || !ctx.children[1]) {
            return visit(ctx);
        }

        const operatorToken = ctx.children[1];
        if (typeof operatorToken.getText !== "function") {
            return visit(ctx);
        }

        const operator = operatorToken.getText();

        // In GML, the single-equals token can represent assignment semantics.
        // Parsing it as a BinaryExpression would incorrectly treat chained
        // assignments as boolean comparisons. Represent `=` and `:=` as
        // AssignmentExpression nodes to preserve the intent of nested assignment
        // chains (e.g. `a = b = c`).
        const isAssignmentOperator = operator === "=" || operator === ":=";
        const isAssignmentNode = isAssignmentOperator;

        let node = astNode(ctx, {
            type: isAssignmentNode ? "AssignmentExpression" : "BinaryExpression",
            operator,
            left: leftNode,
            right: rightNode
        });

        if (isEmbeddedExpression && this.needsParentheses(operator, leftNode, rightNode)) {
            node = this.wrapInParentheses(ctx, node, astNode);
        }

        return node;
    }

    /**
     * Determine whether a binary expression requires explicit parentheses based
     * on operator precedence and associativity.
     *
     * This check ensures the AST preserves the correct evaluation order when
     * nested binary expressions have different precedence levels or conflicting
     * associativity. Without synthetic parentheses, the printer would emit code
     * that the parser might interpret differently.
     *
     * For left-associative operators (e.g., `+`, `-`), parentheses are needed
     * when either operand has lower precedence than the current operator.
     *
     * For right-associative operators (e.g., `**`), the check is stricter:
     * parentheses are required when operands have lower *or equal* precedence to
     * preserve the intended grouping.
     *
     * @param operator The binary operator in the current expression.
     * @param leftNode The left operand AST node.
     * @param rightNode The right operand AST node.
     * @returns `true` when parentheses are required to preserve evaluation order.
     */
    needsParentheses(operator, leftNode, rightNode) {
        if (!operator || !leftNode || !rightNode) {
            return false;
        }

        const leftOp = this.resolveOperatorMeta(leftNode);
        const rightOp = this.resolveOperatorMeta(rightNode);
        const currOp = this.operators[operator];
        if (!currOp) {
            return false;
        }

        if (currOp.assoc === "left") {
            return leftOp.prec < currOp.prec || rightOp.prec < currOp.prec;
        }

        // For right-associative operators, parentheses are required when
        // operands have lower or equal precedence to preserve right-to-left
        // evaluation order.
        return leftOp.prec <= currOp.prec || rightOp.prec <= currOp.prec;
    }

    /**
     * Wrap the provided AST node in a synthetic ParenthesizedExpression to
     * preserve evaluation order during printing.
     *
     * The synthetic flag signals to downstream consumers (printer, transpiler)
     * that these parentheses were inserted by the parser to maintain precedence
     * correctness and are not literal parentheses from the source code.
     *
     * @param ctx ANTLR parse context for location metadata.
     * @param node The AST node to wrap in parentheses.
     * @param astNode Factory for constructing AST nodes with location metadata.
     * @returns A ParenthesizedExpression node containing the original expression.
     */

    /**
     * Resolve precedence metadata for a node when it represents a binary
     * expression. Unknown operators fall back to baseline precedence so parser
     * behavior remains stable when operator tables are incomplete.
     */
    private resolveOperatorMeta(node): BinaryOperatorMeta {
        if (!node || node.type !== "BinaryExpression") {
            return { prec: 0, assoc: "left" };
        }

        return this.operators[node.operator] ?? { prec: 0, assoc: "left" };
    }

    wrapInParentheses(ctx, node, astNode) {
        return astNode(ctx, {
            type: "ParenthesizedExpression",
            expression: node,
            synthetic: true
        });
    }
}
