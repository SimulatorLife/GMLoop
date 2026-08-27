/**
 * Canonical numeric-expression replacement helpers extracted from
 * `optimize-math-expressions-rule.ts`.
 *
 * The rule historically lived in a single ~1.4k-line file that combined
 * three responsibilities: (a) detecting and folding constant numeric
 * expressions, (b) orchestrating AST-level edits on a buffer, and (c)
 * dispatching the rule itself. Concern (a) was by far the largest and
 * the most self-contained — every helper in this module reads from a
 * raw AST/source-text pair and returns either a normalised string or
 * `null`. None of them touches an edit list or knows about the ESLint
 * rule context, so the helpers fit naturally as a sibling of the
 * existing math-transform modules.
 *
 * Splitting these helpers out keeps the rule body focused on traversal
 * and edit scheduling, while the replacement logic lives next to the
 * other math transforms in `gml/math/`. The public surface is small:
 * two orchestrators (`applySourceAwareCanonicalMathReplacement`,
 * `tryBuildFastDotProductReplacement`) plus a couple of text/evaluator
 * helpers re-exported because the rule's remaining helpers still need
 * them (`trimOuterParentheses`, `tryEvaluateNumericExpression`).
 */

import { Core } from "@gmloop/core";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";

const {
    areExpressionNodesEquivalentIgnoringParentheses,
    areNumbersApproximatelyEqual,
    getLiteralNumberValue,
    hasComment,
    isApproximatelyZero,
    isIdentifierNode,
    isLogicalAndOperator,
    isLogicalOrOperator,
    toNumber,
    unwrapParenthesizedExpression: unwrapParenthesized
} = Core;

/**
 * Best-effort evaluator for AST subtrees that contain only literal-like
 * nodes (numbers, booleans, strings) and pure unary/binary operators.
 *
 * Returns the constant value when the entire subtree folds to one, or
 * `undefined` when any node yields an indeterminate result (e.g. an
 * identifier, a non-finite division). Callers use the `undefined`
 * sentinel to distinguish "definitely not constant" from "constant
 * but null" — the latter is the legitimate result of an empty literal
 * branch and is folded further up the pipeline.
 *
 * @param node - Arbitrary AST node; usually a `BinaryExpression`,
 *   `UnaryExpression`, or `Literal`. Parentheses are unwrapped before
 *   evaluation.
 * @returns The folded primitive value or `undefined`.
 */
function tryEvaluateExpression(node: any): any {
    const unwrapped = unwrapParenthesized(node);
    if (!unwrapped) {
        return undefined;
    }

    if (unwrapped.type === "Literal") {
        if (unwrapped.value === "true") {
            return true;
        }
        if (unwrapped.value === "false") {
            return false;
        }
        const num = getLiteralNumberValue(unwrapped);
        if (num !== null) {
            return num;
        }
        return unwrapped.value;
    }

    if (unwrapped.type === "UnaryExpression") {
        const argumentValue = tryEvaluateExpression(unwrapped.argument);
        if (argumentValue === undefined) {
            return undefined;
        }

        switch (unwrapped.operator) {
            case "-": {
                return typeof argumentValue === "number" ? argumentValue * -1 : undefined;
            }
            case "!":
            case "not": {
                return !argumentValue;
            }
            case "~": {
                return typeof argumentValue === "number" ? ~argumentValue : undefined;
            }
            default: {
                return undefined;
            }
        }
    }

    if (unwrapped.type === "BinaryExpression" || unwrapped.type === "LogicalExpression") {
        const leftValue = tryEvaluateExpression(unwrapped.left);
        const rightValue = tryEvaluateExpression(unwrapped.right);

        if (isLogicalAndOperator(unwrapped.operator)) {
            if (leftValue === false || rightValue === false) {
                return false;
            }
            if (leftValue === true && rightValue === true) {
                return true;
            }
            return undefined;
        }
        if (isLogicalOrOperator(unwrapped.operator)) {
            if (leftValue === true || rightValue === true) {
                return true;
            }
            if (leftValue === false && rightValue === false) {
                return false;
            }
            return undefined;
        }

        if (leftValue === undefined || rightValue === undefined) {
            return undefined;
        }

        switch (unwrapped.operator) {
            case "+": {
                return leftValue + rightValue;
            }
            case "-": {
                return leftValue - rightValue;
            }
            case "*": {
                return leftValue * rightValue;
            }
            case "/": {
                return isApproximatelyZero(rightValue) ? undefined : leftValue / rightValue;
            }
            case "div": {
                return isApproximatelyZero(rightValue) ? undefined : Math.trunc(leftValue / rightValue);
            }
            case "mod":
            case "%": {
                return isApproximatelyZero(rightValue) ? undefined : leftValue % rightValue;
            }
            case "xor": {
                return Boolean(leftValue) !== Boolean(rightValue);
            }
            case "==": {
                return leftValue == rightValue;
            }
            case "!=":
            case "<>": {
                return leftValue != rightValue;
            }
            case "<": {
                return leftValue < rightValue;
            }
            case ">": {
                return leftValue > rightValue;
            }
            case "<=": {
                return leftValue <= rightValue;
            }
            case ">=": {
                return leftValue >= rightValue;
            }
            default: {
                return undefined;
            }
        }
    }

    return undefined;
}

