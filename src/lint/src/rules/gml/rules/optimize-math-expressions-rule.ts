import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
// manual-transforms provide a comprehensive suite of normalization helpers that
// the linter rule previously replicated only incompletely. We now invoke them
// directly and print the resulting AST fragment ourselves so the rule can keep
// its existing text-edit infrastructure and remain synchronous.
import {
    applyDivisionToMultiplication,
    applyManualMathNormalization,
    applyScalarCondensing,
    cleanupMultiplicativeIdentityParentheses,
    simplifyZeroDivisionNumerators
} from "../math/index.js";
import {
    MIN_OPTIMIZE_MATH_EPSILON,
    MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE
} from "../math/math-policy-constants.js";
import {
    applySourceTextEdits,
    createCommentTokenRangeIndex,
    createMeta,
    getVariableDeclarator,
    isAstNodeRecord,
    rangeContainsCommentToken,
    readObjectOption,
    reportFullTextRewrite,
    type SourceTextEdit,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";
import { applyManualMathCanonicalForms } from "./optimize-math-manual-canonical-forms-policy.js";
import {
    canAstShapeContainMathOptimizationCandidate,
    containsMathOptimizationSyntax,
    DEFAULT_MATH_SIGNAL_PATTERNS,
    DEFAULT_NUMERIC_LITERAL_POLICY,
    evaluateMathOptimizationCandidate,
    evaluateSkipDecision,
    MATH_OPTIMIZATION_POLICY_CONSTANTS,
    type NumericLiteralCanonicalFormPolicy,
    resolveMathNumericPolicy
} from "./optimize-math-skip-evaluator.js";

const {
    getNodeStartIndex,
    getNodeEndIndex,
    unwrapExpressionStatement,
    createStringCommentScanState,
    advanceStringCommentScan,
    hasComment,
    isApproximatelyZero,
    isIdentifierNode,
    isLogicalAndOperator,
    isLogicalOrOperator,
    toNumber,
    unwrapParenthesizedExpression: unwrapParenthesized
} = Core;

type MultiplicativeComponents = Readonly<{
    coefficient: number;
    factors: ReadonlyMap<string, number>;
}>;

const SUPPORTED_OPAQUE_MATH_FACTOR_TYPES = new Set([
    "Identifier",
    "MemberDotExpression",
    "MemberIndexExpression",
    "CallExpression"
]);
const COMMENT_SEQUENCE_PATTERN = /\/\/|\/\*|\*\//u;
const NUMERIC_LITERAL_SIGNAL_PATTERN = DEFAULT_MATH_SIGNAL_PATTERNS.numericLiteralSignal;
const DIVISION_BASED_OPTIMIZATION_SIGNAL_PATTERN = DEFAULT_MATH_SIGNAL_PATTERNS.divisionBasedSignal;
const MAX_MATH_OPTIMIZATION_CANDIDATE_TEXT_LENGTH =
    MATH_OPTIMIZATION_POLICY_CONSTANTS.MAX_OPTIMIZATION_CANDIDATE_LENGTH;

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
        const num = Core.getLiteralNumberValue(unwrapped);
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

function tryEvaluateNumericExpression(node: any): number | null {
    const result = tryEvaluateExpression(node);
    return toNumber(result);
}

function canUseOpaqueMathFactor(node: any): boolean {
    const unwrapped = unwrapParenthesized(node);
    if (!unwrapped) {
        return false;
    }

    if (SUPPORTED_OPAQUE_MATH_FACTOR_TYPES.has(unwrapped.type)) {
        return true;
    }

    if (unwrapped.type === "UnaryExpression" && unwrapped.operator === "-") {
        return canUseOpaqueMathFactor(unwrapped.argument);
    }

    if (unwrapped.type === "BinaryExpression" && (unwrapped.operator === "+" || unwrapped.operator === "-")) {
        return canUseOpaqueMathFactor(unwrapped.left) && canUseOpaqueMathFactor(unwrapped.right);
    }

    return false;
}

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

function collectMultiplicativeComponents(sourceText: string, node: any): MultiplicativeComponents | null {
    const unwrapped = unwrapParenthesized(node);
    if (!unwrapped) {
        return null;
    }

    const num = Core.getLiteralNumberValue(unwrapped);
    if (num !== null) {
        return { coefficient: num, factors: new Map() };
    }

    if (canUseOpaqueMathFactor(unwrapped)) {
        const text = gmlRuleAutofixServices.readNodeText(sourceText, unwrapped);
        if (!text) {
            return null;
        }
        return { coefficient: 1, factors: new Map([[trimOuterParentheses(text), 1]]) };
    }

    if (unwrapped.type === "UnaryExpression" && unwrapped.operator === "-") {
        const inner = collectMultiplicativeComponents(sourceText, unwrapped.argument);
        if (!inner) {
            return null;
        }
        return { coefficient: -inner.coefficient, factors: inner.factors };
    }

    if (unwrapped.type === "BinaryExpression" && (unwrapped.operator === "*" || unwrapped.operator === "/")) {
        const left = collectMultiplicativeComponents(sourceText, unwrapped.left);
        const right = collectMultiplicativeComponents(sourceText, unwrapped.right);
        if (!left || !right) {
            return null;
        }

        const combinedFactors = new Map(left.factors);
        for (const [factor, power] of right.factors) {
            const current = combinedFactors.get(factor) ?? 0;
            const delta = unwrapped.operator === "*" ? power : -power;
            combinedFactors.set(factor, current + delta);
        }

        if (unwrapped.operator === "/" && isApproximatelyZero(right.coefficient)) {
            return null;
        }

        return {
            coefficient:
                unwrapped.operator === "*"
                    ? left.coefficient * right.coefficient
                    : left.coefficient / right.coefficient,
            factors: combinedFactors
        };
    }

    return null;
}

function formatNonScientificNumericLiteral(value: number): string | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    if (Object.is(value, -0)) {
        return "0";
    }

    const literal = value.toString();
    if (literal.includes("e") || literal.includes("E")) {
        return null;
    }

    return literal;
}

