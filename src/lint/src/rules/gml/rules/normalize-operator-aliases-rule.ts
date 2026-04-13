import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    applySourceTextEdits,
    createMeta,
    getNodeEndIndex,
    getNodeStartIndex,
    reportProgramTextRewrite,
    type SourceTextEdit
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

const LOGICAL_NOT_ALIAS = "not";
const LOGICAL_NOT_OPERATOR = "!";
const WHITESPACE_PATTERN = /\s/u;
const INLINE_WHITESPACE_PATTERN = /[ \t]/u;
const WORD_OPERATOR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

function resolveReportLocation(context: Rule.RuleContext, index: number): { line: number; column: number } {
    const sourceCodeWithLocator = context.sourceCode as Rule.RuleContext["sourceCode"] & {
        getLocFromIndex?: (index: number) => { line: number; column: number };
    };

    if (typeof sourceCodeWithLocator.getLocFromIndex === "function") {
        const located = sourceCodeWithLocator.getLocFromIndex(index);
        if (
            typeof located?.line === "number" &&
            Number.isFinite(located.line) &&
            typeof located.column === "number" &&
            Number.isFinite(located.column)
        ) {
            return located;
        }
    }

    const sourceText = context.sourceCode.text;
    const clampedIndex = Core.clamp(index, 0, sourceText.length);
    let line = 1;
    let lineStart = 0;
    for (let cursor = 0; cursor < clampedIndex; cursor += 1) {
        if (sourceText[cursor] === "\n") {
            line += 1;
            lineStart = cursor + 1;
        }
    }

    return { line, column: clampedIndex - lineStart };
}

