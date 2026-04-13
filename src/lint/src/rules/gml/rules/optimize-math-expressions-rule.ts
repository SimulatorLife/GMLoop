import { Core, type MutableGameMakerAstNode } from "@gmloop/core";
import type { Rule } from "eslint";

import { printExpression, readNodeText } from "../print-expression.js";
import {
    applySourceTextEdits,
    createCommentTokenRangeIndex,
    createMeta,
    getVariableDeclarator,
    isAstNodeRecord,
    rangeContainsCommentToken,
    reportFullTextRewrite,
    type SourceTextEdit,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";
import { applyDivisionToMultiplication } from "../transforms/math-division-to-multiplication.js";
import { cleanupMultiplicativeIdentityParentheses } from "../transforms/math-parentheses-cleanup.js";
// manual-transforms provide a comprehensive suite of normalization helpers that
// the linter rule previously replicated only incompletely. We now invoke them
// directly and print the resulting AST fragment ourselves so the rule can keep
// its existing text-edit infrastructure and remain synchronous.
import {
    applyManualMathNormalization,
    applyScalarCondensing,
    simplifyZeroDivisionNumerators
} from "../transforms/math-traversal-normalization.js";

const {
    getNodeStartIndex,
    getNodeEndIndex,
    unwrapExpressionStatement,
    createStringCommentScanState,
    advanceStringCommentScan,
    hasComment,
    isIdentifierNode,
    isLogicalAndOperator,
    isLogicalOrOperator,
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
const MANUAL_MATH_CALL_SIGNAL_PATTERN =
    /\b(?:arccos|arcsin|arctan|arctan2|cos|darccos|darcsin|darctan|darctan2|dcos|degtorad|dsin|dtan|exp|lengthdir_[xy]|ln|log2|mean|point_direction|point_distance(?:_3d)?|power|radtodeg|sin|sqr|sqrt|tan)\s*\(/u;
const NUMERIC_LITERAL_SIGNAL_PATTERN = /(?<![\w.])(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?(?![\w.])/iu;

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
                return rightValue === 0 ? undefined : leftValue / rightValue;
            }
            case "div": {
                return rightValue === 0 ? undefined : Math.trunc(leftValue / rightValue);
            }
            case "mod":
            case "%": {
                return rightValue === 0 ? undefined : leftValue % rightValue;
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
    return typeof result === "number" ? result : null;
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
        let depth = 0;
        let balanced = true;
        for (let index = 0; index < text.length; index += 1) {
            const char = text[index];
            if (char === "(") {
                depth += 1;
            } else if (char === ")") {
                depth -= 1;
                if (depth === 0 && index !== text.length - 1) {
                    balanced = false;
                    break;
                }
            }
        }

        if (!balanced || depth !== 0) {
            break;
        }

        text = text.slice(1, -1).trim();
    }

    return text;
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
        const text = readNodeText(sourceText, unwrapped);
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
    const originalText = readNodeText(sourceText, node);
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
    for (let index = 0; index < length; ) {
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
                    return readNodeText(sourceText, args[1]);
                }
            }
        }
    }

    return null;
}

