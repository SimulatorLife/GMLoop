import path from "node:path";

import type { GraphEdgeType, GraphNodeKind } from "./types.js";

type SummaryDescriptor = Readonly<{
    edgeTypes?: ReadonlyArray<GraphEdgeType>;
    filePath?: string | null;
    kind: GraphNodeKind;
    name: string;
    resourcePath?: string | null;
}>;

function humanizeKind(kind: GraphNodeKind): string {
    return kind.replaceAll("_", " ");
}

/**
 * Build a deterministic one-line summary for a graph node.
 */
export function createGraphNodeSummary({
    edgeTypes = [],
    filePath = null,
    kind,
    name,
    resourcePath = null
}: SummaryDescriptor): string {
    const location = filePath ?? resourcePath;
    const relationshipSummary =
        edgeTypes.length === 0 ? "" : ` Tracks ${edgeTypes.slice(0, 3).join(", ")} relationships.`;
    const locationSummary = location ? ` Defined in ${location}.` : "";

    return `${humanizeKind(kind)} '${name}'.${locationSummary}${relationshipSummary}`.trim();
}

/**
 * Create a compact declaration snippet from source text.
 */
export function createGraphNodeSnippet(
    sourceText: string | null | undefined,
    startIndex: number | null | undefined,
    endIndex: number | null | undefined
): string {
    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return "";
    }

    const safeStart = typeof startIndex === "number" && startIndex >= 0 ? startIndex : 0;
    const safeEnd =
        typeof endIndex === "number" && endIndex > safeStart
            ? Math.min(sourceText.length, endIndex + 120)
            : Math.min(sourceText.length, safeStart + 240);

    return sourceText.slice(safeStart, safeEnd).trim().replaceAll(/\s+/g, " ").slice(0, 280);
}

/**
 * Create lightweight aliases used for exact and fuzzy matching.
 */
export function createGraphAliases(name: string, filePath: string | null, resourcePath: string | null): Array<string> {
    const aliases = new Set<string>([name, name.toLowerCase()]);

    if (filePath) {
        aliases.add(filePath);
        aliases.add(path.posix.basename(filePath));
        aliases.add(path.posix.basename(filePath, path.posix.extname(filePath)));
    }

    if (resourcePath) {
        aliases.add(resourcePath);
        aliases.add(path.posix.basename(resourcePath));
        aliases.add(path.posix.basename(resourcePath, path.posix.extname(resourcePath)));
    }

    return [...aliases].filter((entry) => entry.trim().length > 0);
}
