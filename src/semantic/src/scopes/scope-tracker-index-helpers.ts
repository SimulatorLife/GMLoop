import type { Scope } from "./scope.js";
import type { ScopeSummary } from "./types.js";

/**
 * Collects non-empty symbol names while preserving first-seen order.
 */
export function collectUniqueSymbolNames(names: Iterable<string>): string[] {
    const uniqueNames = new Set<string>();

    for (const name of names) {
        if (!name) {
            continue;
        }

        uniqueNames.add(name);
    }

    return [...uniqueNames];
}

/**
 * Normalizes a tracked file path to POSIX separators for stable indexing.
 */
export function normalizeTrackedPath(path: string): string {
    // Most tracked paths are already POSIX-style, so avoid the replaceAll()
    // scan and string allocation on that common case.
    return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}

/**
 * Resolves tracked scope summaries for a symbol name when the symbol is indexed.
 */
export function getTrackedSymbolSummaries(
    name: string | null | undefined,
    symbolToScopesIndex: Map<string, Map<string, ScopeSummary>>
): Map<string, ScopeSummary> | null {
    if (!name) {
        return null;
    }

    const scopeSummaryMap = symbolToScopesIndex.get(name);
    if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
        return null;
    }

    return scopeSummaryMap;
}

/**
 * Collects the set of normalized file paths that match the selected occurrence kind.
 */
export function collectFilePathsForSymbolSummaries(
    scopeSummaryMap: Map<string, ScopeSummary>,
    occurrenceKind: "declaration" | "reference",
    scopesById: Map<string, Scope>,
    normalizedPathCache?: Map<string, string>
): Set<string> {
    const paths = new Set<string>();

    for (const [scopeId, summary] of scopeSummaryMap) {
        if (occurrenceKind === "declaration" && !summary.hasDeclaration) {
            continue;
        }

        if (occurrenceKind === "reference" && !summary.hasReference) {
            continue;
        }

        const scope = scopesById.get(scopeId);
        const path = scope?.metadata.path;
        if (path) {
            const cachedPath = normalizedPathCache?.get(path);
            if (cachedPath) {
                paths.add(cachedPath);
                continue;
            }

            const normalizedPath = normalizeTrackedPath(path);
            normalizedPathCache?.set(path, normalizedPath);
            paths.add(normalizedPath);
        }
    }

    return paths;
}

/**
 * Updates the last-modified index entry for a scope's file path.
 */
export function updatePathLastModifiedForScope(scope: Scope, pathLastModifiedIndex: Map<string, number>): void {
    const path = scope.metadata.path;
    if (!path) {
        return;
    }

    const timestamp = scope.lastModifiedTimestamp;
    if (timestamp < 0) {
        return;
    }

    const trackedPath = normalizeTrackedPath(path);
    const previousTimestamp = pathLastModifiedIndex.get(trackedPath);
    if (previousTimestamp === undefined || timestamp > previousTimestamp) {
        pathLastModifiedIndex.set(trackedPath, timestamp);
    }
}

/**
 * Recomputes the max last-modified timestamp for all scopes tied to a file path.
 */
export function recomputePathLastModified(
    path: string,
    pathToScopesIndex: Map<string, Set<string>>,
    scopesById: Map<string, Scope>,
    pathLastModifiedIndex: Map<string, number>
): void {
    const trackedPath = normalizeTrackedPath(path);
    const scopeIds = pathToScopesIndex.get(trackedPath);
    if (!scopeIds || scopeIds.size === 0) {
        pathLastModifiedIndex.delete(trackedPath);
        return;
    }

    let latestTimestamp = -1;
    for (const scopeId of scopeIds) {
        const scope = scopesById.get(scopeId);
        if (!scope) {
            continue;
        }

        if (scope.lastModifiedTimestamp > latestTimestamp) {
            latestTimestamp = scope.lastModifiedTimestamp;
        }
    }

    if (latestTimestamp < 0) {
        pathLastModifiedIndex.delete(trackedPath);
        return;
    }

    pathLastModifiedIndex.set(trackedPath, latestTimestamp);
}