function buildMultiplicativeExpression(components: MultiplicativeComponents): string | null {
    const { coefficient, factors } = components;
    if (coefficient === 0) {
        return "0";
    }

    const terms: string[] = [];
    const coefficientText = coefficient === 1 ? "1" : formatNonScientificNumericLiteral(coefficient);
    if (coefficient !== 1 && coefficientText === null) {
        return null;
    }

    // Normally we prefer to render the numeric coefficient first to canonicalize
    // expressions (e.g. "2 * x" instead of "x * 2"). However, when the
    // coefficient is a positive fraction less than 1, moving it to the front
    // introduces a leading decimal which the formatter subsequently rewrites
    // with a leading zero. This can change the appearance of the original
    // source in subtle ways (see testBanner). To avoid that class of churn we
    // append small positive coefficients at the end, preserving the ordering of
    // the remaining factors.
    const shouldPrefixCoefficient =
        coefficient !== 1 && (factors.size === 0 || coefficient <= -1 || coefficient >= 1 || coefficient < 0);
    if (shouldPrefixCoefficient) {
        terms.push(coefficientText);
    }

    for (const [factor, power] of factors) {
        if (Math.abs(power) < 1e-10) {
            continue;
        }
        if (power === 1) {
            terms.push(factor);
        } else if (power > 0) {
            for (let i = 0; i < power; i++) {
                terms.push(factor);
            }
        }
    }

    // if we decided not to prefix the coefficient earlier (typically because it
    // was a small positive fraction) then append it now so the term sequence
    // still includes the numeric factor.
    if (!shouldPrefixCoefficient && coefficient !== 1) {
        terms.push(coefficientText);
    }

    return terms.join(" * ");
}