/**
 * Numeric-only counterpart of {@link tryEvaluateExpression}: folds the
 * subtree and returns the value coerced to a finite `number`, or `null`
 * when the result is not a usable numeric constant.
 *
 * Used by both the canonical-replacement family (to fold `1 / 2` into
 * `0.5` for re-emission) and the dead-code-elimination pass (to detect
 * `+=` / `-=` deltas that sum to zero).
 *
 * @param node - AST node to evaluate.
 * @returns Numeric constant value, or `null` when the subtree does not
 *   fold to a number.
 */
function tryEvaluateNumericExpression(node: any): number | null {
    const result = tryEvaluateExpression(node);
    return toNumber(result);
}

/**
 * Strip the outermost balanced pair of parentheses from `value`, only
 * when removing them is observationally equivalent (the inner content
 * has no leading/trailing whitespace that would change parsing, and
 * the inner parens are balanced).
 *
 * Used everywhere a canonical replacement has to be compared to the
 * original source text — without this, `((a))` would never match `(a)`
 * and the rule would emit spurious no-op rewrites.
 *
 * @param value - Source-text fragment.
 * @returns The string with outer parens removed, or `value` itself when
 *   no safe stripping is possible.
 */
function trimOuterParentheses(value: string): string {
    let text = value.trim();
    while (text.startsWith("(") && text.endsWith(")")) {
        const inner = text.slice(1, -1);
        const trimmed = inner.trim();

        // Stripping the outermost pair is only valid if the inner content is
        // already clean whitespace (no leading/trailing parens that would be lost
        // by a .trim() alone) and the inner parens are balanced.
        if (trimmed.length < inner.length || !containsBalancedParentheses(trimmed)) {
            break;
        }

        text = trimmed;
    }

    return text;
}

function containsBalancedParentheses(text: string): boolean {
    let depth = 0;
    for (const ch of text) {
        if (ch === "(") {
            depth += 1;
        } else if (ch === ")") {
            depth -= 1;
            if (depth < 0) {
                return false;
            }
        }
    }
    return depth === 0;
}

function tryReadNumericLiteralValue(node: unknown): number | null {
    const expression = unwrapParenthesized(node);
    if (!expression) {
        return null;
    }

    return getLiteralNumberValue(expression);
}

function isCanonicalNumericLiteralText(sourceText: string, node: unknown): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "Literal") {
        return false;
    }

    const numericValue = getLiteralNumberValue(expression);
    if (numericValue === null) {
        return false;
    }

    const literalText = gmlRuleAutofixServices.readNodeText(sourceText, expression);
    const canonicalText = formatCanonicalNumericLiteral(numericValue);
    return literalText !== null && canonicalText !== null && literalText === canonicalText;
}

