import { forEachScientificNotationToken, toPlainDecimalFromScientificLiteral } from "@gmloop/lint";

import { applySourceTextEdits } from "../codemod-helpers.js";
import type { ScientificNotationEdit, ScientificNotationResult } from "./types.js";

/**
 * Replace unsupported scientific-notation numeric literals with equivalent
 * plain decimal literals accepted by GML.
 */
export function applyScientificNotationCodemod(sourceText: string): ScientificNotationResult {
    if (!sourceText) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([])
        });
    }

    const edits: ScientificNotationEdit[] = [];

    forEachScientificNotationToken(sourceText, (start, end, scientificText) => {
        const replacement = toPlainDecimalFromScientificLiteral(scientificText);
        if (replacement !== null && replacement !== scientificText) {
            edits.push(
                Object.freeze({
                    start,
                    end,
                    text: replacement
                })
            );
        }
    });

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
