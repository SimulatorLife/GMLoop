import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import {
    applySourceTextEdits,
    createMeta,
    findPreviousNonWhitespaceCharacter,
    reportProgramTextRewrite,
    type SourceTextEdit
} from "../rule-base-helpers.js";

const LOGICAL_NOT_ALIAS = "not";
const LOGICAL_NOT_OPERATOR = "!";
const WHITESPACE_PATTERN = /\s/u;
const WORD_OPERATOR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const WORD_OPERATOR_ALIASES = Object.freeze(
    [...Core.OPERATOR_ALIAS_MAP.keys()]
        .filter((operator) => operator !== LOGICAL_NOT_ALIAS && WORD_OPERATOR_PATTERN.test(operator))
        .sort((left, right) => right.length - left.length)
);
const OPERATOR_ALIASES_BY_CANONICAL = createOperatorAliasesByCanonical();
const MACRO_DECLARATION_PATTERN = /^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu;

function createOperatorAliasesByCanonical(): ReadonlyMap<string, ReadonlyArray<string>> {
    const aliasesByCanonical = new Map<string, string[]>();
    for (const [alias, canonical] of Core.OPERATOR_ALIAS_MAP.entries()) {
        const aliases = aliasesByCanonical.get(canonical) ?? [];
        aliases.push(alias);
        aliasesByCanonical.set(canonical, aliases);
    }

    return new Map(
        [...aliasesByCanonical.entries()].map(([canonical, aliases]) => [
            canonical,
            Object.freeze(aliases.toSorted((left, right) => right.length - left.length))
        ])
    );
}

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

    const previousCharacterOnLine = findPreviousNonWhitespaceCharacter(sourceText, startIndex, true);
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

function isDirectiveLineAtIndex(sourceText: string, index: number): boolean {
    const lineStart = sourceText.lastIndexOf("\n", index - 1) + 1;
    for (let cursor = lineStart; cursor < sourceText.length; cursor += 1) {
        const character = sourceText[cursor];
        if (character === "\n" || character === "\r") {
            return false;
        }
        if (WHITESPACE_PATTERN.test(character)) {
            continue;
        }

        return character === "#";
    }

    return false;
}

function findNextLineStart(sourceText: string, index: number): number {
    const nextLineBreak = sourceText.indexOf("\n", index);
    return nextLineBreak === -1 ? sourceText.length : nextLineBreak + 1;
}

function collectDeclaredMacroNames(sourceText: string): ReadonlySet<string> {
    const declaredMacroNames = new Set<string>();
    for (const match of sourceText.matchAll(MACRO_DECLARATION_PATTERN)) {
        const macroName = match[1];
        if (macroName) {
            declaredMacroNames.add(macroName.toLowerCase());
        }
    }

    return declaredMacroNames;
}

function isProtectedMacroIdentifier(identifier: string, declaredMacroNames: ReadonlySet<string>): boolean {
    return declaredMacroNames.has(identifier.toLowerCase());
}

