import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { gmlRuleAutofixServices } from "../gml-rule-services.js";
import {
    type AstNodeRecord,
    createMeta,
    isAstNodeRecord,
    isAstNodeWithType,
    shouldReportUnsafe
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

const { unwrapParenthesizedExpression } = Core;
type UnwrapParenthesizedExpressionInput = Parameters<typeof Core.unwrapParenthesizedExpression>[0];

function isStringLiteralExpression(expression: unknown): boolean {
    if (!isAstNodeRecord(expression) || expression.type !== "Literal") {
        return false;
    }
    if (typeof expression.value !== "string") {
        return false;
    }
    const raw = expression.value;
    if (raw.length < 2) {
        return false;
    }
    const first = raw.charAt(0);
    const last = raw.at(-1);
    if (first !== last) {
        return false;
    }
    if (first === '"' || first === "'") {
        return true;
    }
    return first === "@" && raw.charAt(1) === '"' && last === '"';
}

function isBinaryStringConcatenationExpression(node: unknown): node is AstNodeRecord {
    return isAstNodeRecord(node) && node.type === "BinaryExpression" && node.operator === "+";
}

function isTemplateStringExpression(node: unknown): node is AstNodeRecord {
    return isAstNodeRecord(node) && node.type === "TemplateStringExpression";
}

function isTemplateStringTextAtom(node: unknown): node is AstNodeRecord {
    return isAstNodeRecord(node) && node.type === "TemplateStringText" && typeof node.value === "string";
}

function getNodeTextFromContext(context: Rule.RuleContext, astNode: any): string {
    if (typeof context.getSourceCode === "function") {
        return context.getSourceCode().getText(astNode);
    }
    if (isAstNodeRecord(astNode) && Array.isArray(astNode.range)) {
        const txt = context.sourceCode.text;
        const [start, end] = astNode.range;
        if (typeof start === "number" && typeof end === "number") {
            return txt.slice(start, end);
        }
    }
    return "";
}

function printInterpolationExpression(context: Rule.RuleContext, expressionNode: unknown): string {
    const sourceText = context.sourceCode.text;
    const printed = gmlRuleAutofixServices.printExpression(expressionNode, sourceText).trim();
    if (printed.length > 0) {
        return printed;
    }

    return getNodeTextFromContext(context, expressionNode).trim();
}

function extractStringLiteralText(context: Rule.RuleContext, literalNode: AstNodeRecord): string | null {
    if (!isStringLiteralExpression(literalNode)) {
        return null;
    }

    const text = getNodeTextFromContext(context, literalNode);
    if (text.length >= 2) {
        const first = text.charAt(0);
        const last = text.at(-1);
        if ((first === '"' || first === "'") && first === last) {
            return text.slice(1, -1);
        }
        if (first === "@" && text.charAt(1) === '"' && last === '"') {
            return text.slice(2, -1);
        }
    }

    const rawValue = literalNode.value;
    if (typeof rawValue !== "string") {
        return null;
    }
    if (rawValue.length < 2) {
        return "";
    }

    const first = rawValue.charAt(0);
    const last = rawValue.at(-1);
    if ((first === '"' || first === "'") && first === last) {
        return rawValue.slice(1, -1);
    }
    if (first === "@" && rawValue.charAt(1) === '"' && last === '"') {
        return rawValue.slice(2, -1);
    }

    return null;
}

function collectConcatenationParts(node: unknown, output: Array<unknown>): void {
    const candidate = unwrapParenthesizedExpression(node as UnwrapParenthesizedExpressionInput);
    if (isBinaryStringConcatenationExpression(candidate)) {
        collectConcatenationParts(candidate.left, output);
        collectConcatenationParts(candidate.right, output);
        return;
    }

    output.push(candidate);
}

function isStringFunctionCallExpression(node: unknown): node is AstNodeRecord {
    if (!isAstNodeRecord(node) || node.type !== "CallExpression" || !Array.isArray(node.arguments)) {
        return false;
    }

    const callee = node.callee;
    if (isAstNodeWithType(callee) && callee.type === "Identifier" && typeof callee.name === "string") {
        return callee.name.toLowerCase() === "string";
    }

    const object = node.object;
    if (isAstNodeWithType(object) && object.type === "Identifier" && typeof object.name === "string") {
        return object.name.toLowerCase() === "string";
    }

    return false;
}

function extractStringFunctionArgumentText(context: Rule.RuleContext, callNode: AstNodeRecord): string | null {
    const firstArgument =
        Array.isArray(callNode.arguments) && callNode.arguments.length > 0 ? callNode.arguments[0] : null;
    if (firstArgument === null) {
        return null;
    }

    const argumentText = printInterpolationExpression(context, firstArgument);
    if (argumentText.length === 0) {
        return null;
    }

    return argumentText;
}

type TemplateBuildState = {
    body: string;
    containsLiteralText: boolean;
    previousTextEndedWithColon: boolean;
};

function appendTemplateText(state: TemplateBuildState, text: string): void {
    state.body += text;
    if (text.length === 0) {
        return;
    }

    state.containsLiteralText = true;
    state.previousTextEndedWithColon = text.endsWith(":") && !/\s$/u.test(text);
}

function appendTemplateExpression(state: TemplateBuildState, expressionText: string): void {
    if (state.previousTextEndedWithColon) {
        state.body += " ";
    }
    state.body += `{${expressionText}}`;
    state.previousTextEndedWithColon = false;
}

function appendNestedTemplateAtoms(
    context: Rule.RuleContext,
    templateNode: AstNodeRecord,
    state: TemplateBuildState
): boolean {
    if (!Array.isArray(templateNode.atoms)) {
        return false;
    }

    for (const atom of templateNode.atoms) {
        if (isTemplateStringTextAtom(atom)) {
            appendTemplateText(state, atom.value as string);
            continue;
        }

        const atomText = getNodeTextFromContext(context, atom);
        if (atomText.length === 0) {
            return false;
        }

        appendTemplateExpression(state, atomText);
    }

    return true;
}

function buildTemplateBody(context: Rule.RuleContext, node: AstNodeRecord): string | null {
    const concatenationParts: Array<unknown> = [];
    collectConcatenationParts(node, concatenationParts);
    if (concatenationParts.length === 0) {
        return null;
    }

    const state: TemplateBuildState = {
        body: "",
        containsLiteralText: false,
        previousTextEndedWithColon: false
    };

    for (const part of concatenationParts) {
        const segment = unwrapParenthesizedExpression(part as UnwrapParenthesizedExpressionInput);

        if (isAstNodeRecord(segment) && isStringLiteralExpression(segment)) {
            const literalText = extractStringLiteralText(context, segment);
            if (literalText === null) {
                return null;
            }
            appendTemplateText(state, literalText);
            continue;
        }

        if (isTemplateStringExpression(segment)) {
            if (!appendNestedTemplateAtoms(context, segment, state)) {
                return null;
            }
            continue;
        }

        if (isStringFunctionCallExpression(segment)) {
            const expressionText = extractStringFunctionArgumentText(context, segment);
            if (expressionText === null || expressionText.length === 0) {
                return null;
            }
            appendTemplateExpression(state, expressionText);
            continue;
        }

        const expressionText = printInterpolationExpression(context, segment);
        if (expressionText.length === 0) {
            return null;
        }

        appendTemplateExpression(state, expressionText);
    }

    if (!state.containsLiteralText) {
        return null;
    }

    return state.body;
}

export function createPreferStringInterpolationRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const reportUnsafe = shouldReportUnsafe(context);
            const handledConcatenationRanges: Array<readonly [number, number]> = [];

            function expressionContainsUnsafeMutation(node: unknown): boolean {
                if (!node || typeof node !== "object") {
                    return false;
                }

                if (Array.isArray(node)) {
                    return node.some((entry) => expressionContainsUnsafeMutation(entry));
                }

                const candidate = node as AstNodeRecord;
                if (candidate.type === "UpdateExpression" || candidate.type === "IncDecStatement") {
                    return true;
                }
                if (
                    candidate.type === "AssignmentExpression" &&
                    typeof candidate.operator === "string" &&
                    candidate.operator !== "="
                ) {
                    return true;
                }

                for (const [key, value] of Object.entries(candidate)) {
                    if (key === "parent") {
                        continue;
                    }
                    if (expressionContainsUnsafeMutation(value)) {
                        return true;
                    }
                }

                return false;
            }

            function rangeOverlapsHandledConcatenation(start: number, end: number): boolean {
                return handledConcatenationRanges.some(([handledStart, handledEnd]) => {
                    return start >= handledStart && end <= handledEnd;
                });
            }

            function handleBinary(node: unknown): void {
                if (!isBinaryStringConcatenationExpression(node)) {
                    return;
                }

                const start = Core.getNodeStartIndex(node);
                const end = Core.getNodeEndIndex(node);
                if (start < 0 || end <= start || rangeOverlapsHandledConcatenation(start, end)) {
                    return;
                }

                if (!reportUnsafe && expressionContainsUnsafeMutation(node)) {
                    return;
                }

                const templateBody = buildTemplateBody(context, node);
                if (templateBody === null) {
                    return;
                }

                handledConcatenationRanges.push([start, end]);

                context.report({
                    node,
                    messageId: definition.messageId,
                    fix(fixer) {
                        const replacement = `$"${templateBody}"`;
                        return fixer.replaceTextRange([start, end], replacement);
                    }
                });
            }

            return Object.freeze({
                BinaryExpression(node) {
                    handleBinary(node);
                }
            });
        }
    });
}
