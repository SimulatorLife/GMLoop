import { Core } from "@gmloop/core";

import type { RepairUppercaseOperatorsEdit, RepairUppercaseOperatorsResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

const UPPERCASE_OPERATOR_MAPPING = Object.freeze(
    new Map<string, string>([
        ["AND", "&&"],
        ["OR", "||"],
        ["XOR", "^^"],
        ["DIV", "div"],
        ["MOD", "%"]
    ])
);

/**
 * Repairs unparseable uppercase operator aliases (AND, OR, XOR, DIV, MOD) in source code by
 * replacing them with their canonical forms.
 */
export function applyRepairUppercaseOperatorsCodemod(sourceText: string): RepairUppercaseOperatorsResult {
    if (!sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits: RepairUppercaseOperatorsEdit[] = [];
    const scanState = Core.createStringCommentScanState();
    const sourceLength = sourceText.length;
    let index = 0;

    // Collect macro declarations to avoid rewriting macro names
    const declaredMacroNames = new Set<string>();
    const MACRO_DECLARATION_PATTERN = /^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu;
    for (const match of sourceText.matchAll(MACRO_DECLARATION_PATTERN)) {
        const macroName = match[1];
        if (macroName) {
            declaredMacroNames.add(macroName.toLowerCase());
        }
    }

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

        const match = matchWordAt(sourceText, index);
        if (match) {
            const operatorReplacement = UPPERCASE_OPERATOR_MAPPING.get(match);
            if (operatorReplacement !== undefined && !declaredMacroNames.has(match.toLowerCase())) {
                edits.push(
                    Object.freeze({
                        start: index,
                        end: index + match.length,
                        text: operatorReplacement
                    })
                );
            }
            index += match.length;
        } else {
            index += 1;
        }
    }

    if (edits.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const outputText = applySourceTextEdits(sourceText, edits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits)
    });
}

function matchWordAt(sourceText: string, index: number): string | null {
    const char = sourceText[index] ?? "";
    if (!/[A-Za-z_]/u.test(char)) {
        return null;
    }

    if (index > 0 && /[A-Za-z0-9_]/u.test(sourceText[index - 1] ?? "")) {
        return null;
    }

    let end = index + 1;
    while (end < sourceText.length && /[A-Za-z0-9_]/u.test(sourceText[end] ?? "")) {
        end += 1;
    }

    return sourceText.slice(index, end);
}

function isDirectiveLineAtIndex(sourceText: string, index: number): boolean {
    const lineStart = sourceText.lastIndexOf("\n", index - 1) + 1;
    for (let cursor = lineStart; cursor < sourceText.length; cursor += 1) {
        const character = sourceText[cursor];
        if (character === "\n" || character === "\r") {
            return false;
        }
        if (/\s/u.test(character ?? "")) {
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
