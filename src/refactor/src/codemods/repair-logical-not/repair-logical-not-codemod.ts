import { Core } from "@gmloop/core";

import { resolveSymbolId } from "../../symbol-queries.js";
import type { PartialSemanticAnalyzer, RepairLogicalNotEdit, RepairLogicalNotResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

/**
 * Repairs invalid logical 'not' and 'NOT' operators in source code by replacing them with '!'.
 * User-defined identifiers (such as function/variable names, macros, etc.) are preserved.
 */
export async function applyRepairLogicalNotCodemod(
    sourceText: string,
    semantic?: PartialSemanticAnalyzer | null
): Promise<RepairLogicalNotResult> {
    if (!sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits: RepairLogicalNotEdit[] = [];
    const sourceLength = sourceText.length;

    // Collect macro declarations to avoid rewriting macro names
    const declaredMacroNames = new Set<string>();
    const MACRO_DECLARATION_PATTERN = /^\s*#macro\s+([A-Za-z_][A-Za-z0-9_]*)\b/gmu;
    for (const match of sourceText.matchAll(MACRO_DECLARATION_PATTERN)) {
        const macroName = match[1];
        if (macroName) {
            declaredMacroNames.add(macroName.toLowerCase());
        }
    }

    // Pre-scan file to collect all unique case variants of "not" at operator alias locations
    const notVariants = new Set<string>();
    const preScanState = Core.createStringCommentScanState();
    let preScanIndex = 0;
    while (preScanIndex < sourceLength) {
        const scannedIndex = Core.advanceStringCommentScan(sourceText, sourceLength, preScanIndex, preScanState, true);
        if (scannedIndex !== preScanIndex) {
            preScanIndex = scannedIndex;
            continue;
        }

        if (isDirectiveLineAtIndex(sourceText, preScanIndex)) {
            preScanIndex = findNextLineStart(sourceText, preScanIndex);
            continue;
        }

        const word = sourceText.slice(preScanIndex, preScanIndex + 3);
        if (word.toLowerCase() === "not") {
            if (Core.isLogicalNotOperatorAliasAt(sourceText, preScanIndex)) {
                notVariants.add(word);
            }
            preScanIndex += 3;
        } else {
            preScanIndex += 1;
        }
    }

    // Resolve user-defined symbol existence for all collected variants upfront in parallel (no-await-in-loop fix)
    const userDefinedVariants = new Set<string>();
    if (semantic && notVariants.size > 0) {
        const variantsList = [...notVariants];
        const symbols = await Promise.all(variantsList.map((variant) => resolveSymbolId(variant, semantic)));
        for (const [idx, symbol] of symbols.entries()) {
            if (symbol !== null) {
                userDefinedVariants.add(variantsList[idx]);
            }
        }
    }

    // Main scan to build edits
    const scanState = Core.createStringCommentScanState();
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

        const word = sourceText.slice(index, index + 3);
        if (word.toLowerCase() === "not") {
            const hasUserDefinedSymbol = userDefinedVariants.has(word);
            if (
                !hasUserDefinedSymbol &&
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
                continue;
            }
        }
        index += 1;
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
