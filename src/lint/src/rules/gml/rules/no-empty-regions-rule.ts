import type { Rule } from "eslint";

import { collectRegionSourceLines, readRegionDirectiveType, type RegionSourceLine } from "../region-directives.js";
import {
    applySourceTextEdits,
    createMeta,
    reportProgramTextRewrite,
    type SourceTextEdit
} from "../rule-base-helpers.js";
import type { GmlRuleDefinition } from "../rule-definition.js";

type RegionBlockRecord = Readonly<{
    startLineIndex: number;
    endLineIndex: number;
}>;

function isRegionBodyWhitespaceOnly(
    lines: ReadonlyArray<RegionSourceLine>,
    startLineIndex: number,
    endLineIndex: number
): boolean {
    for (let lineIndex = startLineIndex + 1; lineIndex < endLineIndex; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line) {
            continue;
        }

        if (line.content.trim().length > 0) {
            return false;
        }
    }

    return true;
}

function collectEmptyRegionBlocks(lines: ReadonlyArray<RegionSourceLine>): ReadonlyArray<RegionBlockRecord> {
    const emptyRegionBlocks: Array<RegionBlockRecord> = [];
    const regionStartLineStack: number[] = [];

    for (const [lineIndex, line] of lines.entries()) {
        const directiveType = readRegionDirectiveType(line.content);
        if (directiveType === "start") {
            regionStartLineStack.push(lineIndex);
            continue;
        }

        if (directiveType !== "end") {
            continue;
        }

        const startLineIndex = regionStartLineStack.pop();
        if (startLineIndex === undefined) {
            continue;
        }

        if (!isRegionBodyWhitespaceOnly(lines, startLineIndex, lineIndex)) {
            continue;
        }

        emptyRegionBlocks.push(
            Object.freeze({
                startLineIndex,
                endLineIndex: lineIndex
            })
        );
    }

    return Object.freeze(emptyRegionBlocks);
}

function createEmptyRegionDeletionEdits(
    lines: ReadonlyArray<RegionSourceLine>,
    emptyRegionBlocks: ReadonlyArray<RegionBlockRecord>
): ReadonlyArray<SourceTextEdit> {
    const edits: Array<SourceTextEdit> = [];

    for (const emptyRegionBlock of emptyRegionBlocks) {
        const startLine = lines[emptyRegionBlock.startLineIndex];
        const endLine = lines[emptyRegionBlock.endLineIndex];
        if (!startLine || !endLine) {
            continue;
        }

        edits.push(
            Object.freeze({
                start: startLine.start,
                end: endLine.end,
                text: ""
            })
        );
    }

    return Object.freeze(edits);
}

/**
 * Creates the `gml/no-empty-regions` rule.
 *
 * Reports `#region` blocks whose body is strictly whitespace and auto-fixes by
 * removing the full directive block.
 */
export function createNoEmptyRegionsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program() {
                    reportProgramTextRewrite(context, definition, (sourceText) => {
                        const lines = collectRegionSourceLines(sourceText);
                        if (lines.length === 0) {
                            return sourceText;
                        }

                        const emptyRegionBlocks = collectEmptyRegionBlocks(lines);
                        if (emptyRegionBlocks.length === 0) {
                            return sourceText;
                        }

                        const deletionEdits = createEmptyRegionDeletionEdits(lines, emptyRegionBlocks);
                        if (deletionEdits.length === 0) {
                            return sourceText;
                        }

                        return applySourceTextEdits(sourceText, deletionEdits);
                    });
                }
            });
        }
    });
}
