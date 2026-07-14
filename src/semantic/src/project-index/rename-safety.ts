import type { SemanticSnapshot, SemanticUncertainResolution } from "./semantic-snapshot.js";

/** A semantic fact that blocks a project-wide rename. */
export type SemanticRenameSafetyGap =
    | Readonly<{
          kind: "incompleteTier";
          message: string;
          symbolId: string;
      }>
    | Readonly<{
          end: number;
          filePath: string;
          kind: "uncertainReference";
          message: string;
          name: string;
          resolution: SemanticUncertainResolution;
          start: number;
          symbolId: string;
      }>;

/** Snapshot-backed query role consumed by refactor preflight. */
export type SemanticRenameSafetyProvider = Readonly<{
    getRenameSafetyGaps: (symbolId: string) => ReadonlyArray<SemanticRenameSafetyGap>;
}>;

function describesTargetSymbol(resolution: SemanticUncertainResolution, symbolId: string): boolean {
    if (resolution.kind === "candidate" || resolution.kind === "ambiguous") {
        return resolution.candidateSymbolIds.includes(symbolId);
    }
    return true;
}

function describeResolution(resolution: SemanticUncertainResolution): string {
    switch (resolution.kind) {
        case "candidate": {
            return "a candidate binding";
        }
        case "ambiguous": {
            return "an ambiguous binding";
        }
        case "dynamic": {
            return "a dynamic binding";
        }
        case "invalid": {
            return "an invalid binding";
        }
        case "unresolved": {
            return "an unresolved binding";
        }
    }
}

/**
 * List the exact full-tier uncertainty facts that make a rename unsafe.
 *
 * The caller must use the result as a blocking preflight condition: a rename
 * cannot prove its closure while a same-name reference has no exact binding.
 */
export function listSemanticRenameSafetyGaps(
    snapshot: SemanticSnapshot,
    symbolId: string
): ReadonlyArray<SemanticRenameSafetyGap> {
    if (snapshot.tier !== "full") {
        return Object.freeze([
            Object.freeze({
                kind: "incompleteTier",
                message: "Rename safety requires a compatible full semantic snapshot.",
                symbolId
            })
        ]);
    }
    const targetSymbol = snapshot.symbols.find((symbol) => symbol.symbolId === symbolId);
    if (targetSymbol === undefined) {
        return Object.freeze([
            Object.freeze({
                kind: "incompleteTier",
                message: `The requested symbol '${symbolId}' is absent from the full semantic snapshot.`,
                symbolId
            })
        ]);
    }
    return Object.freeze(
        snapshot.unresolvedReferences
            .filter(
                (reference) =>
                    reference.name === targetSymbol.name && describesTargetSymbol(reference.resolution, symbolId)
            )
            .map((reference) =>
                Object.freeze({
                    end: reference.end,
                    filePath: reference.filePath,
                    kind: "uncertainReference" as const,
                    message: `Cannot safely rename '${targetSymbol.name}': ${describeResolution(reference.resolution)} exists at ${reference.filePath}:${String(reference.start)}-${String(reference.end)}.`,
                    name: reference.name,
                    resolution: reference.resolution,
                    start: reference.start,
                    symbolId
                })
            )
            .toSorted((left, right) =>
                left.filePath === right.filePath
                    ? left.start - right.start
                    : left.filePath.localeCompare(right.filePath)
            )
    );
}

/** Create a pinned-snapshot rename-safety query role for a downstream consumer. */
export function createSemanticRenameSafetyProvider(snapshot: SemanticSnapshot): SemanticRenameSafetyProvider {
    return Object.freeze({
        getRenameSafetyGaps: (symbolId: string) => listSemanticRenameSafetyGaps(snapshot, symbolId)
    });
}
