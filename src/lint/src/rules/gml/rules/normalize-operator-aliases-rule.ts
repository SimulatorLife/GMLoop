import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import {
    applySourceTextEdits,
    createMeta,
    findPreviousNonWhitespaceCharacter,
    reportProgramTextRewrite,
    type SourceTextEdit
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

const LOGICAL_NOT_ALIAS = "not";
const LOGICAL_NOT_OPERATOR = "!";
const WHITESPACE_PATTERN = /\s/u;

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

export function createNormalizeOperatorAliasesRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, rewriteLogicalNotAliasesOutsideTrivia);
                },
                UnaryExpression() {
                    // Parse-failure and legacy alias normalization is handled by Program text rewrite.
                }
            });
        }
    });
}