function isIdentifierStartCharacter(character: string | undefined): boolean {
    if (typeof character !== "string" || character.length === 0) {
        return false;
    }

    const code = character.charCodeAt(0);
    return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function getPreviousNonWhitespaceCharacterOnLine(sourceText: string, startIndex: number): string | null {
    let cursor = startIndex - 1;

    while (cursor >= 0) {
        const character = sourceText[cursor];
        if (character === "\n" || character === "\r") {
            return null;
        }

        if (INLINE_WHITESPACE_PATTERN.test(character)) {
            cursor -= 1;
            continue;
        }

        return character;
    }

    return null;
}

function hasLogicalNotAliasAt(sourceText: string, startIndex: number): boolean {
    const aliasEnd = startIndex + LOGICAL_NOT_ALIAS.length;
    if (aliasEnd > sourceText.length) {
        return false;
    }

    const keyword = sourceText.slice(startIndex, aliasEnd);
    if (keyword.toLowerCase() !== LOGICAL_NOT_ALIAS) {
        return false;
    }

    if (!Core.isIdentifierBoundaryCharacter(sourceText[startIndex - 1])) {
        return false;
    }

    if (!Core.isIdentifierBoundaryCharacter(sourceText[aliasEnd])) {
        return false;
    }

    const previousCharacterOnLine = getPreviousNonWhitespaceCharacterOnLine(sourceText, startIndex);
    if (previousCharacterOnLine === '"' || previousCharacterOnLine === "'" || previousCharacterOnLine === "`") {
        return false;
    }

    let operandIndex = aliasEnd;
    while (operandIndex < sourceText.length && WHITESPACE_PATTERN.test(sourceText[operandIndex])) {
        operandIndex += 1;
    }

    const nextTokenStart = sourceText[operandIndex];
    return nextTokenStart === "(" || isIdentifierStartCharacter(nextTokenStart);
}

function rewriteLogicalNotAliasesOutsideTrivia(sourceText: string): string {
    const edits: SourceTextEdit[] = [];
    const scanState = Core.createStringCommentScanState();
    const sourceLength = sourceText.length;
    let index = 0;

    while (index < sourceLength) {
        const scannedIndex = Core.advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
        if (scannedIndex !== index) {
            index = scannedIndex;
            continue;
        }

        if (!hasLogicalNotAliasAt(sourceText, index)) {
            index += 1;
            continue;
        }

        edits.push({
            start: index,
            end: index + LOGICAL_NOT_ALIAS.length,
            text: LOGICAL_NOT_OPERATOR
        });
        index += LOGICAL_NOT_ALIAS.length;
    }

    return applySourceTextEdits(sourceText, edits);
}

function locateBinaryOperatorSourceRange(parameters: {
    sourceText: string;
    node: Rule.Node;
    operator: string;
    normalizedOperator: string;
    expressionStart: number;
    expressionEnd: number;
}): [number, number] | null {
    const leftNode = (parameters.node as { left?: Rule.Node }).left;
    const rightNode = (parameters.node as { right?: Rule.Node }).right;
    const leftEndIndex = leftNode ? getNodeEndIndex(leftNode) : null;
    const rightStartIndex = rightNode ? getNodeStartIndex(rightNode) : null;
    const searchStart =
        typeof leftEndIndex === "number"
            ? Core.clamp(leftEndIndex, parameters.expressionStart, parameters.expressionEnd)
            : parameters.expressionStart;
    const searchEnd =
        typeof rightStartIndex === "number"
            ? Core.clamp(rightStartIndex, searchStart, parameters.expressionEnd)
            : parameters.expressionEnd;
    if (searchStart >= searchEnd) {
        return null;
    }

    const candidates = [
        ...new Set([parameters.operator, parameters.normalizedOperator].filter((value) => value.length > 0))
    ].sort((left, right) => right.length - left.length);
    if (candidates.length === 0) {
        return null;
    }

    const scanState = Core.createStringCommentScanState();
    let cursor = searchStart;
    while (cursor < searchEnd) {
        const scannedIndex = Core.advanceStringCommentScan(
            parameters.sourceText,
            parameters.sourceText.length,
            cursor,
            scanState,
            true
        );
        if (scannedIndex !== cursor) {
            cursor = scannedIndex;
            continue;
        }

        for (const candidate of candidates) {
            const candidateEnd = cursor + candidate.length;
            if (candidateEnd > searchEnd || parameters.sourceText.slice(cursor, candidateEnd) !== candidate) {
                continue;
            }

            if (
                WORD_OPERATOR_PATTERN.test(candidate) &&
                (!Core.isIdentifierBoundaryCharacter(parameters.sourceText[cursor - 1]) ||
                    !Core.isIdentifierBoundaryCharacter(parameters.sourceText[candidateEnd]))
            ) {
                continue;
            }

            return [cursor, candidateEnd];
        }

        cursor += 1;
    }

    return null;
}

export function createNormalizeOperatorAliasesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, rewriteLogicalNotAliasesOutsideTrivia);
                },
                BinaryExpression(node) {
                    const normalized = Core.OPERATOR_ALIAS_MAP.get(node.operator);
                    if (normalized) {
                        const operator = String(node.operator);
                        const start = getNodeStartIndex(node);
                        const end = getNodeEndIndex(node);
                        if (
                            typeof start === "number" &&
                            typeof end === "number" &&
                            operator.length > 0 &&
                            normalized !== operator
                        ) {
                            const operatorRange = locateBinaryOperatorSourceRange({
                                sourceText: context.sourceCode.text,
                                node,
                                operator,
                                normalizedOperator: normalized,
                                expressionStart: start,
                                expressionEnd: end
                            });
                            if (operatorRange === null) {
                                return;
                            }

                            const [operatorStart, operatorEnd] = operatorRange;
                            const originalOperatorText = context.sourceCode.text.slice(operatorStart, operatorEnd);
                            if (
                                originalOperatorText.length === operator.length &&
                                originalOperatorText.toLowerCase() === operator &&
                                originalOperatorText !== operator
                            ) {
                                return;
                            }

                            context.report({
                                loc: resolveReportLocation(context, operatorStart),
                                messageId: definition.messageId,
                                fix: (fixer) => fixer.replaceTextRange([operatorStart, operatorEnd], normalized)
                            });
                        }
                    }
                },
                UnaryExpression() {
                    // Parse-failure and legacy alias normalization is handled by Program text rewrite.
                }
            });
        }
    });
}
