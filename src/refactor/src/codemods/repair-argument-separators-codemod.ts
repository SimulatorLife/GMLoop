import { Core } from "@gmloop/core";

import type { RepairArgumentSeparatorsEdit, RepairArgumentSeparatorsResult } from "../types.js";
import { applySourceTextEdits } from "./codemod-helpers.js";

/**
 * Repairs missing argument separators (commas) in function calls (e.g. `foo(a b c)` to `foo(a, b, c)`).
 */
export function applyRepairArgumentSeparatorsCodemod(sourceText: string): RepairArgumentSeparatorsResult {
    if (!sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits: RepairArgumentSeparatorsEdit[] = [];
    const recoveryScanSource = Core.maskCommentsAndStringsForRecovery(sourceText, { maskDirectiveLines: true });

    Core.forEachWhitespaceRunWithAdjacentTokens(
        recoveryScanSource,
        ({ whitespaceRunStart, previousIndex, nextIndex }) => {
            const prevChar = recoveryScanSource[previousIndex] ?? "";
            if (!Core.canTerminateArgumentExpression(prevChar)) {
                return;
            }

            if (Core.isIdentifierCharacter(prevChar)) {
                const token = Core.readIdentifierTokenEndingAt(recoveryScanSource, previousIndex);
                if (token && Core.NON_CALL_PREFIX_KEYWORDS.has(token.value.toLowerCase())) {
                    return;
                }
            }

            const nextChar = recoveryScanSource[nextIndex] ?? "";
            if (!Core.canStartArgumentExpression(nextChar)) {
                return;
            }

            if (Core.isIdentifierCharacter(nextChar)) {
                const token = Core.readIdentifierTokenStartingAt(recoveryScanSource, nextIndex);
                if (
                    token &&
                    Core.NON_CALL_PREFIX_KEYWORDS.has(token.toLowerCase()) &&
                    token.toLowerCase() !== "new" &&
                    token.toLowerCase() !== "not" &&
                    token.toLowerCase() !== "function"
                ) {
                    return;
                }
            }

            if (!Core.isLikelyCallArgumentGap(recoveryScanSource, previousIndex)) {
                return;
            }

            edits.push(
                Object.freeze({
                    start: whitespaceRunStart,
                    end: whitespaceRunStart,
                    text: ","
                })
            );
        }
    );

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
