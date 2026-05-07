import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    applySourceTextEdits,
    type AstNodeRecord,
    createMeta,
    getVariableDeclarator,
    isAstNodeRecord,
    reportFullTextRewrite,
    type SourceTextEdit,
    walkAstNodes
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

const { compactArray, getNodeStartIndex, getNodeEndIndex, unwrapParenthesizedExpression: unwrapParenthesized } = Core;

type LeadingArgumentFallback = Readonly<{
    parameterName: string;
    argumentIndex: number;
    defaultExpression: string;
    statement: any;
}>;

type AssignmentExpressionNode = AstNodeRecord &
    Readonly<{
        type: "AssignmentExpression";
        operator: string;
        left: unknown;
        right: unknown;
    }>;

function isAssignmentExpressionNode(node: unknown): node is AssignmentExpressionNode {
    return (
        isAstNodeRecord(node) &&
        node.type === "AssignmentExpression" &&
        typeof node.operator === "string" &&
        "left" in node &&
        "right" in node
    );
}

function isUndefinedValueNode(node: any): boolean {
    if (!node || typeof node !== "object") {
        return false;
    }

    if (node.type === "Identifier") {
        return typeof node.name === "string" && node.name.toLowerCase() === "undefined";
    }

    if (node.type !== "Literal" || typeof node.value !== "string") {
        return false;
    }

    return node.value.toLowerCase() === "undefined";
}

function getMemberArgumentIndex(node: any): number | null {
    if (!node || node.type !== "MemberIndexExpression") {
        return null;
    }

    const object = node.object;
    if (!object || object.type !== "Identifier" || object.name !== "argument") {
        return null;
    }

    const property = node.property;
    if (!property || property.type !== "Literal") {
        return null;
    }

    const parsed = Number.parseInt(String(property.value));
    return Number.isInteger(parsed) ? parsed : null;
}

function getArgumentCountGuardIndex(testNode: any): number | null {
    if (!testNode || testNode.type !== "BinaryExpression") {
        return null;
    }

    const left = testNode.left;
    if (!left || left.type !== "Identifier" || (left.name !== "argument_count" && left.name !== "argument_relative")) {
        return null;
    }

    const right = testNode.right;
    if (!right || right.type !== "Literal") {
        return null;
    }

    const parsed = Number.parseInt(String(right.value));
    return Number.isInteger(parsed) ? (testNode.operator === ">" ? parsed : null) : null;
}

function getSingleAssignmentFromIfConsequent(ifNode: unknown): AssignmentExpressionNode | null {
    if (!isAstNodeRecord(ifNode) || ifNode.type !== "IfStatement") {
        return null;
    }

    const consequent = ifNode.consequent;
    if (!isAstNodeRecord(consequent)) {
        return null;
    }

    if (consequent.type === "ExpressionStatement") {
        return isAssignmentExpressionNode(consequent.expression) ? consequent.expression : null;
    }

    if (consequent.type === "BlockStatement") {
        const body = consequent.body as any[];
        if (body.length === 1 && body[0].type === "ExpressionStatement") {
            return isAssignmentExpressionNode(body[0].expression) ? body[0].expression : null;
        }
    }

    return null;
}

function matchVarIfArgumentFallbackRewrite(
    sourceText: string,
    variableStatement: any,
    ifStatement: any
): {
    statementStart: number;
    statementEnd: number;
    parameterName: string;
    argumentIndex: number;
    defaultExpression: string;
} | null {
    const declarator = getVariableDeclarator(variableStatement);
    if (!declarator) {
        return null;
    }

    const identifier = isAstNodeRecord(declarator.id) ? declarator.id : null;
    if (!identifier || identifier.type !== "Identifier" || typeof identifier.name !== "string" || !declarator.init) {
        return null;
    }

    const argumentIndex = getArgumentCountGuardIndex(ifStatement?.test);
    if (argumentIndex === null) {
        return null;
    }

    const assignment = getSingleAssignmentFromIfConsequent(ifStatement);
    if (!assignment || assignment.operator !== "=") {
        return null;
    }

    const left = unwrapParenthesized(assignment.left);
    if (!left || left.type !== "Identifier" || left.name !== identifier.name) {
        return null;
    }

    const memberArgumentIndex = getMemberArgumentIndex(assignment.right);
    if (memberArgumentIndex === null || memberArgumentIndex !== argumentIndex) {
        return null;
    }

    const initStart = getNodeStartIndex(declarator.init);
    const initEnd = getNodeEndIndex(declarator.init);
    const statementStart = getNodeStartIndex(variableStatement);
    const statementEnd = getNodeEndIndex(ifStatement);

    if (
        typeof initStart !== "number" ||
        typeof initEnd !== "number" ||
        typeof statementStart !== "number" ||
        typeof statementEnd !== "number"
    ) {
        return null;
    }

    const defaultExpression = isUndefinedValueNode(declarator.init)
        ? "undefined"
        : sourceText.slice(initStart, initEnd).trim();

    return {
        statementStart,
        statementEnd,
        parameterName: identifier.name,
        argumentIndex,
        defaultExpression
    };
}

