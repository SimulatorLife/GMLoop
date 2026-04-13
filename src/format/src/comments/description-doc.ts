import { Core, type MutableDocCommentLines } from "@gmloop/core";
import { type Doc } from "prettier";

function getRawLineCommentText(commentEntry: Record<string, unknown>, originalText: string | null): string {
    return Core.getLineCommentRawText(commentEntry, {
        originalText: originalText ?? undefined
    });
}

function getRawBlockCommentText(commentEntry: Record<string, unknown>, originalText: string | null): string {
    if (typeof originalText === "string") {
        const startIndex = Core.getCommentBoundaryIndex(commentEntry, "start");
        const endIndex = Core.getCommentBoundaryIndex(commentEntry, "end");
        if (typeof startIndex === "number" && typeof endIndex === "number" && endIndex >= startIndex) {
            return originalText.slice(startIndex, endIndex + 1);
        }
    }

    if (typeof commentEntry.raw === "string") {
        return commentEntry.raw;
    }

    const commentValue = typeof commentEntry.value === "string" ? commentEntry.value : "";
    return `/*${commentValue}*/`;
}

function coerceDocCommentEntryToRawText(entry: unknown, originalText: string | null): string | null {
    if (typeof entry === "string") {
        return entry;
    }

    if (!Core.isObjectLike(entry)) {
        return null;
    }
    const commentEntry = entry as Record<string, unknown>;

    if (commentEntry.type === "CommentLine") {
        return getRawLineCommentText(commentEntry, originalText);
    }

    if (commentEntry.type === "CommentBlock") {
        return getRawBlockCommentText(commentEntry, originalText);
    }

    if (typeof commentEntry.raw === "string") {
        return commentEntry.raw;
    }

    return null;
}

function coerceDocCommentEntriesToRawLines(docCommentDocs: MutableDocCommentLines, originalText: string | null): void {
    for (let index = 0; index < docCommentDocs.length; index += 1) {
        const rawText = coerceDocCommentEntryToRawText(docCommentDocs[index], originalText);
        if (rawText !== null) {
            docCommentDocs[index] = rawText;
        }
    }
}

/**
 * Convert doc-comment entries to printable raw-text docs without content normalization.
 */
export function buildPrintableDocCommentLines(
    docCommentDocs: MutableDocCommentLines,
    originalText: string | null
): Doc[] {
    coerceDocCommentEntriesToRawLines(docCommentDocs, originalText);

    const result: Doc[] = [];
    for (const entry of docCommentDocs) {
        if (typeof entry === "string") {
            result.push(entry);
        }
    }

    return result;
}
