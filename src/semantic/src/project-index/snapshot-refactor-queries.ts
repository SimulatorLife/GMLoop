import path from "node:path";

import { listSemanticRenameSafetyGaps, type SemanticRenameSafetyGap } from "./rename-safety.js";
import type { SemanticOccurrence, SemanticSnapshot } from "./semantic-snapshot.js";

/** A source range returned by a pinned semantic snapshot query. */
export type SemanticSnapshotRange = Readonly<{
    end: number;
    start: number;
}>;

/** A symbol occurrence returned by a pinned semantic snapshot query. */
export type SemanticSnapshotRefactorOccurrence = Readonly<{
    end: number;
    kind: "definition" | "reference";
    path: string;
    scopeId: string | undefined;
    start: number;
}>;

/**
 * Typed, snapshot-backed semantic facts required by refactor planning.
 *
 * The surface deliberately contains facts rather than refactor policy, so
 * consumers can pass it to a refactor engine without rebuilding navigation
 * maps or reinterpreting a raw project index.
 */
export type SemanticSnapshotRefactorQueries = Readonly<{
    getFileSymbols: (filePath: string) => Array<Readonly<{ id: string }>>;
    getRenameSafetyGaps: (symbolId: string) => Array<SemanticRenameSafetyGap>;
    getSymbolAtPosition: (
        filePath: string,
        offset: number
    ) => Readonly<{ name: string; range: SemanticSnapshotRange; symbolId: string }> | null;
    getSymbolOccurrences: (symbolName: string, symbolId?: string | null) => Array<SemanticSnapshotRefactorOccurrence>;
    hasSymbol: (symbolId: string) => boolean;
    resolveSymbolId: (name: string) => string | null;
}>;

function resolveSnapshotFilePath(projectRoot: string, filePath: string): string {
    return path.resolve(projectRoot, filePath);
}

function compareOccurrences(left: SemanticOccurrence, right: SemanticOccurrence): number {
    return left.filePath === right.filePath
        ? left.start === right.start
            ? left.end - right.end
            : left.start - right.start
        : left.filePath.localeCompare(right.filePath);
}

function findSmallestOccurrenceAtOffset(
    occurrences: ReadonlyArray<SemanticOccurrence>,
    offset: number
): SemanticOccurrence | null {
    let match: SemanticOccurrence | null = null;
    for (const occurrence of occurrences) {
        if (occurrence.start > offset || occurrence.end <= offset) {
            continue;
        }
        if (match === null || occurrence.end - occurrence.start < match.end - match.start) {
            match = occurrence;
        }
    }
    return match;
}

/**
 * Create refactor query roles over one immutable semantic snapshot.
 *
 * `projectRoot` converts the snapshot's project-relative provenance paths to
 * workspace paths suitable for a refactor workspace edit.
 */
export function createSemanticSnapshotRefactorQueries(
    projectRoot: string,
    snapshot: SemanticSnapshot
): SemanticSnapshotRefactorQueries {
    const symbolById = new Map(snapshot.symbols.map((symbol) => [symbol.symbolId, symbol]));
    const symbolIdsByName = new Map<string, Array<string>>();
    const occurrencesBySymbolId = new Map<string, Array<SemanticOccurrence>>();
    const occurrencesByFilePath = new Map<string, Array<SemanticOccurrence>>();

    for (const symbol of snapshot.symbols) {
        const ids = symbolIdsByName.get(symbol.name) ?? [];
        ids.push(symbol.symbolId);
        symbolIdsByName.set(symbol.name, ids);
    }
    for (const ids of symbolIdsByName.values()) {
        ids.sort((left, right) => left.localeCompare(right));
    }
    for (const occurrence of snapshot.occurrences) {
        const bySymbol = occurrencesBySymbolId.get(occurrence.symbolId) ?? [];
        bySymbol.push(occurrence);
        occurrencesBySymbolId.set(occurrence.symbolId, bySymbol);
        const absolutePath = resolveSnapshotFilePath(projectRoot, occurrence.filePath);
        const byFile = occurrencesByFilePath.get(absolutePath) ?? [];
        byFile.push(occurrence);
        occurrencesByFilePath.set(absolutePath, byFile);
    }
    for (const occurrences of occurrencesBySymbolId.values()) {
        occurrences.sort(compareOccurrences);
    }
    for (const occurrences of occurrencesByFilePath.values()) {
        occurrences.sort(compareOccurrences);
    }

    return Object.freeze({
        getFileSymbols(filePath) {
            const symbolIds = new Set(
                (occurrencesByFilePath.get(path.resolve(filePath)) ?? [])
                    .filter((occurrence) => occurrence.role === "definition")
                    .map((occurrence) => occurrence.symbolId)
            );
            return [...symbolIds].toSorted().map((id) => Object.freeze({ id }));
        },
        getRenameSafetyGaps(symbolId) {
            return [...listSemanticRenameSafetyGaps(snapshot, symbolId)];
        },
        getSymbolAtPosition(filePath, offset) {
            const occurrence = findSmallestOccurrenceAtOffset(
                occurrencesByFilePath.get(path.resolve(filePath)) ?? [],
                offset
            );
            const symbol = occurrence === null ? undefined : symbolById.get(occurrence.symbolId);
            return occurrence === null || symbol === undefined
                ? null
                : Object.freeze({
                      name: symbol.name,
                      range: Object.freeze({ end: occurrence.end, start: occurrence.start }),
                      symbolId: occurrence.symbolId
                  });
        },
        getSymbolOccurrences(symbolName, symbolId = null) {
            const resolvedSymbolId = symbolId ?? symbolIdsByName.get(symbolName)?.[0] ?? null;
            if (resolvedSymbolId === null) {
                return [];
            }
            return (occurrencesBySymbolId.get(resolvedSymbolId) ?? []).map((occurrence) =>
                Object.freeze({
                    end: occurrence.end,
                    kind: occurrence.role,
                    path: resolveSnapshotFilePath(projectRoot, occurrence.filePath),
                    scopeId: occurrence.scopeId ?? undefined,
                    start: occurrence.start
                })
            );
        },
        hasSymbol(symbolId) {
            return symbolById.has(symbolId);
        },
        resolveSymbolId(name) {
            return symbolIdsByName.get(name)?.[0] ?? null;
        }
    });
}
