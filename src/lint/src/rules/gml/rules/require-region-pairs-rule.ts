import type { Rule } from "eslint";

import {
    collectRegionSourceLines,
    readRegionDirectiveType,
    type RegionSourceLine,
    resolveRegionDirectiveLineEnding
} from "../region-directives.js";
import {
    applySourceTextEdits,
    createMeta,
    reportProgramTextRewrite,
    type SourceTextEdit
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

type RegionPairingState = Readonly<{
    unmatchedEndRegionLines: ReadonlyArray<RegionSourceLine>;
    unmatchedStartRegionCount: number;
}>;

function collectRegionPairingState(lines: ReadonlyArray<RegionSourceLine>): RegionPairingState {
    const unmatchedEndRegionLines: Array<RegionSourceLine> = [];
    const unmatchedStartRegionStack: Array<RegionSourceLine> = [];

    for (const line of lines) {
        const directiveType = readRegionDirectiveType(line.content);
        if (directiveType === "start") {
            unmatchedStartRegionStack.push(line);
            continue;
        }

        if (directiveType !== "end") {
            continue;
        }

        const matchedStartRegionLine = unmatchedStartRegionStack.pop();
        if (!matchedStartRegionLine) {
            unmatchedEndRegionLines.push(line);
        }
    }

    return Object.freeze({
        unmatchedEndRegionLines: Object.freeze(unmatchedEndRegionLines),
        unmatchedStartRegionCount: unmatchedStartRegionStack.length
    });
}

function createUnmatchedEndRegionDeletionEdits(
    unmatchedEndRegionLines: ReadonlyArray<RegionSourceLine>
): ReadonlyArray<SourceTextEdit> {
    return Object.freeze(
        unmatchedEndRegionLines.map((line) =>
            Object.freeze({
                start: line.start,
                end: line.end,
                text: ""
            })
        )
    );
}

function createMissingEndRegionInsertionText(
    sourceText: string,
    lines: ReadonlyArray<RegionSourceLine>,
    unmatchedStartRegionCount: number
): string {
    if (unmatchedStartRegionCount === 0) {
        return "";
    }

    const lineEnding = resolveRegionDirectiveLineEnding(lines);
    const endRegionLines = Array.from({ length: unmatchedStartRegionCount }, () => "#endregion").join(lineEnding);
    if (sourceText.endsWith("\r\n") || sourceText.endsWith("\n") || sourceText.length === 0) {
        return `${endRegionLines}${lineEnding}`;
    }

    return `${lineEnding}${endRegionLines}`;
}

function createMissingEndRegionInsertionEdit(
    sourceText: string,
    lines: ReadonlyArray<RegionSourceLine>,
    unmatchedStartRegionCount: number
): SourceTextEdit | null {
    const insertionText = createMissingEndRegionInsertionText(sourceText, lines, unmatchedStartRegionCount);
    if (insertionText.length === 0) {
        return null;
    }

    return Object.freeze({
        start: sourceText.length,
        end: sourceText.length,
        text: insertionText
    });
}

function repairMalformedRegionPairs(sourceText: string): string {
    const lines = collectRegionSourceLines(sourceText);
    if (lines.length === 0) {
        return sourceText;
    }

    const pairingState = collectRegionPairingState(lines);
    const edits = [
        ...createUnmatchedEndRegionDeletionEdits(pairingState.unmatchedEndRegionLines),
        createMissingEndRegionInsertionEdit(sourceText, lines, pairingState.unmatchedStartRegionCount)
    ].filter((edit): edit is SourceTextEdit => edit !== null);

    if (edits.length === 0) {
        return sourceText;
    }

    return applySourceTextEdits(sourceText, edits);
}

/**
 * Creates the `gml/require-region-pairs` rule.
 *
 * Reports malformed `#region` / `#endregion` pairs and auto-fixes by removing
 * unmatched closing directives and appending missing closing directives at EOF.
 */
export function createRequireRegionPairsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, repairMalformedRegionPairs);
                }
            });
        }
    });
}