function isCanonicalConstantNumericExpression(sourceText: string, node: unknown): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression) {
        return false;
    }

    switch (expression.type) {
        case "Literal": {
            return isCanonicalNumericLiteralText(sourceText, expression);
        }
        case "UnaryExpression": {
            if (expression.operator !== "-" && expression.operator !== "+") {
                return false;
            }

            return isCanonicalConstantNumericExpression(sourceText, expression.argument);
        }
        case "BinaryExpression": {
            if (!["+", "-", "*", "/", "div", "mod", "%"].includes(expression.operator)) {
                return false;
            }

            return (
                isCanonicalConstantNumericExpression(sourceText, expression.left) &&
                isCanonicalConstantNumericExpression(sourceText, expression.right)
            );
        }
        default: {
            return false;
        }
    }
}

function tryBuildConstantNumericReplacement(sourceText: string, node: unknown): string | null {
    if (!isCanonicalConstantNumericExpression(sourceText, node)) {
        return null;
    }

    const numericValue = tryEvaluateNumericExpression(node);
    if (numericValue === null) {
        return null;
    }

    const replacement = formatCanonicalNumericLiteral(numericValue);
    if (!replacement) {
        return null;
    }

    const originalText = gmlRuleAutofixServices.readNodeText(sourceText, node);
    return originalText && originalText !== replacement ? replacement : null;
}

function collectAdditiveTerms(node: unknown, terms: unknown[]): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression) {
        return false;
    }

    if (expression.type === "BinaryExpression" && expression.operator === "+") {
        return collectAdditiveTerms(expression.left, terms) && collectAdditiveTerms(expression.right, terms);
    }

    terms.push(expression);
    return true;
}

function tryReadSquaredOperandText(sourceText: string, node: unknown): string | null {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "*") {
        return null;
    }

    if (!areExpressionNodesEquivalentIgnoringParentheses(expression.left, expression.right)) {
        return null;
    }

    const operandText = gmlRuleAutofixServices.readNodeText(sourceText, expression.left);
    return operandText ? trimOuterParentheses(operandText) : null;
}

function tryBuildGroupedSquareSumReplacement(sourceText: string, node: unknown): string | null {
    const terms: unknown[] = [];
    if (!collectAdditiveTerms(node, terms) || terms.length !== 3) {
        return null;
    }

    const operandTexts = terms.map((term) => tryReadSquaredOperandText(sourceText, term));
    if (operandTexts.includes(null)) {
        return null;
    }

    const [first, second, third] = operandTexts as [string, string, string];
    return `dot_product_3d(${first}, ${second}, ${third}, ${first}, ${second}, ${third})`;
}

function tryReadHalfScaledBase(node: unknown) {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "BinaryExpression") {
        return null;
    }

    if (expression.operator === "/") {
        const denominatorValue = tryReadNumericLiteralValue(expression.right);
        if (denominatorValue === null || !areNumbersApproximatelyEqual(denominatorValue, 2)) {
            return null;
        }

        return unwrapParenthesized(expression.left);
    }

    if (expression.operator !== "*") {
        return null;
    }

    const leftValue = tryReadNumericLiteralValue(expression.left);
    if (leftValue !== null && areNumbersApproximatelyEqual(leftValue, 0.5)) {
        return unwrapParenthesized(expression.right);
    }

    const rightValue = tryReadNumericLiteralValue(expression.right);
    if (rightValue !== null && areNumbersApproximatelyEqual(rightValue, 0.5)) {
        return unwrapParenthesized(expression.left);
    }

    return null;
}

function tryBuildHalfLengthdirDifferenceReplacement(sourceText: string, node: unknown): string | null {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "-") {
        return null;
    }

    const leftDifference = unwrapParenthesized(expression.left);
    const rightCall = unwrapParenthesized(expression.right);
    if (
        !leftDifference ||
        leftDifference.type !== "BinaryExpression" ||
        leftDifference.operator !== "-" ||
        !rightCall ||
        rightCall.type !== "CallExpression"
    ) {
        return null;
    }

    const callee = unwrapParenthesized(rightCall.object);
    if (!isIdentifierNode(callee) || (callee.name !== "lengthdir_x" && callee.name !== "lengthdir_y")) {
        return null;
    }

    const callArguments = rightCall.arguments;
    if (!Array.isArray(callArguments) || callArguments.length !== 2) {
        return null;
    }

    const [rawLengthArgument, rawAngleArgument] = callArguments;
    const baseExpression = unwrapParenthesized(leftDifference.left);
    const subtrahendBaseExpression = tryReadHalfScaledBase(leftDifference.right);
    const callBaseExpression = tryReadHalfScaledBase(rawLengthArgument);
    if (!baseExpression || !subtrahendBaseExpression || !callBaseExpression) {
        return null;
    }

    if (
        !areExpressionNodesEquivalentIgnoringParentheses(baseExpression, subtrahendBaseExpression) ||
        !areExpressionNodesEquivalentIgnoringParentheses(baseExpression, callBaseExpression)
    ) {
        return null;
    }

    const baseText = gmlRuleAutofixServices.readNodeText(sourceText, baseExpression);
    const angleText = gmlRuleAutofixServices.readNodeText(sourceText, rawAngleArgument);
    if (!baseText || !angleText) {
        return null;
    }

    const normalizedBaseText = trimOuterParentheses(baseText);
    const normalizedAngleText = trimOuterParentheses(angleText);
    return `${normalizedBaseText} * 0.5 * (1 - ${callee.name}(1, ${normalizedAngleText}))`;
}