function splitTopLevelCommaSegments(text: string): string[] {
    const segments: string[] = [];
    let current = "";
    let parenDepth = 0;
    let bracketDepth = 0;
    let braceDepth = 0;

    for (const char of text) {
        switch (char) {
            case "(": {
                parenDepth++;
                break;
            }
            case ")": {
                parenDepth--;
                break;
            }
            case "[": {
                bracketDepth++;
                break;
            }
            case "]": {
                bracketDepth--;
                break;
            }
            case "{": {
                braceDepth++;
                break;
            }
            case "}": {
                braceDepth--;
                break;
            }
            default: {
                if (char === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
                    segments.push(current.trim());
                    current = "";
                    continue;
                }
            }
        }
        current += char;
    }
    segments.push(current.trim());
    return compactArray(segments) as string[];
}

function expandEditRangeToWholeLines(sourceText: string, start: number, end: number): { start: number; end: number } {
    let lineStart = sourceText.lastIndexOf("\n", start);
    if (lineStart < 0) lineStart = 0;
    else lineStart += 1;

    let lineEnd = sourceText.indexOf("\n", end);
    if (lineEnd < 0) lineEnd = sourceText.length;
    else lineEnd += 1;

    return { start: lineStart, end: lineEnd };
}

function resolveFunctionParameterRange(sourceText: string, functionNode: any): { start: number; end: number } | null {
    const start = getNodeStartIndex(functionNode);
    if (typeof start !== "number") return null;

    const headerSearchText = sourceText.slice(start, start + 500);
    const openParenMatch = /\(/.exec(headerSearchText);
    if (!openParenMatch) return null;

    const openParenIndex = start + openParenMatch.index;
    let parenDepth = 0;
    for (let i = openParenIndex; i < sourceText.length; i++) {
        if (sourceText[i] === "(") parenDepth++;
        else if (sourceText[i] === ")") {
            parenDepth--;
            if (parenDepth === 0) {
                return { start: openParenIndex + 1, end: i };
            }
        }
    }

    return null;
}

function getIdentifierNameFromParameterSegment(segment: string): string | null {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(segment);
    return match ? match[1] : null;
}

function normalizeTrailingOptionalParameterSegments(
    parameterSegments: ReadonlyArray<string>
): Readonly<{ changed: boolean; segments: ReadonlyArray<string> }> {
    let changed = false;
    let encounteredOptionalParameter = false;

    const normalizedSegments = parameterSegments.map((parameterSegment) => {
        const trimmedSegment = parameterSegment.trim();
        const hasExplicitDefault = trimmedSegment.includes("=");
        if (hasExplicitDefault) {
            encounteredOptionalParameter = true;
            return parameterSegment;
        }

        if (!encounteredOptionalParameter) {
            return parameterSegment;
        }

        const parameterName = getIdentifierNameFromParameterSegment(trimmedSegment);
        if (!parameterName) {
            return parameterSegment;
        }

        changed = true;
        return `${trimmedSegment} = undefined`;
    });

    return Object.freeze({
        changed,
        segments: Object.freeze(normalizedSegments)
    });
}

function matchLeadingTernaryFallback(statement: any, sourceText: string): LeadingArgumentFallback | null {
    const declarator = getVariableDeclarator(statement);
    if (!declarator) {
        return null;
    }

    const identifier = isAstNodeRecord(declarator.id) ? declarator.id : null;
    const initExpression = isAstNodeRecord(declarator.init) ? declarator.init : null;
    if (
        !identifier ||
        identifier.type !== "Identifier" ||
        typeof identifier.name !== "string" ||
        !initExpression ||
        initExpression.type !== "TernaryExpression"
    ) {
        return null;
    }

    const argumentIndex = getArgumentCountGuardIndex(initExpression.test);
    if (argumentIndex === null) {
        return null;
    }

    const consequentIndex = getMemberArgumentIndex(initExpression.consequent);
    if (consequentIndex === null || consequentIndex !== argumentIndex) {
        return null;
    }

    const alternateStart = getNodeStartIndex(initExpression.alternate);
    const alternateEnd = getNodeEndIndex(initExpression.alternate);
    if (typeof alternateStart !== "number" || typeof alternateEnd !== "number") {
        return null;
    }

    const defaultExpression = isUndefinedValueNode(initExpression.alternate)
        ? "undefined"
        : sourceText.slice(alternateStart, alternateEnd).trim();

    return Object.freeze({
        parameterName: identifier.name,
        argumentIndex,
        defaultExpression,
        statement
    });
}

function rewriteFunctionForOptionalDefaults(sourceText: string, functionNode: any): SourceTextEdit | null {
    const functionStart = getNodeStartIndex(functionNode);
    const functionEnd = getNodeEndIndex(functionNode);
    const bodyStatements = Array.isArray(functionNode?.body?.body) ? functionNode.body.body : [];
    const parameterRange = resolveFunctionParameterRange(sourceText, functionNode);

    if (
        typeof functionStart !== "number" ||
        typeof functionEnd !== "number" ||
        !parameterRange ||
        parameterRange.start < functionStart ||
        parameterRange.end > functionEnd
    ) {
        return null;
    }

    const localEdits: SourceTextEdit[] = [];
    const fallbackRecords: Array<{
        parameterName: string;
        argumentIndex: number;
        defaultExpression: string;
        statementStart: number;
        statementEnd: number;
    }> = [];

    for (let index = 0; index < bodyStatements.length - 1; index += 1) {
        const match = matchVarIfArgumentFallbackRewrite(sourceText, bodyStatements[index], bodyStatements[index + 1]);
        if (!match) {
            continue;
        }

        fallbackRecords.push({
            parameterName: match.parameterName,
            argumentIndex: match.argumentIndex,
            defaultExpression: match.defaultExpression,
            statementStart: match.statementStart,
            statementEnd: match.statementEnd
        });
        index += 1;
    }

    const paramsText = sourceText.slice(parameterRange.start, parameterRange.end);
    const originalSegments = splitTopLevelCommaSegments(paramsText);
    let rewrittenSegments = [...originalSegments];

    if (originalSegments.length === 0 && bodyStatements.length > 0) {
        const leadingFallbacks: LeadingArgumentFallback[] = [];
        for (const statement of bodyStatements) {
            const fallback = matchLeadingTernaryFallback(statement, sourceText);
            if (!fallback) {
                break;
            }
            leadingFallbacks.push(fallback);
        }

        const isContiguousLeadingFallback = leadingFallbacks.every(
            (fallback, index) => fallback.argumentIndex === index
        );

        if (leadingFallbacks.length > 0 && isContiguousLeadingFallback) {
            rewrittenSegments = leadingFallbacks.map(
                (fallback) => `${fallback.parameterName} = ${fallback.defaultExpression}`
            );

            const firstStatementStart = getNodeStartIndex(leadingFallbacks[0]?.statement);
            const nextStatement = bodyStatements[leadingFallbacks.length] ?? null;
            const trailingFallbackStatement = leadingFallbacks.at(-1)?.statement;
            const removalEnd =
                nextStatement === null ? getNodeEndIndex(trailingFallbackStatement) : getNodeStartIndex(nextStatement);

            if (
                typeof firstStatementStart === "number" &&
                typeof removalEnd === "number" &&
                removalEnd >= firstStatementStart
            ) {
                localEdits.push(
                    Object.freeze({
                        start: firstStatementStart - functionStart,
                        end: removalEnd - functionStart,
                        text: ""
                    })
                );
            }
        }
    }

    const sortedFallbackRecords = fallbackRecords.toSorted((left, right) => left.argumentIndex - right.argumentIndex);
    const fallbackRecordsToRemove = new Set<number>();
    for (const fallbackRecord of sortedFallbackRecords) {
        if (fallbackRecord.argumentIndex !== rewrittenSegments.length) {
            continue;
        }

        const parameterName = fallbackRecord.parameterName;
        const existingSegment = rewrittenSegments[fallbackRecord.argumentIndex] ?? "";
        const existingParameterName = getIdentifierNameFromParameterSegment(existingSegment);
        if (existingParameterName && existingParameterName === parameterName) {
            if (!existingSegment.includes("=")) {
                rewrittenSegments[fallbackRecord.argumentIndex] =
                    `${parameterName} = ${fallbackRecord.defaultExpression}`;
            }
            fallbackRecordsToRemove.add(fallbackRecord.statementStart);
            continue;
        }

        rewrittenSegments.push(`${parameterName} = ${fallbackRecord.defaultExpression}`);
        fallbackRecordsToRemove.add(fallbackRecord.statementStart);
    }

    for (const fallbackRecord of sortedFallbackRecords) {
        if (fallbackRecordsToRemove.has(fallbackRecord.statementStart)) {
            const range = expandEditRangeToWholeLines(
                sourceText,
                fallbackRecord.statementStart,
                fallbackRecord.statementEnd
            );
            localEdits.push({
                start: range.start - functionStart,
                end: range.end - functionStart,
                text: ""
            });
        }
    }

    const normalizedTrailingOptionalSegments = normalizeTrailingOptionalParameterSegments(rewrittenSegments);
    rewrittenSegments = [...normalizedTrailingOptionalSegments.segments];

    if (
        localEdits.length === 0 &&
        rewrittenSegments.length === originalSegments.length &&
        !normalizedTrailingOptionalSegments.changed
    ) {
        return null;
    }

    const newParamsText = rewrittenSegments.join(", ");
    const headText = sourceText.slice(functionStart, parameterRange.start);
    const tailText = sourceText.slice(parameterRange.end, functionEnd);

    const baseRewrittenText = `${headText}${newParamsText}${tailText}`;
    const finalRewrittenText = applySourceTextEdits(baseRewrittenText, localEdits);

    return {
        start: functionStart,
        end: functionEnd,
        text: finalRewrittenText
    };
}

function isUndefinedOrMissingArg(node: any): boolean {
    if (!node) return false;
    if (node.type === "MissingOptionalArgument") {
        return true;
    }
    return isUndefinedValueNode(node);
}

function createCollapseUndefinedCallArgumentEdit(sourceText: string, callExpression: any): SourceTextEdit | null {
    if (!callExpression || callExpression.type !== "CallExpression" || !Array.isArray(callExpression.arguments)) {
        return null;
    }

    const args = callExpression.arguments;
    if (args.length <= 1 || !args.every(isUndefinedOrMissingArg)) {
        return null;
    }

    const firstArgument = args[0];
    const lastArgument = args.at(-1);
    const firstStart = getNodeStartIndex(firstArgument);
    const lastEnd = getNodeEndIndex(lastArgument);

    if (typeof firstStart !== "number" || typeof lastEnd !== "number") {
        return null;
    }

    return Object.freeze({
        start: firstStart,
        end: lastEnd,
        text: "undefined"
    });
}

function hasOverlappingRange(
    rangeStart: number,
    rangeEnd: number,
    ranges: ReadonlyArray<{ start: number; end: number }>
): boolean {
    for (const range of ranges) {
        if (rangeStart < range.end && rangeEnd > range.start) {
            return true;
        }
    }

    return false;
}

export function rewriteTrailingOptionalDefaultsProgram(sourceText: string, programNode: any): string {
    const functionEdits: SourceTextEdit[] = [];
    const functionRanges: Array<{ start: number; end: number }> = [];
    const callEdits: SourceTextEdit[] = [];

    walkAstNodes(programNode, (node) => {
        if (node?.type === "FunctionDeclaration" || node?.type === "ConstructorDeclaration") {
            const edit = rewriteFunctionForOptionalDefaults(sourceText, node);
            if (edit) {
                functionEdits.push(edit);
                functionRanges.push({ start: edit.start, end: edit.end });
            }
            return;
        }

        if (node?.type === "CallExpression") {
            const edit = createCollapseUndefinedCallArgumentEdit(sourceText, node);
            if (!edit) {
                return;
            }

            if (hasOverlappingRange(edit.start, edit.end, functionRanges)) {
                return;
            }

            callEdits.push(edit);
        }
    });

    return applySourceTextEdits(sourceText, [...functionEdits, ...callEdits]);
}

export function createRequireTrailingOptionalDefaultsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(node) {
                    const sourceText = context.sourceCode.text;
                    const rewrittenText = rewriteTrailingOptionalDefaultsProgram(sourceText, node);
                    reportFullTextRewrite(context, definition.messageId, sourceText, rewrittenText);
                }
            });
        }
    });
}