function normalizeLeadingNumericCoefficientOrder(expressionText: string): string {
    const leadingNumericCoefficientMatch = /^(-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*\*\s*(.+)$/iu.exec(
        expressionText.trim()
    );
    if (!leadingNumericCoefficientMatch) {
        return expressionText;
    }

    const [, coefficientText, factorText] = leadingNumericCoefficientMatch;
    if (/^[-+]?(?:\d|\.)/u.test(factorText.trim())) {
        return expressionText;
    }

    return `${factorText.trim()} * ${coefficientText}`;
}

function simplifyMathExpression(sourceText: string, node: any, _source?: string): string | null {
    const components = collectMultiplicativeComponents(sourceText, node);
    if (!components) {
        return null;
    }

    for (const factorPower of components.factors.values()) {
        if (factorPower < 0) {
            return null;
        }
    }

    if (components.coefficient === 0) {
        return "0";
    }

    const multiplicativeExpression = buildMultiplicativeExpression(components);
    if (!multiplicativeExpression) {
        return null;
    }

    const simplified = normalizeLeadingNumericCoefficientOrder(multiplicativeExpression);
    const originalText = gmlRuleAutofixServices.readNodeText(sourceText, node);
    if (originalText && trimOuterParentheses(originalText) === trimOuterParentheses(simplified)) {
        return null;
    }

    return simplified;
}

function countDivisionLikeOperators(sourceText: string): number {
    const divisionMatches = sourceText.match(/[/%]/g);
    const keywordMatches = sourceText.match(/\b(?:div|mod)\b/giu);
    return (divisionMatches?.length ?? 0) + (keywordMatches?.length ?? 0);
}

function containsCommentSyntax(text: string): boolean {
    if (!COMMENT_SEQUENCE_PATTERN.test(text)) {
        return false;
    }

    const scanState = createStringCommentScanState();
    const length = text.length;
    for (let index = 0; index < length;) {
        const nextIndex = advanceStringCommentScan(text, length, index, scanState, true);
        if (nextIndex !== index) {
            if (scanState.inBlockComment || scanState.inLineComment) {
                return true;
            }

            index = nextIndex;
            continue;
        }

        index += 1;
    }

    return false;
}

function extractHalfLengthdirRotationExpression(node: any, variableName: string, sourceText: string): string | null {
    const unwrapped = unwrapParenthesized(node);
    if (!unwrapped || unwrapped.type !== "BinaryExpression" || unwrapped.operator !== "*") {
        return null;
    }

    const left = unwrapParenthesized(unwrapped.left);
    const right = unwrapParenthesized(unwrapped.right);

    if (
        left?.type === "Identifier" &&
        left.name === variableName &&
        right?.type === "BinaryExpression" &&
        right.operator === "-"
    ) {
        const rleft = unwrapParenthesized(right.left);
        const rright = unwrapParenthesized(right.right);
        if (rleft?.type === "Literal" && rleft.value === 1 && rright?.type === "CallExpression") {
            const callee = rright.object;
            if (isIdentifierNode(callee) && callee.name === "lengthdir_x") {
                const args = rright.arguments;
                if (
                    args.length === 2 &&
                    unwrapParenthesized(args[0])?.type === "Literal" &&
                    unwrapParenthesized(args[0])?.value === 1
                ) {
                    return gmlRuleAutofixServices.readNodeText(sourceText, args[1]);
                }
            }
        }
    }

    return null;
}

function rewriteManualMathCanonicalForms(sourceText: string): string {
    // The canonical-form pass used to live inline here, but the policy
    // (which patterns to rewrite into which canonical forms) and the
    // mechanism (iterating the rule list over the buffer) had become
    // inseparable. Both responsibilities are now owned by
    // `optimize-math-manual-canonical-forms-policy.ts`; this function is a
    // thin mechanism wrapper that delegates to the policy module so the
    // rule body stays focused on AST-level concerns.
    return applyManualMathCanonicalForms(sourceText);
}

function hasOverlappingRange(start: number, end: number, edits: ReadonlyArray<SourceTextEdit>): boolean {
    return edits.some((edit) => start < edit.end && end > edit.start);
}

function hasOverlapWithLastScheduledEdit(
    start: number,
    end: number,
    lastScheduledEdit: SourceTextEdit | null
): boolean {
    return lastScheduledEdit !== null && start < lastScheduledEdit.end && end > lastScheduledEdit.start;
}

type SourceTextRange = Readonly<{ start: number; end: number }>;

function isRangeInsideAnyRange(range: SourceTextRange, containerRanges: ReadonlyArray<SourceTextRange>): boolean {
    return containerRanges.some((containerRange) => {
        return range.start >= containerRange.start && range.end <= containerRange.end;
    });
}

function tryReadNumericLiteralValue(node: unknown): number | null {
    const expression = unwrapParenthesized(node);
    if (!expression) {
        return null;
    }

    return Core.getLiteralNumberValue(expression);
}

function isCanonicalNumericLiteralText(
    sourceText: string,
    node: unknown,
    policy: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "Literal") {
        return false;
    }

    const numericValue = Core.getLiteralNumberValue(expression);
    if (numericValue === null) {
        return false;
    }

    const literalText = gmlRuleAutofixServices.readNodeText(sourceText, expression);
    const canonicalText = formatCanonicalNumericLiteralWithPolicy(numericValue, policy);
    return literalText !== null && canonicalText !== null && literalText === canonicalText;
}

function isCanonicalConstantNumericExpression(
    sourceText: string,
    node: unknown,
    policy: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
): boolean {
    const expression = unwrapParenthesized(node);
    if (!expression) {
        return false;
    }

    switch (expression.type) {
        case "Literal": {
            return isCanonicalNumericLiteralText(sourceText, expression, policy);
        }
        case "UnaryExpression": {
            if (expression.operator !== "-" && expression.operator !== "+") {
                return false;
            }

            return isCanonicalConstantNumericExpression(sourceText, expression.argument, policy);
        }
        case "BinaryExpression": {
            if (!["+", "-", "*", "/", "div", "mod", "%"].includes(expression.operator)) {
                return false;
            }

            return (
                isCanonicalConstantNumericExpression(sourceText, expression.left, policy) &&
                isCanonicalConstantNumericExpression(sourceText, expression.right, policy)
            );
        }
        default: {
            return false;
        }
    }
}

