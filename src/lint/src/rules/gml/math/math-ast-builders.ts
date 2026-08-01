/**
 * Low-level AST node creation, mutation, and cloning helpers used by math
 * normalisation passes.  All functions operate solely on the node object graph
 * and depend only on `@gmloop/core`; no higher-level transform logic lives here.
 */
import { Core } from "@gmloop/core";

const { BINARY_EXPRESSION, CALL_EXPRESSION, LITERAL, PARENTHESIZED_EXPRESSION, UNARY_EXPRESSION, isObjectLike } = Core;

/** Create a new binary-expression node with the given operator and operands. */
export function createBinaryExpressionNode(
    operator: string,
    left: unknown,
    right: unknown,
    template: unknown
): unknown {
    const expression = {
        type: BINARY_EXPRESSION,
        operator,
        left,
        right
    };

    Core.assignClonedLocation(expression, template);

    return expression;
}

/** Wrap `expression` in a parenthesised-expression node. Returns `null` for non-object inputs. */
export function createParenthesizedExpressionNode(expression: unknown, template: unknown): unknown {
    if (!isObjectLike(expression)) {
        return null;
    }

    const node = {
        type: PARENTHESIZED_EXPRESSION,
        expression
    };

    Core.assignClonedLocation(node, template);

    return node;
}

/** Create a `left * right` binary-expression node. Returns `null` when either operand is absent. */
export function createMultiplicationNode(left: unknown, right: unknown, template: unknown): unknown {
    if (!left || !right) {
        return null;
    }

    const expression = {
        type: BINARY_EXPRESSION,
        operator: "*",
        left,
        right
    };

    Core.assignClonedLocation(expression, template);

    return expression;
}

/** Create a unary negation node (`-argument`). Returns `null` when `argument` is absent. */
export function createUnaryNegationNode(argument: unknown, template: unknown): unknown {
    if (!argument) {
        return null;
    }

    const expression = {
        type: UNARY_EXPRESSION,
        operator: "-",
        prefix: true,
        argument
    };

    Core.assignClonedLocation(expression, template);

    return expression;
}

/** Build a prefix-minus unary node around `argument`. Returns `null` for non-object inputs. */
export function createNegatedExpression(argument: unknown, template: unknown): unknown {
    if (!isObjectLike(argument)) {
        return null;
    }

    const unary = {
        type: UNARY_EXPRESSION,
        operator: "-",
        prefix: true,
        argument
    };

    Core.assignClonedLocation(unary, template);

    return unary;
}

/**
 * Create a call-expression node that invokes `name` with `args`.
 * Returns `null` when the identifier node cannot be created.
 */
export function createCallExpressionNode(name: string, args: unknown[], template: unknown): unknown {
    const identifier = Core.createIdentifierNode(name, template);
    if (!identifier) {
        return null;
    }

    const call = {
        type: CALL_EXPRESSION,
        object: identifier,
        arguments: Core.toMutableArray(args)
    };

    Core.assignClonedLocation(call, template);

    return call;
}

/** Create a numeric literal node whose `.value` is `String(value)`. */
export function createNumericLiteral(value: string | number, template: unknown): unknown {
    const literal = {
        type: LITERAL,
        value: String(value)
    };

    Core.assignClonedLocation(literal, template);

    return literal;
}

/**
 * In-place replacement: delete all own keys from `target` and copy all keys
 * from `replacement` onto it (preserving the object reference).
 * Used when an AST node must be mutated to a completely different node type.
 */
export function replaceNode(target: unknown, replacement: unknown): void {
    if (!isObjectLike(target) || !replacement) {
        return;
    }

    for (const key of Object.keys(target as object)) {
        delete (target as any)[key];
    }

    Object.assign(target as object, replacement);
}

/**
 * Copy `source` (cloned) onto `target` via `replaceNode`.
 * Returns `true` when the replacement was applied.
 *
 * `cloneAstNode` already skips traversal link keys (parent, enclosingNode, etc.),
 * so this function delegates key deletion and copying to Object.assign.
 */
export function replaceNodeWith(target: unknown, source: unknown): boolean {
    const clone = Core.cloneAstNode(source);
    if (!isObjectLike(clone)) {
        return false;
    }

    Object.assign(target as object, clone);
    return true;
}

/**
 * Mutate `target` in-place so it becomes a call to `name(…args)`.
 * Delegates to `createCallExpressionNode` + `replaceNode`.
 */
export function mutateToCallExpression(target: unknown, name: string, args: unknown[], template: unknown): void {
    const call = createCallExpressionNode(name, args, template);

    if (!call) {
        return;
    }

    replaceNode(target, call);
}

/** Mutate `target` in-place so it becomes the numeric literal `value`. */
export function mutateToNumericLiteral(target: unknown, value: string | number, template: unknown): void {
    const literal = createNumericLiteral(value, template);

    if (!literal) {
        return;
    }

    replaceNode(target, literal);
}

/**
 * Fold a flat list of multiplicative-chain terms back into a left-associative
 * `a * b * c * …` binary-expression tree.  Each term may carry `.raw` or
 * `.expression` to retrieve the original node.  Returns `null` when `terms`
 * is empty or any clone fails.
 */
export function cloneMultiplicativeTerms(terms: unknown[], template: unknown): unknown {
    if (!Core.isNonEmptyArray(terms)) {
        return null;
    }

    const first = (terms as any[])[0];
    const baseClone = Core.cloneAstNode(first?.raw ?? first?.expression);
    if (!baseClone) {
        return null;
    }

    let result = baseClone;

    for (let index = 1; index < terms.length; index += 1) {
        const current = (terms as any[])[index];
        const operand = Core.cloneAstNode(current?.raw ?? current?.expression);

        if (!operand) {
            return null;
        }

        const product = createMultiplicationNode(result, operand, template);
        if (!product) {
            return null;
        }

        result = product;
    }

    return result;
}