function rewriteLogicalNotAliasesOutsideTrivia(sourceText: string, declaredMacroNames: ReadonlySet<string>): string {
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

        if (isDirectiveLineAtIndex(sourceText, index)) {
            index = findNextLineStart(sourceText, index);
            continue;
        }

        const wordOperatorEdit = readWordOperatorAliasEditAt(sourceText, index, declaredMacroNames);
        if (wordOperatorEdit) {
            edits.push(wordOperatorEdit);
            index = wordOperatorEdit.end;
            continue;
        }

        if (
            isProtectedMacroIdentifier(sourceText.slice(index, index + LOGICAL_NOT_ALIAS.length), declaredMacroNames) ||
            !hasLogicalNotAliasAt(sourceText, index)
        ) {
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

function readWordOperatorAliasEditAt(
    sourceText: string,
    startIndex: number,
    declaredMacroNames: ReadonlySet<string>
): SourceTextEdit | null {
    for (const operatorAlias of WORD_OPERATOR_ALIASES) {
        const endIndex = startIndex + operatorAlias.length;
        if (endIndex > sourceText.length) {
            continue;
        }

        const sourceOperator = sourceText.slice(startIndex, endIndex);
        if (sourceOperator.toLowerCase() !== operatorAlias) {
            continue;
        }
        if (isProtectedMacroIdentifier(sourceOperator, declaredMacroNames)) {
            continue;
        }

        if (
            !Core.isIdentifierBoundaryCharacter(sourceText[startIndex - 1]) ||
            !Core.isIdentifierBoundaryCharacter(sourceText[endIndex])
        ) {
            continue;
        }

        const canonicalOperator = Core.OPERATOR_ALIAS_MAP.get(operatorAlias);
        if (typeof canonicalOperator !== "string" || sourceOperator === canonicalOperator) {
            return null;
        }

        return {
            start: startIndex,
            end: endIndex,
            text: canonicalOperator
        };
    }

    return null;
}

function locateBinaryOperatorSourceRange(parameters: {
    sourceText: string;
    node: Rule.Node;
    operator: string;
    normalizedOperator: string;
    expressionStart: number;
    expressionEnd: number;
    declaredMacroNames: ReadonlySet<string>;
}): [number, number] | null {
    const leftNode = (parameters.node as { left?: Rule.Node }).left;
    const rightNode = (parameters.node as { right?: Rule.Node }).right;
    const leftEndIndex = leftNode ? Core.getNodeEndIndex(leftNode) : null;
    const rightStartIndex = rightNode ? Core.getNodeStartIndex(rightNode) : null;
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

    const aliases = OPERATOR_ALIASES_BY_CANONICAL.get(parameters.normalizedOperator) ?? [];
    const candidates = [...new Set([parameters.operator, parameters.normalizedOperator, ...aliases])].sort(
        (left, right) => right.length - left.length
    );
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
            const sliced = parameters.sourceText.slice(cursor, candidateEnd);
            if (candidateEnd > searchEnd || sliced.toLowerCase() !== candidate.toLowerCase()) {
                continue;
            }
            if (isProtectedMacroIdentifier(sliced, parameters.declaredMacroNames)) {
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

function reportOperatorAliasIfNeeded(
    context: Rule.RuleContext,
    definition: GmlRuleDefinition,
    node: Rule.Node,
    declaredMacroNames: ReadonlySet<string>
): void {
    const operatorValue = (node as { operator?: unknown }).operator;
    const operator = typeof operatorValue === "string" ? operatorValue : "";
    const canonical = Core.OPERATOR_ALIAS_MAP.get(operator.toLowerCase()) ?? operator.toLowerCase();
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number" || operator.length === 0) {
        return;
    }

    const operatorRange = locateBinaryOperatorSourceRange({
        sourceText: context.sourceCode.text,
        node,
        operator,
        normalizedOperator: canonical,
        expressionStart: start,
        expressionEnd: end,
        declaredMacroNames
    });
    if (operatorRange === null) {
        return;
    }

    const [operatorStart, operatorEnd] = operatorRange;
    const originalOperatorText = context.sourceCode.text.slice(operatorStart, operatorEnd);
    if (originalOperatorText === canonical) {
        return;
    }

    context.report({
        loc: resolveReportLocation(context, operatorStart),
        messageId: definition.messageId,
        fix: (fixer) => fixer.replaceTextRange([operatorStart, operatorEnd], canonical)
    });
}

export function createNormalizeOperatorAliasesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            const declaredMacroNames = collectDeclaredMacroNames(context.sourceCode.text);
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, (sourceText) =>
                        rewriteLogicalNotAliasesOutsideTrivia(sourceText, declaredMacroNames)
                    );
                },
                BinaryExpression(node) {
                    reportOperatorAliasIfNeeded(context, definition, node, declaredMacroNames);
                },
                LogicalExpression(node) {
                    reportOperatorAliasIfNeeded(context, definition, node, declaredMacroNames);
                },
                UnaryExpression() {
                    // Parse-failure and legacy alias normalization is handled by Program text rewrite.
                }
            });
        }
    });
}
