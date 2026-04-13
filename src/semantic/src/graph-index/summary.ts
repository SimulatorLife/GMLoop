import path from "node:path";

import type { GraphEdgeType, GraphNodeKind } from "./types.js";

type SummaryDescriptor = Readonly<{
    docCommentSummary?: string | null;
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
    docCommentSummary = null,
    edgeTypes = [],
    filePath = null,
    kind,
    name,
    resourcePath = null
}: SummaryDescriptor): string {
    if (docCommentSummary && docCommentSummary.trim().length > 0) {
        return docCommentSummary.trim();
    }

    const location = filePath ?? resourcePath;
    const relationshipSummary =
        edgeTypes.length === 0 ? "" : ` Tracks ${edgeTypes.slice(0, 3).join(", ")} relationships.`;
    const locationSummary = location ? ` Defined in ${location}.` : "";

    return `${humanizeKind(kind)} '${name}'.${locationSummary}${relationshipSummary}`.trim();
}

/**
 * Extract the first sentence from the doc comment immediately preceding a declaration.
 */
export function extractDocCommentFirstSentence(
    sourceText: string | null,
    declarationStartIndex: number | null
): string | null {
    if (typeof sourceText !== "string" || typeof declarationStartIndex !== "number" || declarationStartIndex <= 0) {
        return null;
    }

    const beforeDeclaration = sourceText.slice(0, declarationStartIndex);
    const lines = beforeDeclaration.split(/\r?\n/u);
    const commentLines: Array<string> = [];

    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]?.trim() ?? "";
        if (line.length === 0) {
            if (commentLines.length === 0) {
                continue;
            }
            break;
        }

        if (!line.startsWith("///")) {
            break;
        }

        commentLines.unshift(line.replace(/^\/\/\/\s?/u, "").replace(/^@description\s+/u, ""));
    }

    const text = commentLines.join(" ").trim();
    if (text.length === 0) {
        return null;
    }

    const sentenceMatch = /.+?(?:[.!?](?:\s|$)|$)/u.exec(text);
    return sentenceMatch?.[0]?.trim() ?? null;
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

    if (typeof startIndex !== "number" || startIndex < 0) {
        return "";
    }

    const safeStart = startIndex;
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