function tryBuildConstantNumericReplacement(
    sourceText: string,
    node: unknown,
    policy: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
): string | null {
    if (!isCanonicalConstantNumericExpression(sourceText, node, policy)) {
        return null;
    }

    const numericValue = tryEvaluateNumericExpression(node);
    if (numericValue === null) {
        return null;
    }

    const replacement = formatCanonicalNumericLiteralWithPolicy(numericValue, policy);
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

    if (!Core.areExpressionNodesEquivalentIgnoringParentheses(expression.left, expression.right)) {
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
        if (denominatorValue === null || !Core.areNumbersApproximatelyEqual(denominatorValue, 2)) {
            return null;
        }

        return unwrapParenthesized(expression.left);
    }

    if (expression.operator !== "*") {
        return null;
    }

    const leftValue = tryReadNumericLiteralValue(expression.left);
    if (leftValue !== null && Core.areNumbersApproximatelyEqual(leftValue, 0.5)) {
        return unwrapParenthesized(expression.right);
    }

    const rightValue = tryReadNumericLiteralValue(expression.right);
    if (rightValue !== null && Core.areNumbersApproximatelyEqual(rightValue, 0.5)) {
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
        !Core.areExpressionNodesEquivalentIgnoringParentheses(baseExpression, subtrahendBaseExpression) ||
        !Core.areExpressionNodesEquivalentIgnoringParentheses(baseExpression, callBaseExpression)
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

/**
 * Format a numeric value into the canonical GML literal text using the
 * supplied {@link NumericLiteralCanonicalFormPolicy}. The policy controls two
 * distinct thresholds:
 *
 * - `epsilon` widens the "close to integer" check so callers can tighten or
 *   loosen the rounding window that promotes `1.0000000001` → `"1"`.
 * - `maxCanonicalFormValue` switches the formatter to exponential notation
 *   for very large magnitudes where fixed notation would lose precision.
 *
 * `DEFAULT_NUMERIC_LITERAL_POLICY` matches the previous hardcoded
 * `Core.areNumbersApproximatelyEqual` behaviour, so callers that have not
 * opted into the rule's `epsilon` / `maxCanonicalFormValue` options observe
 * byte-for-byte identical output to the previous implementation.
 */
function formatCanonicalNumericLiteralWithPolicy(
    value: number,
    policy: NumericLiteralCanonicalFormPolicy
): string | null {
    if (!Number.isFinite(value)) {
        return null;
    }

    if (Object.is(value, -0) || value === 0) {
        return "0";
    }

    const roundedInteger = Math.round(value);
    if (Math.abs(value - roundedInteger) <= policy.epsilon) {
        return roundedInteger.toString();
    }

    if (Math.abs(value) > policy.maxCanonicalFormValue) {
        return value.toExponential(6);
    }

    return Number(value.toPrecision(12)).toString();
}

function tryBuildGroupedRatioProductReplacement(
    sourceText: string,
    node: unknown,
    policy: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
): string | null {
    const expression = unwrapParenthesized(node);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "/") {
        return null;
    }

    const divisorValue = tryReadNumericLiteralValue(expression.right);
    if (divisorValue === null || Core.areNumbersApproximatelyEqual(divisorValue, 0)) {
        return null;
    }

    const ratioMultiplierMatch = tryMatchRatioMultiplier(expression.left);
    if (!ratioMultiplierMatch) {
        return null;
    }

    const scaledMultiplier = ratioMultiplierMatch.multiplier / divisorValue;
    const multiplierText = formatCanonicalNumericLiteralWithPolicy(scaledMultiplier, policy);
    const ratioText = gmlRuleAutofixServices.readNodeText(sourceText, ratioMultiplierMatch.ratioExpression);
    if (!multiplierText || !ratioText) {
        return null;
    }

    return `(${trimOuterParentheses(ratioText)}) * ${multiplierText}`;
}

function applySourceAwareCanonicalMathReplacement(
    sourceText: string,
    node: unknown,
    replacement: string,
    policy: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
): string {
    const halfLengthdirReplacement = tryBuildHalfLengthdirDifferenceReplacement(sourceText, node);
    if (halfLengthdirReplacement) {
        return halfLengthdirReplacement;
    }

    const groupedRatioReplacement = tryBuildGroupedRatioProductReplacement(sourceText, node, policy);
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

function performHalfLengthdirOptimizations(bodyStatements: any[], sourceText: string, edits: SourceTextEdit[]) {
    for (let index = 0; index + 1 < bodyStatements.length; index += 1) {
        const current = bodyStatements[index];
        const next = bodyStatements[index + 1];
        const declarator = getVariableDeclarator(current);
        if (!declarator || !isAstNodeRecord(declarator.id) || !declarator.init) {
            continue;
        }

        if (declarator.id.type !== "Identifier" || typeof declarator.id.name !== "string") {
            continue;
        }
        const variableName = declarator.id.name;

        const nextExpression = unwrapExpressionStatement(next);
        if (
            !nextExpression ||
            nextExpression.type !== "AssignmentExpression" ||
            nextExpression.operator !== "=" ||
            unwrapParenthesized(nextExpression.left)?.type !== "Identifier" ||
            unwrapParenthesized(nextExpression.left)?.name !== variableName
        ) {
            continue;
        }

        const rotationExpression = extractHalfLengthdirRotationExpression(
            nextExpression.right,
            variableName,
            sourceText
        );
        if (!rotationExpression) {
            continue;
        }

        const initComponents = collectMultiplicativeComponents(sourceText, declarator.init);
        if (!initComponents) {
            continue;
        }

        const rewrittenInit = buildMultiplicativeExpression(
            Object.freeze({
                coefficient: initComponents.coefficient * 0.5,
                factors: initComponents.factors
            })
        );
        const fullInit = `${rewrittenInit} * (1 - lengthdir_x(1, ${rotationExpression}))`;
        const initStart = getNodeStartIndex(declarator.init);
        const initEnd = getNodeEndIndex(declarator.init);
        const assignmentStart = getNodeStartIndex(next);
        const assignmentEnd = getNodeEndIndex(next);
        if (
            typeof initStart !== "number" ||
            typeof initEnd !== "number" ||
            typeof assignmentStart !== "number" ||
            typeof assignmentEnd !== "number"
        ) {
            continue;
        }

        let assignmentRemovalEnd = assignmentEnd;
        while (
            assignmentRemovalEnd < sourceText.length &&
            (sourceText[assignmentRemovalEnd] === ";" ||
                sourceText[assignmentRemovalEnd] === " " ||
                sourceText[assignmentRemovalEnd] === "\t")
        ) {
            assignmentRemovalEnd += 1;
        }
        if (sourceText[assignmentRemovalEnd] === "\n") {
            assignmentRemovalEnd += 1;
        }

        edits.push(
            {
                start: initStart,
                end: initEnd,
                text: fullInit
            },
            {
                start: assignmentStart,
                end: assignmentRemovalEnd,
                text: ""
            }
        );
    }
}

/**
 * Schedule a source-text removal for {@link node} by pushing an edit that blanks the
 * node's text span, including any trailing semicolons, horizontal whitespace, and the
 * immediately following newline so the output stays clean.
 */
function scheduleNodeRemoval(node: unknown, sourceText: string, edits: SourceTextEdit[]): boolean {
    const start = getNodeStartIndex(node);
    const end = getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return false;
    }
    let removalEnd = end;
    while (
        removalEnd < sourceText.length &&
        (sourceText[removalEnd] === ";" ||
            sourceText[removalEnd] === " " ||
            sourceText[removalEnd] === "\t" ||
            sourceText[removalEnd] === "\r")
    ) {
        removalEnd += 1;
    }
    if (sourceText[removalEnd] === "\n") {
        removalEnd += 1;
    }
    edits.push({ start, end: removalEnd, text: "" });
    return true;
}

function performDeadCodeElimination(bodyStatements: any[], sourceText: string, edits: SourceTextEdit[]) {
    const updatesByVariable = new Map<string, { delta: number; indices: number[] }>();

    const applyRemovals = (info: { delta: number; indices: number[] }) => {
        if (Math.abs(info.delta) < 1e-10 && info.indices.length > 0) {
            for (const idx of info.indices) {
                scheduleNodeRemoval(bodyStatements[idx], sourceText, edits);
            }
        }
    };

    for (let i = 0; i < bodyStatements.length; i++) {
        const stmt = bodyStatements[i];
        // some increment/decrement statements are represented as standalone
        // `IncDecStatement` nodes rather than wrapped expressions
        let expr = unwrapExpressionStatement(stmt);
        if (!expr && stmt && stmt.type === "IncDecStatement") {
            expr = stmt;
        }
        let handled = false;

        if (expr && (expr.type === "UpdateExpression" || expr.type === "IncDecStatement")) {
            const arg = expr.argument;
            const idNode = unwrapParenthesized(arg);
            if (isIdentifierNode(idNode)) {
                const name = idNode.name;
                const current = updatesByVariable.get(name) || { delta: 0, indices: [] };
                current.delta += expr.operator === "++" ? 1 : -1;
                current.indices.push(i);
                updatesByVariable.set(name, current);
                handled = true;
            }
        } else if (expr && expr.type === "AssignmentExpression") {
            const idNode = unwrapParenthesized(expr.left);
            if (isIdentifierNode(idNode)) {
                const name = idNode.name;
                switch (expr.operator) {
                    case "+=":
                    case "-=": {
                        const val = tryEvaluateNumericExpression(expr.right);
                        if (val !== null) {
                            const current = updatesByVariable.get(name) || { delta: 0, indices: [] };
                            current.delta += expr.operator === "+=" ? val : -val;
                            current.indices.push(i);
                            updatesByVariable.set(name, current);
                            handled = true;
                        }
                        break;
                    }
                    case "*=":
                    case "/=": {
                        const val = tryEvaluateNumericExpression(expr.right);
                        // Strict === 1 catches the common exact case without epsilon overhead.
                        // Epsilon-tolerant check handles the floating-point edge case where
                        // rounding error produces a value like 0.9999999999999998 instead of 1.
                        // Without this tolerance, expressions like `x *= 1 - 1e-16` or `x /= 1 + 1e-15`
                        // would silently bypass the optimization and produce incorrect output.
                        if (val === 1 || Core.areNumbersApproximatelyEqual(val, 1)) {
                            scheduleNodeRemoval(stmt, sourceText, edits);
                            handled = true;
                        }
                        break;
                    }
                    case "=": {
                        const info = updatesByVariable.get(name);
                        if (info) {
                            applyRemovals(info);
                            updatesByVariable.delete(name);
                            handled = true;
                        }
                        break;
                    }
                }
            }
        }

        if (!handled || i === bodyStatements.length - 1) {
            for (const info of updatesByVariable.values()) {
                applyRemovals(info);
            }
            updatesByVariable.clear();
        }
    }
}

/**
 * Attempt to run the full manual-math normalization pipeline on a single
 * expression node and return the resulting source text if it changed.
 *
 * @param sourceText - Full source text being linted; used as the working
 *   buffer for cloned expressions and as context for downstream helpers.
 * @param node - The AST node to attempt to normalize.
 * @param policyOverride - Optional partial {@link MathNumericPolicy} override.
 *   When supplied, the reciprocal/divisor thresholds used by the math
 *   transforms are tightened or relaxed accordingly. This lets the rule
 *   caller (or a future ESLint schema option) tune the precision
 *   sensitivity of the rewrite without modifying the transform modules.
 */
function attemptManualNormalization(sourceText: string, node: any, policyOverride?: unknown): string | null {
    const clone = Core.cloneAstNode(node) as MutableGameMakerAstNode;
    if (!clone) {
        return null;
    }

    const policy = resolveMathNumericPolicy(policyOverride);
    const context = { sourceText, mathNumericPolicy: policy };
    applyDivisionToMultiplication(clone, policy);
    applyManualMathNormalization(clone, context);
    applyScalarCondensing(clone, context);
    simplifyZeroDivisionNumerators(clone, context as any);
    cleanupMultiplicativeIdentityParentheses(clone, context);

    const original = gmlRuleAutofixServices.readNodeText(sourceText, node) || "";
    if (Core.areExpressionNodesEquivalentIgnoringParentheses(node, clone)) {
        return null;
    }

    const printed = gmlRuleAutofixServices.printExpression(clone, sourceText);
    if (!printed) {
        return null;
    }

    if (trimOuterParentheses(original) === trimOuterParentheses(printed)) {
        return null;
    }

    return printed;
}

function shouldSkipBinaryExpressionCandidate(parentNode: unknown, parentKey: string | null): boolean {
    return evaluateSkipDecision(parentNode, parentKey);
}

function performGeneralExpressionSimplification(
    node: any,
    sourceText: string,
    edits: SourceTextEdit[],
    policy: NumericLiteralCanonicalFormPolicy = DEFAULT_NUMERIC_LITERAL_POLICY
) {
    const normalizedExpressionRanges: SourceTextRange[] = [];
    const commentTokenRangeIndex = createCommentTokenRangeIndex(sourceText);
    const replacementByCandidateText = new Map<string, string | null>();
    let lastScheduledEdit: SourceTextEdit | null = null;

    walkAstNodesWithParent(node, (visitContext) => {
        const { node: visitedNode, parent, parentKey } = visitContext;

        let targetNode: any = null;
        let isIfTest = false;

        if (visitedNode.type === "VariableDeclarator" && visitedNode.init) {
            targetNode = visitedNode.init;
        } else
            switch (visitedNode.type) {
                case "AssignmentExpression": {
                    targetNode = visitedNode.right;

                    break;
                }
                case "IfStatement": {
                    targetNode = visitedNode.test;
                    isIfTest = true;

                    break;
                }
                case "ReturnStatement": {
                    targetNode = visitedNode.argument;
                    break;
                }
                case "ParenthesizedExpression": {
                    const expression = unwrapParenthesized(visitedNode);
                    if (
                        expression?.type === "BinaryExpression" &&
                        (parent as { type?: unknown } | null)?.type === "CallExpression" &&
                        parentKey === "arguments"
                    ) {
                        targetNode = visitedNode;
                    }
                    break;
                }
                case "BinaryExpression": {
                    if (shouldSkipBinaryExpressionCandidate(parent, parentKey)) {
                        break;
                    }

                    targetNode = visitedNode;

                    break;
                }
                // No default
            }

        if (targetNode) {
            const start = getNodeStartIndex(targetNode);
            const end = getNodeEndIndex(targetNode);
            if (typeof start !== "number" || typeof end !== "number") {
                return;
            }

            const targetRange: SourceTextRange = { start, end };
            if (isRangeInsideAnyRange(targetRange, normalizedExpressionRanges)) {
                return;
            }

            if (!canAstShapeContainMathOptimizationCandidate(targetNode)) {
                return;
            }

            const fastDotProductReplacement = tryBuildFastDotProductReplacement(sourceText, targetNode);
            if (
                fastDotProductReplacement &&
                !rangeContainsCommentToken(commentTokenRangeIndex, start, end) &&
                !hasOverlapWithLastScheduledEdit(start, end, lastScheduledEdit) &&
                !hasOverlappingRange(start, end, edits)
            ) {
                const replacementText =
                    isIfTest && !fastDotProductReplacement.startsWith("(")
                        ? `(${fastDotProductReplacement})`
                        : fastDotProductReplacement;
                const scheduledEdit = { start, end, text: replacementText };
                edits.push(scheduledEdit);
                lastScheduledEdit = scheduledEdit;
                normalizedExpressionRanges.push(targetRange);
                return;
            }

            const sourceTextOfNode = gmlRuleAutofixServices.readNodeText(sourceText, targetNode);
            if (sourceTextOfNode) {
                if (hasComment(targetNode)) {
                    return;
                }

                if (
                    rangeContainsCommentToken(commentTokenRangeIndex, start, end) &&
                    containsCommentSyntax(sourceTextOfNode)
                ) {
                    return;
                }

                if (!containsMathOptimizationSyntax(sourceTextOfNode)) {
                    return;
                }

                // Large expressions can trigger prohibitively expensive normalization
                // paths and unbounded allocation spikes without providing practical
                // autofix value in a single lint pass.
                if (sourceTextOfNode.length > MAX_MATH_OPTIMIZATION_CANDIDATE_TEXT_LENGTH) {
                    return;
                }

                const replacementCacheKey = `${targetNode.type}:${sourceTextOfNode}`;
                let replacement = replacementByCandidateText.get(replacementCacheKey);
                if (replacement === undefined) {
                    let shouldApplyCanonicalSourceAwareReplacement = true;

                    if (NUMERIC_LITERAL_SIGNAL_PATTERN.test(sourceTextOfNode)) {
                        replacement = tryBuildConstantNumericReplacement(sourceText, targetNode, policy);
                    }

                    if (!replacement) {
                        replacement = tryBuildFastDotProductReplacement(sourceText, targetNode);
                        if (replacement) {
                            shouldApplyCanonicalSourceAwareReplacement = false;
                        }
                    }

                    if (
                        !replacement &&
                        evaluateMathOptimizationCandidate({
                            sourceText: sourceTextOfNode,
                            nodeType: targetNode.type
                        }).shouldAttemptManualNormalization
                    ) {
                        replacement = attemptManualNormalization(sourceText, targetNode);
                    }

                    if (!replacement && DIVISION_BASED_OPTIMIZATION_SIGNAL_PATTERN.test(sourceTextOfNode)) {
                        replacement = simplifyMathExpression(sourceText, targetNode, sourceTextOfNode);
                    } else if (replacement && DIVISION_BASED_OPTIMIZATION_SIGNAL_PATTERN.test(sourceTextOfNode)) {
                        const divisionFallbackReplacement = simplifyMathExpression(
                            sourceText,
                            targetNode,
                            sourceTextOfNode
                        );
                        if (
                            divisionFallbackReplacement &&
                            countDivisionLikeOperators(divisionFallbackReplacement) <
                                countDivisionLikeOperators(replacement)
                        ) {
                            replacement = divisionFallbackReplacement;
                            shouldApplyCanonicalSourceAwareReplacement = true;
                        }
                    }

                    replacement =
                        replacement && replacement !== sourceTextOfNode
                            ? shouldApplyCanonicalSourceAwareReplacement
                                ? applySourceAwareCanonicalMathReplacement(sourceText, targetNode, replacement, policy)
                                : replacement
                            : null;

                    replacementByCandidateText.set(replacementCacheKey, replacement);
                }

                if (replacement && replacement !== sourceTextOfNode) {
                    if (isIfTest && !replacement.startsWith("(")) {
                        replacement = `(${replacement})`;
                    }

                    if (
                        !hasOverlapWithLastScheduledEdit(start, end, lastScheduledEdit) &&
                        !hasOverlappingRange(start, end, edits)
                    ) {
                        const scheduledEdit = { start, end, text: replacement };
                        edits.push(scheduledEdit);
                        lastScheduledEdit = scheduledEdit;
                        normalizedExpressionRanges.push(targetRange);
                    }
                }
            }
        }
    });
}

/**
 * Resolve rule-level `epsilon` / `maxCanonicalFormValue` options into a fully
 * populated {@link NumericLiteralCanonicalFormPolicy}.
 *
 * Both fields are clamped into the same `[minimum, Infinity)` range that the
 * rule schema enforces, so user-supplied overrides cannot disable the safety
 * floor by passing zero, negative numbers, or values just above zero. Values
 * outside the schema's accepted range fall back to the corresponding field
 * of {@link DEFAULT_NUMERIC_LITERAL_POLICY}, preserving the opt-in
 * non-breaking contract that the other lint rules use.
 */
function resolveOptimizeMathExpressionsPolicyFromOptions(
    options: Record<string, unknown>
): NumericLiteralCanonicalFormPolicy {
    const { epsilon, maxCanonicalFormValue } = options;

    const resolvedEpsilon =
        typeof epsilon === "number" && Number.isFinite(epsilon) && epsilon >= MIN_OPTIMIZE_MATH_EPSILON
            ? epsilon
            : DEFAULT_NUMERIC_LITERAL_POLICY.epsilon;

    const resolvedMaxCanonicalFormValue =
        typeof maxCanonicalFormValue === "number" &&
        Number.isFinite(maxCanonicalFormValue) &&
        maxCanonicalFormValue >= MIN_OPTIMIZE_MATH_MAX_CANONICAL_FORM_VALUE
            ? maxCanonicalFormValue
            : DEFAULT_NUMERIC_LITERAL_POLICY.maxCanonicalFormValue;

    if (
        resolvedEpsilon === DEFAULT_NUMERIC_LITERAL_POLICY.epsilon &&
        resolvedMaxCanonicalFormValue === DEFAULT_NUMERIC_LITERAL_POLICY.maxCanonicalFormValue
    ) {
        return DEFAULT_NUMERIC_LITERAL_POLICY;
    }

    return Object.freeze({
        epsilon: resolvedEpsilon,
        maxCanonicalFormValue: resolvedMaxCanonicalFormValue
    });
}

export function createOptimizeMathExpressionsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const numericLiteralPolicy = resolveOptimizeMathExpressionsPolicyFromOptions(readObjectOption(context));
            return Object.freeze({
                Program(node) {
                    const sourceText = context.sourceCode.text;
                    const edits: SourceTextEdit[] = [];

                    // Run the block-based optimizations on every place in the AST that
                    // carries a `body` array. Previously we only processed the root
                    // program node, which meant transformations inside functions were
                    // silently skipped. Recursing via the walker ensures nested code
                    // such as `handle_lighting` (see testFunctions) is also rewritten.
                    walkAstNodesWithParent(node, ({ node: subNode }) => {
                        if (subNode && Array.isArray((subNode as any).body)) {
                            const stmts: any[] = (subNode as any).body;
                            performHalfLengthdirOptimizations(stmts, sourceText, edits);
                            performDeadCodeElimination(stmts, sourceText, edits);
                        }
                    });

                    performGeneralExpressionSimplification(node, sourceText, edits, numericLiteralPolicy);

                    let rewrittenByAstEdits = sourceText;
                    if (edits.length > 0) {
                        const deduplicated: SourceTextEdit[] = [];
                        let deduplicatedLastEnd = -1;
                        for (const edit of edits.toSorted(
                            (left, right) => left.start - right.start || left.end - right.end
                        )) {
                            if (edit.start < deduplicatedLastEnd) {
                                continue;
                            }

                            deduplicated.push(edit);
                            deduplicatedLastEnd = edit.end;
                        }

                        rewrittenByAstEdits = applySourceTextEdits(sourceText, deduplicated);
                    }

                    const rewrittenText = rewriteManualMathCanonicalForms(rewrittenByAstEdits);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
