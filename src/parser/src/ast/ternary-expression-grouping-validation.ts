import { Core } from "@gmloop/core";

import { GameMakerSyntaxError } from "./gml-syntax-error.js";

function resolveLineAndColumnFromSourceIndex(
    sourceText: string,
    index: number
): Readonly<{ line: number; column: number }> {
    let line = 1;
    let lineStartIndex = 0;

    for (let position = 0; position < index && position < sourceText.length; position += 1) {
        if (sourceText[position] === "\n") {
            line += 1;
            lineStartIndex = position + 1;
        }
    }

    return Object.freeze({
        line,
        column: Math.max(0, index - lineStartIndex)
    });
}

function resolveNodeLineAndColumn(
    sourceText: string,
    node: unknown
): Readonly<{ line: number; column: number; index: number | null }> {
    if (Core.isObjectLike(node) && Core.isObjectLike((node as { start?: unknown }).start)) {
        const start = (node as { start: { line?: unknown; column?: unknown; index?: unknown } }).start;
        if (typeof start.line === "number" && typeof start.column === "number") {
            const parsedIndex = typeof start.index === "number" ? start.index : null;
            return Object.freeze({ line: start.line, column: start.column, index: parsedIndex });
        }
    }

    const fallbackIndex = Core.getNodeStartIndex(node);
    if (typeof fallbackIndex === "number") {
        const fromIndex = resolveLineAndColumnFromSourceIndex(sourceText, fallbackIndex);
        return Object.freeze({ ...fromIndex, index: fallbackIndex });
    }

    return Object.freeze({ line: 1, column: 0, index: null });
}

/**
 * Rejects nested ternary expressions in the true branch unless explicitly parenthesized.
 *
 * @param sourceText - Original source code being parsed.
 * @param astTree - Parsed AST to validate.
 * @throws {GameMakerSyntaxError} When an outer ternary consequent contains an unparenthesized nested ternary.
 */
export function assertNestedTernaryConsequentsAreParenthesized(sourceText: string, astTree: unknown): void {
    if (!Core.isNode(astTree)) {
        return;
    }

    const nodesToVisit: Array<unknown> = [astTree];

    while (nodesToVisit.length > 0) {
        const current = nodesToVisit.pop();
        if (!Core.isNode(current)) {
            continue;
        }

        if (Core.isTernaryExpressionNode(current)) {
            const consequent = current.consequent;
            const unwrappedConsequent = Core.unwrapParenthesizedExpression(consequent);
            const consequentIsNestedTernary =
                Core.isNode(unwrappedConsequent) &&
                (Core.isTernaryExpressionNode(unwrappedConsequent) ||
                    Core.isConditionalExpressionNode(unwrappedConsequent));
            const consequentWasExplicitlyParenthesized = Core.isParenthesizedExpressionNode(consequent);

            if (consequentIsNestedTernary && !consequentWasExplicitlyParenthesized) {
                const location = resolveNodeLineAndColumn(sourceText, unwrappedConsequent);
                throw new GameMakerSyntaxError({
                    message:
                        `Syntax Error (line ${location.line}, column ${location.column}): ` +
                        "nested ternary in the true branch must be wrapped in parentheses",
                    line: location.line,
                    column: location.column,
                    wrongSymbol: "symbol '?'",
                    offendingText: "?",
                    rule: "expression"
                });
            }
        }

        Core.forEachNodeChild(current, (childNode, key) => {
            if (key === "parent") {
                return;
            }

            if (Array.isArray(childNode)) {
                for (const element of childNode) {
                    nodesToVisit.push(element);
                }
                return;
            }

            nodesToVisit.push(childNode);
        });
    }
}
