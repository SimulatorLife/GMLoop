/**
 * Occurrence analysis utilities for refactoring operations.
 * Provides helpers to classify and categorize symbol occurrences for
 * rename planning, hot reload coordination, and impact preview.
 */

import { Core } from "@gmloop/core";

import { OccurrenceKind, type SymbolOccurrence } from "./types.js";

/**
 * Classification result for symbol occurrences.
 * Breaks down occurrences into categories useful for rename planning
 * and hot reload coordination.
 */
export interface OccurrenceClassification {
    total: number;
    definitions: number;
    references: number;
    byFile: Map<string, number>;
    byKind: Map<string, number>;
}

function countDefinitionsAndReferences(classification: OccurrenceClassification, kind: string): void {
    if (kind === OccurrenceKind.DEFINITION) {
        classification.definitions++;
        return;
    }

    if (kind === OccurrenceKind.REFERENCE) {
        classification.references++;
    }
}

function classifySingleOccurrence(classification: OccurrenceClassification, occurrence: SymbolOccurrence): void {
    const kind = occurrence.kind ?? "unknown";
    countDefinitionsAndReferences(classification, kind);

    Core.incrementMapValue(classification.byKind, kind);

    if (!occurrence.path) {
        return;
    }

    Core.incrementMapValue(classification.byFile, occurrence.path);
}

/**
 * Classify symbol occurrences into categories for analysis.
 * Useful for providing detailed breakdowns before applying renames
 * and determining hot reload safety.
 *
 * @param occurrences - Array of symbol occurrences to classify
 * @returns Classification breakdown
 *
 * @example
 * const occurrences = await engine.gatherSymbolOccurrences("player_hp");
 * const classification = classifyOccurrences(occurrences);
 * console.log(`Found ${classification.definitions} definitions and ${classification.references} references`);
 * console.log(`Affects ${classification.byFile.size} files`);
 */
export function classifyOccurrences(occurrences: Array<SymbolOccurrence>): OccurrenceClassification {
    Core.assertArray(occurrences, {
        errorMessage: "classifyOccurrences requires an array of occurrences"
    });

    const classification: OccurrenceClassification = {
        total: occurrences.length,
        definitions: 0,
        references: 0,
        byFile: new Map(),
        byKind: new Map()
    };

    for (const occurrence of occurrences) {
        if (occurrence == null || typeof occurrence !== "object") {
            continue;
        }
        classifySingleOccurrence(classification, occurrence);
    }

    return classification;
}

/**
 * Filter occurrences by kind.
 * Useful for isolating specific categories of occurrences.
 *
 * @param occurrences - Array of occurrences to filter
 * @param kinds - Kinds to include (e.g., ["definition"], ["reference"])
 * @returns Filtered occurrences
 *
 * @example
 * const occurrences = await engine.gatherSymbolOccurrences("scr_player");
 * const definitions = filterOccurrencesByKind(occurrences, ["definition"]);
 * console.log(`Symbol is defined in ${definitions.length} locations`);
 */
export function filterOccurrencesByKind(
    occurrences: Array<SymbolOccurrence>,
    kinds: Array<string>
): Array<SymbolOccurrence> {
    Core.assertArray(occurrences, {
        errorMessage: "filterOccurrencesByKind requires an array of occurrences"
    });
    Core.assertArray(kinds, {
        errorMessage: "filterOccurrencesByKind requires an array of kinds"
    });

    const kindSet = new Set(kinds);
    return occurrences.filter((occ) => occ != null && kindSet.has(occ.kind ?? "unknown"));
}

/**
 * Group occurrences by file path.
 * Useful for displaying file-by-file impact in rename previews.
 *
 * @param occurrences - Array of occurrences to group
 * @returns Map from file path to occurrences in that file
 *
 * @example
 * const occurrences = await engine.gatherSymbolOccurrences("hp");
 * const grouped = groupOccurrencesByFile(occurrences);
 * for (const [filePath, fileOccurrences] of grouped) {
 *     console.log(`${filePath}: ${fileOccurrences.length} occurrences`);
 * }
 */
export function groupOccurrencesByFile(occurrences: Array<SymbolOccurrence>): Map<string, Array<SymbolOccurrence>> {
    Core.assertArray(occurrences, {
        errorMessage: "groupOccurrencesByFile requires an array of occurrences"
    });

    const grouped = new Map<string, Array<SymbolOccurrence>>();

    for (const occurrence of occurrences) {
        const path = occurrence?.path;
        if (!path) {
            continue;
        }
        Core.getOrCreateMapEntry(grouped, path, () => []).push(occurrence);
    }

    return grouped;
}

/**
 * Find occurrences within a specific file.
 * Useful for targeted file-level analysis during hot reload.
 *
 * @param occurrences - Array of occurrences to search
 * @param filePath - Path of file to filter by
 * @returns Occurrences in the specified file
 *
 * @example
 * const occurrences = await engine.gatherSymbolOccurrences("player_x");
 * const playerOccurrences = findOccurrencesInFile(occurrences, "scripts/scr_player.gml");
 * console.log(`${playerOccurrences.length} occurrences in player script`);
 */
export function findOccurrencesInFile(occurrences: Array<SymbolOccurrence>, filePath: string): Array<SymbolOccurrence> {
    Core.assertArray(occurrences, {
        errorMessage: "findOccurrencesInFile requires an array of occurrences"
    });

    if (typeof filePath !== "string" || filePath.length === 0) {
        throw new TypeError("findOccurrencesInFile requires a non-empty file path string");
    }

    return occurrences.filter((occ) => occ?.path === filePath);
}

/**
 * Count unique files affected by occurrences.
 * Useful for quick impact assessment.
 *
 * @param occurrences - Array of occurrences
 * @returns Number of unique files
 *
 * @example
 * const occurrences = await engine.gatherSymbolOccurrences("scr_enemy");
 * const fileCount = countAffectedFiles(occurrences);
 * console.log(`Rename will affect ${fileCount} files`);
 */
export function countAffectedFiles(occurrences: Array<SymbolOccurrence>): number {
    Core.assertArray(occurrences, {
        errorMessage: "countAffectedFiles requires an array of occurrences"
    });
    const files = new Set<string>();
    for (const occurrence of occurrences) {
        const path = occurrence?.path;
        if (path) {
            files.add(path);
        }
    }
    return files.size;
}
