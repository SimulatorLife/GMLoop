import { Core } from "@gmloop/core";
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

/**
 * Convert doc-comment entries to printable raw-text docs without content
 * normalization.
 *
 * Returns a fresh `Doc[]` whose entries are derived from `docCommentDocs`
 * without modifying the input array. Each source entry contributes at most
 * one element to the returned array:
 *
 * - When the source entry coerces to raw text (string, AST comment, or
 *   `.raw` payload), the resulting string is included.
 * - Entries that cannot be coerced to raw text are skipped, matching the
 *   pre-refactor behaviour.
 *
 * The function is intentionally pure: callers can safely pass an array
 * shared with other code paths without worrying about a hidden in-place
 * rewrite of the input. This matches the broader "loop mutability
 * hazards" cleanup (e.g. PR #10603) that removed shared mutable
 * references in batch helpers across the codebase.
 */
export function buildPrintableDocCommentLines(
    docCommentDocs: ReadonlyArray<unknown>,
    originalText: string | null
): Doc[] {
    const result: Doc[] = [];
    for (const entry of docCommentDocs) {
        const rawText = coerceDocCommentEntryToRawText(entry, originalText);
        if (rawText !== null) {
            result.push(rawText);
        }
    }

    return result;
}
