import { Core } from "@gmloop/core";

import type { RepairLogicalNotEdit, RepairLogicalNotResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

/**
 * Repairs invalid logical 'not' and 'NOT' operators in source code by replacing them with '!'.
 * User-defined identifiers (such as function/variable names, macros, etc.) are preserved.
 */
export function applyRepairLogicalNotCodemod(sourceText: string): RepairLogicalNotResult {
    if (!sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits: RepairLogicalNotEdit[] = [];
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

        const word = sourceText.slice(index, index + 3);
        if (
            word.toLowerCase() === "not" &&
            !declaredMacroNames.has(word.toLowerCase()) &&
            Core.isLogicalNotOperatorAliasAt(sourceText, index)
        ) {
            edits.push(
                Object.freeze({
                    start: index,
                    end: index + 3,
                    text: "!"
                })
            );
            index += 3;
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
