import type { GameMakerAstNode } from "../types.js";
import { getIdentifierText, isIdentifierNode, isLiteralNode } from "./identifiers.js";

const LOGICAL_OPERATORS = new Set(["and", "&&", "or", "||"]);
const LOGICAL_AND_OPERATORS = new Set(["and", "&&"]);
const LOGICAL_OR_OPERATORS = new Set(["or", "||"]);
const COMPARISON_OPERATORS = new Set(["==", "!=", "<>", "<=", ">=", "<", ">"]);
const ARITHMETIC_OPERATORS = new Set(["+", "-", "*", "/", "%", "^", "<<", ">>", ">>>", "|", "&"]);

type BooleanLiteralOptions =
    | boolean
    | {
          acceptBooleanPrimitives?: boolean;
      };

/**
 * Extract a normalized lowercase string from a literal node.
 *
 * @param node Potential literal node.
 * @returns Lowercase string value when present, otherwise `null`.
 */
export function getLiteralStringValue(node: GameMakerAstNode | null | undefined): string | null {
    if (!isLiteralNode(node)) {
        return null;
    }

    const { value } = node;
    return typeof value === "string" ? value.toLowerCase() : null;
}

/**
 * Extract a finite numeric value from a literal node.
 *
 * @param node Potential literal node.
 * @returns Finite numeric value when the node is a numeric literal, otherwise `null`.
 */
export function getLiteralNumberValue(node: GameMakerAstNode | null | undefined): number | null {
    if (!isLiteralNode(node)) {
        return null;
    }

    const { value } = node;
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

/**
 * Extract a normalized boolean value from a literal node.
 *
 * @param node Potential literal node.
 * @param options Configuration for accepting primitive boolean values.
 * @returns `"true"` or `"false"` when the node is a boolean literal, otherwise `null`.
 */
export function getBooleanLiteralValue(
    node: GameMakerAstNode | null | undefined,
    options: BooleanLiteralOptions = {}
): "true" | "false" | null {
    if (!isLiteralNode(node)) {
        return null;
    }

    const acceptBooleanPrimitives = typeof options === "boolean" ? options : !!options.acceptBooleanPrimitives;
    const { value } = node;
    const isBooleanPrimitive = value === true || value === false;

    if (!isBooleanPrimitive) {
        const normalized = getLiteralStringValue(node);
        return normalized === "true" || normalized === "false" ? normalized : null;
    }

    if (!acceptBooleanPrimitives) {
        return null;
    }

    return value ? "true" : "false";
}

/**
 * Check whether `node` represents a boolean literal.
 *
 * @param node Potential literal node.
 * @param options Configuration for accepting primitive boolean values.
 * @returns `true` when `node` is a boolean literal.
 */
export function isBooleanLiteral(node: GameMakerAstNode | null | undefined, options?: BooleanLiteralOptions): boolean {
    return getBooleanLiteralValue(node, options) !== null;
}

/**
 * Check whether `node` is an `undefined` literal.
 *
 * @param node Potential literal node.
 * @returns `true` when `node` is a string literal with value `"undefined"`.
 */
export function isUndefinedLiteral(node: GameMakerAstNode | null | undefined): boolean {
    return getLiteralStringValue(node) === "undefined";
}

/**
 * Check whether `node` represents an `undefined` value.
 *
 * @param node Potential undefined sentinel.
 * @returns `true` when `node` represents `undefined` in any accepted form.
 */
export function isUndefinedSentinel(node: GameMakerAstNode | null | undefined): boolean {
    if (isUndefinedLiteral(node)) {
        return true;
    }

    if (node == null || typeof node !== "object") {
        return false;
    }

    if (isLiteralNode(node)) {
        return node.value === undefined;
    }

    if (isIdentifierNode(node)) {
        return node.name.toLowerCase() === "undefined";
    }

    const identifierText = getIdentifierText(node);
    return typeof identifierText === "string" ? identifierText.toLowerCase() === "undefined" : false;
}

/**
 * Check whether `operator` is a comparison binary operator.
 *
 * @param operator Candidate operator string.
 * @returns `true` when `operator` is a comparison binary operator.
 */
export function isComparisonBinaryOperator(operator: string): boolean {
    return COMPARISON_OPERATORS.has(operator);
}

/**
 * Check whether `operator` is a logical binary operator.
 *
 * @param operator Candidate operator string.
 * @returns `true` when `operator` is a logical binary operator.
 */
export function isLogicalBinaryOperator(operator: string): boolean {
    return LOGICAL_OPERATORS.has(operator);
}

/**
 * Check whether `operator` is a logical AND operator.
 *
 * @param operator Candidate operator string.
 * @returns `true` when `operator` is `"and"` or `"&&"`.
 */
export function isLogicalAndOperator(operator: string): boolean {
    return LOGICAL_AND_OPERATORS.has(operator);
}

/**
 * Check whether `operator` is a logical OR operator.
 *
 * @param operator Candidate operator string.
 * @returns `true` when `operator` is `"or"` or `"||"`.
 */
export function isLogicalOrOperator(operator: string): boolean {
    return LOGICAL_OR_OPERATORS.has(operator);
}

/**
 * Check whether `operator` is an arithmetic binary operator.
 *
 * @param operator Candidate operator string.
 * @returns `true` when `operator` is an arithmetic binary operator.
 */
export function isArithmeticBinaryOperator(operator: string): boolean {
    return ARITHMETIC_OPERATORS.has(operator);
}

/**
 * Check whether `character` is a numeric digit.
 *
 * @param character Single-character string to inspect.
 * @returns `true` when `character` is a digit from `"0"` to `"9"`.
 */
export function isNumericLiteralBoundaryCharacter(character: string): boolean {
    return character >= "0" && character <= "9";
}
