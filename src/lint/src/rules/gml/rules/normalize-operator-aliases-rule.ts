import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import type { GmlRuleDefinition } from "../index.js";
import { createMeta, resolveLocFromIndex } from "../rule-base-helpers.js";

const LOGICAL_NOT_ALIAS = "not";
const WHITESPACE_PATTERN = /\s/u;
const WORD_OPERATOR_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
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

function locateBinaryOperatorSourceRange(parameters: {
    sourceText: string;
    node: Rule.Node;
    operator: string;
    normalizedOperator: string;
    expressionStart: number;
    expressionEnd: number;
    declaredMacroNames: ReadonlySet<string>;
}): readonly [number, number] | null {
    const aliases = OPERATOR_ALIASES_BY_CANONICAL.get(parameters.normalizedOperator) ?? [parameters.normalizedOperator];
    const candidateOperators = [...aliases, parameters.normalizedOperator].toSorted(
        (left, right) => right.length - left.length
    );

    let cursor = parameters.expressionStart;
    while (cursor < parameters.expressionEnd) {
        const scannedIndex = Core.advanceStringCommentScan(
            parameters.sourceText,
            parameters.expressionEnd,
            cursor,
            Core.createStringCommentScanState(),
            true
        );
        if (scannedIndex !== cursor) {
            cursor = scannedIndex;
            continue;
        }

        for (const candidate of candidateOperators) {
            const candidateEnd = cursor + candidate.length;
            if (candidateEnd > parameters.expressionEnd) {
                continue;
            }

            const sourceOperator = parameters.sourceText.slice(cursor, candidateEnd);
            if (sourceOperator.toLowerCase() !== candidate) {
                continue;
            }
            if (isProtectedMacroIdentifier(sourceOperator, parameters.declaredMacroNames)) {
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

    const isUnparseable =
        originalOperatorText === originalOperatorText.toUpperCase() && originalOperatorText !== canonical;

    context.report({
        loc: resolveLocFromIndex(context, context.sourceCode.text, operatorStart),
        messageId: definition.messageId,
        fix: isUnparseable ? null : (fixer) => fixer.replaceTextRange([operatorStart, operatorEnd], canonical)
    });
}

export function createNormalizeOperatorAliasesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition, {
            messageText:
                "Use symbol GML operators (e.g. `&&`, `||`, `^^`) instead of operator aliases (e.g. `and`, `or`, `xor`)."
        }),
        create(context) {
            const declaredMacroNames = collectDeclaredMacroNames(context.sourceCode.text);
            return Object.freeze({
                Program() {
                    const sourceText = context.sourceCode.text;
                    let index = 0;
                    const scanState = Core.createStringCommentScanState();
                    const sourceLength = sourceText.length;
                    while (index < sourceLength) {
                        const scannedIndex = Core.advanceStringCommentScan(
                            sourceText,
                            sourceLength,
                            index,
                            scanState,
                            true
                        );
                        if (scannedIndex !== index) {
                            index = scannedIndex;
                            continue;
                        }

                        if (isDirectiveLineAtIndex(sourceText, index)) {
                            index = findNextLineStart(sourceText, index);
                            continue;
                        }

                        const word = sourceText.slice(index, index + LOGICAL_NOT_ALIAS.length);
                        if (
                            word.toLowerCase() === LOGICAL_NOT_ALIAS &&
                            !isProtectedMacroIdentifier(word, declaredMacroNames) &&
                            Core.isLogicalNotOperatorAliasAt(sourceText, index)
                        ) {
                            context.report({
                                loc: resolveLocFromIndex(context, sourceText, index),
                                messageId: definition.messageId
                            });
                            index += LOGICAL_NOT_ALIAS.length;
                        } else {
                            index += 1;
                        }
                    }
                },
                BinaryExpression(node) {
                    reportOperatorAliasIfNeeded(context, definition, node, declaredMacroNames);
                },
                LogicalExpression(node) {
                    reportOperatorAliasIfNeeded(context, definition, node, declaredMacroNames);
                },
                UnaryExpression() {
                    // Parse-failure and legacy alias normalization is handled by Program text scan.
                }
            });
        }
    });
}