type RatioMultiplierMatch = Readonly<{
    multiplier: number;
    ratioExpression: unknown;
}>;

function tryMatchRatioMultiplier(node: unknown): RatioMultiplierMatch | null {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "*") {
        return null;
    }

    const leftValue = tryReadNumericLiteralValue(expression.left);
    const rightValue = tryReadNumericLiteralValue(expression.right);

    if (leftValue !== null && rightValue !== null) {
        return null;
    }

    if (leftValue !== null) {
        const ratioExpression = unwrapParenthesized(expression.right);
        if (!ratioExpression || ratioExpression.type !== "BinaryExpression" || ratioExpression.operator !== "/") {
            return null;
        }

        return { multiplier: leftValue, ratioExpression };
    }

    if (rightValue !== null) {
        const ratioExpression = unwrapParenthesized(expression.left);
        if (!ratioExpression || ratioExpression.type !== "BinaryExpression" || ratioExpression.operator !== "/") {
            return null;
        }

        return { multiplier: rightValue, ratioExpression };
    }

    return null;
}

function formatCanonicalNumericLiteral(value: number): string | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    if (Object.is(value, -0) || value === 0) {
        return "0";
    }

    const roundedInteger = Math.round(value);
    if (areNumbersApproximatelyEqual(value, roundedInteger)) {
        return roundedInteger.toString();
    }

    return Number(value.toPrecision(12)).toString();
}

function tryBuildGroupedRatioProductReplacement(sourceText: string, node: unknown): string | null {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "/") {
        return null;
    }

    const divisorValue = tryReadNumericLiteralValue(expression.right);
    if (divisorValue === null || areNumbersApproximatelyEqual(divisorValue, 0)) {
        return null;
    }

    const ratioMultiplierMatch = tryMatchRatioMultiplier(expression.left);
    if (!ratioMultiplierMatch) {
        return null;
    }

    const scaledMultiplier = ratioMultiplierMatch.multiplier / divisorValue;
    const multiplierText = formatCanonicalNumericLiteral(scaledMultiplier);
    const ratioText = gmlRuleAutofixServices.readNodeText(sourceText, ratioMultiplierMatch.ratioExpression);
    if (!multiplierText || !ratioText) {
        return null;
    }

    return `(${trimOuterParentheses(ratioText)}) * ${multiplierText}`;
}

/**
 * Pick the highest-precedence canonical-form rewrite that applies to
 * `node`, falling back to the caller-supplied `replacement` when none
 * of the specialised rewrites match.
 *
 * Ordering matters: the half-lengthdir rewrite is the most aggressive
 * (it pulls `lengthdir_x` out of a subtraction), followed by the
 * grouped-ratio rewrite (which collapses `k * (a / b) / c` into
 * `(a / b) * (k / c)`), with the square-sum rewrite (which expands
 * three squared operands into a `dot_product_3d` call) as a final
 * attempt. Returning `replacement` verbatim when nothing fires keeps
 * the orchestrator a pure function of the input node.
 *
 * @param sourceText - Full source buffer the node lives in.
 * @param node - Candidate AST node.
 * @param replacement - Fallback replacement produced by the rule's
 *   constant-numeric pass.
 * @returns The highest-precedence rewrite, or `replacement` when no
 *   specialised form applies.
 */