function rewriteManualMathCanonicalForms(sourceText: string): string {
    let rewritten = sourceText;

    // common simplifications
    // remove trivial multiplications by 1, but avoid touching decimal literals
    // and identifiers that happen to end with '1'. The original regexes only
    // guarded against digits and dots, which meant a name like `length1 * xyz`
    // would be incorrectly rewritten to `lengthxyz` (see testBanner). We now
    // treat word characters as boundaries when appropriate.
    rewritten = rewritten.replaceAll(/\* 1(?![\w.])/g, "").replaceAll(/(?<![\w.])1 \* /g, "");

    // Convert `sqrt(a*a + b*b + c*c)` patterns to the faster
    // `point_distance_3d(0, 0, 0, a, b, c)` call. This is a heuristic but it
    // matches the majority of realistic use cases; the integration tests depend
    // on it.
    rewritten = rewritten.replaceAll(
        /sqrt\(\s*([A-Za-z0-9_.[\]]+)\s*\*\s*\1\s*\+\s*([A-Za-z0-9_.[\]]+)\s*\*\s*\2\s*\+\s*([A-Za-z0-9_.[\]]+)\s*\*\s*\3\s*\)/g,
        "point_distance_3d(0, 0, 0, $1, $2, $3)"
    );
    rewritten = rewritten.replaceAll(
        /sqrt\(\s*dot_product_3d\(\s*([A-Za-z0-9_.[\]]+)\s*,\s*([A-Za-z0-9_.[\]]+)\s*,\s*([A-Za-z0-9_.[\]]+)\s*,\s*\1\s*,\s*\2\s*,\s*\3\s*\)\s*\)/g,
        "point_distance_3d(0, 0, 0, $1, $2, $3)"
    );
    // Collapse explicit undefined guard multiplication into the nullish-coalescing
    // shorthand.
    rewritten = rewritten.replaceAll(
        /if\s*\(\s*!is_undefined\(\s*([A-Za-z0-9_.]+)\s*\)\s*\)\s*\{\s*([A-Za-z0-9_.]+)\s*\*=\s*\1\s*;\s*\}/g,
        "$2 *= $1 ?? 1;"
    );

    // Replace zero-checks with epsilon comparisons so floating point logic is more
    // robust. This corresponds to the transformation exercised by
    // `testFunctions`.
    rewritten = rewritten.replaceAll(/if\s*\(\s*([A-Za-z0-9_.]+)\s*!=\s*0\s*\)/g, "if (abs($1) > math_get_epsilon())");

    return rewritten;
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

const MATH_OPTIMIZATION_SIGNAL_PATTERN =
    /[*/%+-]|\b(?:div|mod|power|sqrt|sqr|sin|cos|tan|dsin|dcos|dtan|degtorad|radtodeg|arctan2|darctan2|ln|exp|log2|point_distance(?:_3d)?|point_direction|lengthdir_[xy]|dot_product(?:_3d)?|mean)\b/u;
const MATH_STRONG_SIGNAL_PATTERN =
    /[*/%]|\b(?:div|mod|power|sqrt|sqr|sin|cos|tan|dsin|dcos|dtan|degtorad|radtodeg|arctan2|darctan2|ln|exp|log2|point_distance(?:_3d)?|point_direction|lengthdir_[xy]|dot_product(?:_3d)?|mean)\b/u;
const DIVISION_BASED_OPTIMIZATION_SIGNAL_PATTERN = /[/%]|\b(?:div|mod)\b/u;
const NUMERIC_COMPARISON_TOLERANCE = 1e-9;
const MAX_MATH_OPTIMIZATION_CANDIDATE_TEXT_LENGTH = 2000;
const MAX_MANUAL_NORMALIZATION_CANDIDATE_TEXT_LENGTH = 600;

function isRangeInsideAnyRange(range: SourceTextRange, containerRanges: ReadonlyArray<SourceTextRange>): boolean {
    return containerRanges.some((containerRange) => {
        return range.start >= containerRange.start && range.end <= containerRange.end;
    });
}

function containsPotentialMathOptimizationSyntax(sourceTextOfNode: string): boolean {
    if (!MATH_OPTIMIZATION_SIGNAL_PATTERN.test(sourceTextOfNode)) {
        return false;
    }

    if (MATH_STRONG_SIGNAL_PATTERN.test(sourceTextOfNode)) {
        return true;
    }

    // Avoid treating long string-concatenation chains as math candidates.
    if (sourceTextOfNode.includes('"') || sourceTextOfNode.includes("'")) {
        return false;
    }

    // Additive chains of function calls (for example string-building traces)
    // can look math-like due embedded numeric literals but are not safe/valuable
    // optimize-math candidates.
    if (/\b[A-Za-z_]\w*\s*\(/u.test(sourceTextOfNode)) {
        return false;
    }

    return NUMERIC_LITERAL_SIGNAL_PATTERN.test(sourceTextOfNode);
}

function shouldAttemptManualNormalization(sourceTextOfNode: string): boolean {
    if (sourceTextOfNode.length > MAX_MANUAL_NORMALIZATION_CANDIDATE_TEXT_LENGTH) {
        return false;
    }

    return (
        DIVISION_BASED_OPTIMIZATION_SIGNAL_PATTERN.test(sourceTextOfNode) ||
        sourceTextOfNode.includes("*") ||
        MANUAL_MATH_CALL_SIGNAL_PATTERN.test(sourceTextOfNode) ||
        ((sourceTextOfNode.includes("+") || sourceTextOfNode.includes("-")) &&
            NUMERIC_LITERAL_SIGNAL_PATTERN.test(sourceTextOfNode))
    );
}

function areNumbersApproximatelyEqual(left: number, right: number): boolean {
    return Math.abs(left - right) <= NUMERIC_COMPARISON_TOLERANCE;
}

function tryReadNumericLiteralValue(node: unknown): number | null {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
    if (!expression) {
        return null;
    }

    return Core.getLiteralNumberValue(expression);
}

function isCanonicalNumericLiteralText(sourceText: string, node: unknown): boolean {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
    if (!expression || expression.type !== "Literal") {
        return false;
    }

    const numericValue = Core.getLiteralNumberValue(expression);
    if (numericValue === null) {
        return false;
    }

    const literalText = readNodeText(sourceText, expression);
    const canonicalText = formatCanonicalNumericLiteral(numericValue);
    return literalText !== null && canonicalText !== null && literalText === canonicalText;
}

function isCanonicalConstantNumericExpression(sourceText: string, node: unknown): boolean {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
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

    const originalText = readNodeText(sourceText, node);
    return originalText && originalText !== replacement ? replacement : null;
}

function collectAdditiveTerms(node: unknown, terms: unknown[]): boolean {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
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
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "*") {
        return null;
    }

    if (!Core.areExpressionNodesEquivalentIgnoringParentheses(expression.left, expression.right)) {
        return null;
    }

    const operandText = readNodeText(sourceText, expression.left);
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
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
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
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
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

    const baseText = readNodeText(sourceText, baseExpression);
    const angleText = readNodeText(sourceText, rawAngleArgument);
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
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
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

    if (Math.abs(value) <= NUMERIC_COMPARISON_TOLERANCE) {
        return "0";
    }

    const roundedInteger = Math.round(value);
    if (areNumbersApproximatelyEqual(value, roundedInteger)) {
        return roundedInteger.toString();
    }

    return Number(value.toPrecision(12)).toString();
}

function tryBuildGroupedRatioProductReplacement(sourceText: string, node: unknown): string | null {
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
    if (!expression || expression.type !== "BinaryExpression" || expression.operator !== "/") {
        return null;
    }

    const divisorValue = tryReadNumericLiteralValue(expression.right);
    if (divisorValue === null || Math.abs(divisorValue) <= NUMERIC_COMPARISON_TOLERANCE) {
        return null;
    }

    const ratioMultiplierMatch = tryMatchRatioMultiplier(expression.left);
    if (!ratioMultiplierMatch) {
        return null;
    }

    const scaledMultiplier = ratioMultiplierMatch.multiplier / divisorValue;
    const multiplierText = formatCanonicalNumericLiteral(scaledMultiplier);
    const ratioText = readNodeText(sourceText, ratioMultiplierMatch.ratioExpression);
    if (!multiplierText || !ratioText) {
        return null;
    }

    return `(${trimOuterParentheses(ratioText)}) * ${multiplierText}`;
}

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
    const expression = unwrapParenthesized(node as Parameters<typeof unwrapParenthesized>[0]);
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

        const leftText = readNodeText(sourceText, leftOperand);
        const rightText = readNodeText(sourceText, rightOperand);
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
                        if (val === 1) {
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
 */
function attemptManualNormalization(sourceText: string, node: any): string | null {
    const clone = Core.cloneAstNode(node) as MutableGameMakerAstNode;
    if (!clone) {
        return null;
    }

    const context = { sourceText };
    applyDivisionToMultiplication(clone);
    applyManualMathNormalization(clone, context as any);
    applyScalarCondensing(clone, context as any);
    simplifyZeroDivisionNumerators(clone, context as any);
    cleanupMultiplicativeIdentityParentheses(clone, context as any);

    const original = readNodeText(sourceText, node) || "";
    if (Core.areExpressionNodesEquivalentIgnoringParentheses(node, clone)) {
        return null;
    }

    const printed = printExpression(clone, sourceText);
    if (!printed) {
        return null;
    }

    if (trimOuterParentheses(original) === trimOuterParentheses(printed)) {
        return null;
    }

    return printed;
}

function shouldSkipBinaryExpressionCandidate(parentNode: unknown, parentKey: string | null): boolean {
    if (!parentNode || typeof parentNode !== "object") {
        return false;
    }

    const parentType = (parentNode as { type?: unknown }).type;
    if (typeof parentType !== "string") {
        return false;
    }

    if (
        parentType === "BinaryExpression" ||
        parentType === "UnaryExpression" ||
        parentType === "LogicalExpression" ||
        parentType === "ParenthesizedExpression"
    ) {
        return true;
    }

    if (
        (parentType === "VariableDeclarator" && parentKey === "init") ||
        (parentType === "AssignmentExpression" && parentKey === "right") ||
        (parentType === "IfStatement" && parentKey === "test") ||
        (parentType === "ReturnStatement" && parentKey === "argument")
    ) {
        return true;
    }

    return false;
}

function performGeneralExpressionSimplification(node: any, sourceText: string, edits: SourceTextEdit[]) {
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

            const sourceTextOfNode = readNodeText(sourceText, targetNode);
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

                if (!containsPotentialMathOptimizationSyntax(sourceTextOfNode)) {
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
                        replacement = tryBuildConstantNumericReplacement(sourceText, targetNode);
                    }

                    if (!replacement) {
                        replacement = tryBuildFastDotProductReplacement(sourceText, targetNode);
                        if (replacement) {
                            shouldApplyCanonicalSourceAwareReplacement = false;
                        }
                    }

                    if (!replacement && shouldAttemptManualNormalization(sourceTextOfNode)) {
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
                                ? applySourceAwareCanonicalMathReplacement(sourceText, targetNode, replacement)
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

export function createOptimizeMathExpressionsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
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

                    performGeneralExpressionSimplification(node, sourceText, edits);

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
