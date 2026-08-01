import type { Scope } from "./scope.js";

/**
 * Builds a directed path-level dependency graph over the given input paths.
 * Edges point from dependency to dependent (D→P means "P depends on D").
 *
 * @param inputPaths - Normalized path → original path map.
 * @param pathToScopesIndex - Maps normalized file paths to scope IDs.
 * @param scopesById - Maps scope IDs to Scope instances.
 * @param resolveDeclaringScopeId - Resolves a symbol name and scope to its declaring scope ID.
 * @returns `edges` (dependency → Set of dependents) and `inDegree` (path → number of incoming edges).
 */
export function buildPathLevelDependencyGraph(
    inputPaths: Map<string, string>,
    pathToScopesIndex: Map<string, Set<string>>,
    scopesById: Map<string, Scope>,
    resolveDeclaringScopeId: (name: string, scopeId: string) => string | null
): {
    edges: Map<string, Set<string>>;
    inDegree: Map<string, number>;
} {
    const edges = new Map<string, Set<string>>();
    const inDegree = new Map<string, number>();

    for (const normalisedPath of inputPaths.keys()) {
        inDegree.set(normalisedPath, 0);
        edges.set(normalisedPath, new Set());
    }

    const ctx: CrossPathEdgeContext = { scopesById, resolveDeclaringScopeId };
    for (const [normalisedPath] of inputPaths) {
        populatePathEdgesFromScopes(normalisedPath, inputPaths, edges, inDegree, pathToScopesIndex, ctx);
    }

    return { edges, inDegree };
}

function populatePathEdgesFromScopes(
    normalisedPath: string,
    inputPaths: Map<string, string>,
    edges: Map<string, Set<string>>,
    inDegree: Map<string, number>,
    pathToScopesIndex: Map<string, Set<string>>,
    ctx: CrossPathEdgeContext
): void {
    const scopeIds = pathToScopesIndex.get(normalisedPath);
    if (!scopeIds || scopeIds.size === 0) {
        return;
    }

    for (const scopeId of scopeIds) {
        const scope = ctx.scopesById.get(scopeId);
        if (!scope) {
            continue;
        }

        for (const [name, entry] of scope.occurrences) {
            if (entry.references.length === 0) {
                continue;
            }
            recordCrossPathDependencyEdge(name, scopeId, scope, normalisedPath, inputPaths, edges, inDegree, ctx);
        }
    }
}

interface CrossPathEdgeContext {
    scopesById: Map<string, Scope>;
    resolveDeclaringScopeId: (name: string, scopeId: string) => string | null;
}

function recordCrossPathDependencyEdge(
    name: string,
    scopeId: string,
    scope: Scope,
    normalisedPath: string,
    inputPaths: Map<string, string>,
    edges: Map<string, Set<string>>,
    inDegree: Map<string, number>,
    ctx: CrossPathEdgeContext
): void {
    // Skip symbols declared locally — they don't create a cross-file edge.
    if (scope.symbolMetadata.has(name)) {
        return;
    }

    const declaringId = ctx.resolveDeclaringScopeId(name, scopeId);
    if (!declaringId || declaringId === scopeId) {
        return;
    }

    const declaringPath = ctx.scopesById.get(declaringId)?.metadata.path;
    if (!declaringPath) {
        return;
    }

    const normDeclaringPath = declaringPath.includes("\\") ? declaringPath.replaceAll("\\", "/") : declaringPath;
    if (normDeclaringPath === normalisedPath || !inputPaths.has(normDeclaringPath)) {
        return;
    }

    const outEdges = edges.get(normDeclaringPath);
    if (outEdges && !outEdges.has(normalisedPath)) {
        outEdges.add(normalisedPath);
        inDegree.set(normalisedPath, (inDegree.get(normalisedPath) ?? 0) + 1);
    }
}

/**
 * Normalizes a tracked file path to POSIX separators for stable indexing.
 */
function normalizeTrackedPath(path: string): string {
    return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}

/**
 * Normalizes an iterable of raw paths to a deduplicated map of normalized → original.
 */
export function collectNormalisedInputPaths(paths: Iterable<string>): Map<string, string> {
    const inputPaths = new Map<string, string>();
    for (const p of paths) {
        if (p && typeof p === "string" && p.length > 0) {
            const normalised = normalizeTrackedPath(p);
            if (!inputPaths.has(normalised)) {
                inputPaths.set(normalised, p);
            }
        }
    }
    return inputPaths;
}

/**
 * Decrements in-degrees for all paths that depend on `current`, and
 * appends any newly zero-in-degree paths to `queue` in lexicographic order.
 */
export function advanceTopologicalWave(
    current: string,
    edges: Map<string, Set<string>>,
    inDegree: Map<string, number>,
    queue: string[]
): void {
    const dependents = edges.get(current);
    if (!dependents) {
        return;
    }

    const newlyReady: string[] = [];
    for (const dep of dependents) {
        const newDegree = (inDegree.get(dep) ?? 1) - 1;
        inDegree.set(dep, newDegree);
        if (newDegree === 0) {
            newlyReady.push(dep);
        }
    }
    newlyReady.sort();
    for (const p of newlyReady) {
        queue.push(p);
    }
}

/**
 * Applies Kahn's topological sort to the dependency graph and returns the
 * ordered array of original (non-normalised) paths.
 *
 * Paths that remain in the graph after the sort (i.e. part of a cycle) are
 * appended in lexicographic order.
 */
export function topologicallySortPaths(
    inputPaths: Map<string, string>,
    edges: Map<string, Set<string>>,
    inDegree: Map<string, number>
): string[] {
    const queue: string[] = [];
    for (const [normalisedPath, degree] of inDegree) {
        if (degree === 0) {
            queue.push(normalisedPath);
        }
    }
    queue.sort();

    const result: string[] = [];
    let queueIndex = 0;
    while (queueIndex < queue.length) {
        const current = queue[queueIndex];
        queueIndex += 1;
        const original = inputPaths.get(current);
        if (original !== undefined) {
            result.push(original);
        }
        advanceTopologicalWave(current, edges, inDegree, queue);
    }

    const cycleNodes: string[] = [];
    for (const [normalisedPath, degree] of inDegree) {
        if (degree > 0) {
            const original = inputPaths.get(normalisedPath);
            if (original !== undefined) {
                cycleNodes.push(original);
            }
        }
    }
    cycleNodes.sort();
    result.push(...cycleNodes);

    return result;
}