function applySourceAwareCanonicalMathReplacement(sourceText: string, node: unknown, replacement: string): string {
    const halfLengthdirReplacement = tryBuildHalfLengthdirDifferenceReplacement(sourceText, node);
    if (halfLengthdirReplacement) {
        return halfLengthdirReplacement;
    }

    const groupedRatioReplacement = tryBuildGroupedRatioProductReplacement(sourceText, node);
    if (groupedRatioReplacement) {
        return groupedRatioReplacement;
    }

    const groupedSquareReplacement = tryBuildGroupedSquareSumReplacement(sourceText, node);
    if (groupedSquareReplacement) {
        return groupedSquareReplacement;
    }

    return replacement;
}

function collectAdditiveTermsForDotProduct(node: any, terms: any[]): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression) {
        return false;
    }

    if (expression.type === "BinaryExpression" && expression.operator === "+") {
        if (hasComment(expression)) {
            return false;
        }

        return (
            collectAdditiveTermsForDotProduct(expression.left, terms) &&
            collectAdditiveTermsForDotProduct(expression.right, terms)
        );
    }

    terms.push(expression);
    return true;
}

function isFastDotProductOperandCandidate(node: unknown): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression || hasComment(expression)) {
        return false;
    }

    return (
        expression.type === "Identifier" ||
        expression.type === "MemberDotExpression" ||
        expression.type === "MemberIndexExpression"
    );
}

/**
 * Recognise `a * b + c * d [+ e * f]` patterns and collapse them into a
 * single `dot_product` (or `dot_product_3d` for three-term sums) call.
 *
 * The "fast" prefix distinguishes this from the slower, square-sum
 * matcher: this pass only fires when every operand is already a pure
 * identifier/member-access reference, so no scalar folding is required
 * and the rewrite is a pure text substitution.
 *
 * @param sourceText - Source buffer the node lives in.
 * @param node - Candidate additive expression.
 * @returns The rewritten call expression, or `null` when the input
 *   does not match the pattern.
 */
function tryBuildFastDotProductReplacement(sourceText: string, node: any): string | null {
    const expression = unwrapParenthesized(node);
    if (
        !expression ||
        expression.type !== "BinaryExpression" ||
        expression.operator !== "+" ||
        hasComment(expression)
    ) {
        return null;
    }

    const terms: any[] = [];
    if (!collectAdditiveTermsForDotProduct(expression, terms)) {
        return null;
    }

    if (terms.length !== 2 && terms.length !== 3) {
        return null;
    }

    const leftVectorTerms: string[] = [];
    const rightVectorTerms: string[] = [];

    for (const term of terms) {
        const multiplicativeExpression = unwrapParenthesized(term);
        if (
            !multiplicativeExpression ||
            multiplicativeExpression.type !== "BinaryExpression" ||
            multiplicativeExpression.operator !== "*" ||
            hasComment(multiplicativeExpression)
        ) {
            return null;
        }

        const leftOperand = unwrapParenthesized(multiplicativeExpression.left);
        const rightOperand = unwrapParenthesized(multiplicativeExpression.right);
        if (!leftOperand || !rightOperand) {
            return null;
        }

        if (!isFastDotProductOperandCandidate(leftOperand) || !isFastDotProductOperandCandidate(rightOperand)) {
            return null;
        }

        const leftText = gmlRuleAutofixServices.readNodeText(sourceText, leftOperand);
        const rightText = gmlRuleAutofixServices.readNodeText(sourceText, rightOperand);
        if (!leftText || !rightText) {
            return null;
        }

        leftVectorTerms.push(trimOuterParentheses(leftText));
        rightVectorTerms.push(trimOuterParentheses(rightText));
    }

    const functionName = terms.length === 2 ? "dot_product" : "dot_product_3d";
    const argumentTexts = [...leftVectorTerms, ...rightVectorTerms];
    return `${functionName}(${argumentTexts.join(", ")})`;
}

export {
    applySourceAwareCanonicalMathReplacement,
    trimOuterParentheses,
    tryBuildConstantNumericReplacement,
    tryBuildFastDotProductReplacement,
    tryEvaluateNumericExpression
};
