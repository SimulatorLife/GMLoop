/**
 * Pure line-classification helpers for the synthetic-doc-merge pipeline.
 *
 * These utilities inspect doc-comment line arrays to answer narrow
 * shape questions ("does this line have a deprecated tag?", "is this a
 * multi-line summary?"). They do not mutate their inputs and have no
 * shared state, which keeps them safe to share between the merge
 * orchestrator and any future test fixtures.
 *
 * Extracted from `synthetic-merge.ts` so that the main merge module
 * focuses on orchestration rather than peppering itself with dozens of
 * small shape predicates.
 */

import { Core, type DocCommentLines, type MutableDocCommentLines } from "@gmloop/core";

import { parseDocCommentMetadata } from "./metadata.js";

const { isNonEmptyTrimmedString, toMutableArray, toTrimmedString } = Core;

const STRING_TYPE: string = "string";

/**
 * Strip the `///`, `//`, or `// /` prefix from a single trimmed doc-comment
 * line and return the remaining suffix. Returns `null` when the line does
 * not look like a doc-comment shape so callers can branch on shape.
 */
export function getDocCommentSuffix(trimmedLine: string): string | null {
    const tripleSlashMatch = trimmedLine.match(/^\/\/\/(.*)$/);
    if (tripleSlashMatch) {
        return tripleSlashMatch[1];
    }

    const docLikeMatch = trimmedLine.match(/^\/\/\s*\/(.*)$/);
    if (docLikeMatch) {
        return docLikeMatch[1];
    }

    return null;
}

/**
 * Returns true when the supplied doc-comment lines include at least two
 * non-empty summary lines before any `@tag` boundary. Single-line summaries
 * count as a single line and intentionally do not trip this predicate so
 * that downstream promotion logic only triggers on genuinely multi-line
 * narratives.
 */
export function hasMultiLineDocCommentSummary(docLines: DocCommentLines | string[]): boolean {
    if (!Array.isArray(docLines)) {
        return false;
    }

    let summaryLineCount = 0;

    for (const line of docLines) {
        if (typeof line !== STRING_TYPE) {
            break;
        }

        const trimmed = line.trim();
        if (trimmed.length === 0) {
            continue;
        }

        const suffix = getDocCommentSuffix(trimmed);
        if (!suffix || /^\s*@/i.test(suffix)) {
            break;
        }

        if (isNonEmptyTrimmedString(suffix)) {
            summaryLineCount += 1;
            if (summaryLineCount >= 2) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Returns true when any of the supplied lines parse as a doc-comment tag,
 * allowing callers to distinguish "raw text" inputs from lines that already
 * carry structured metadata.
 */
export function checkOriginalDocLinesHasTags(existingDocLines: DocCommentLines | string[]): boolean {
    return (
        Array.isArray(existingDocLines) &&
        existingDocLines.some((line) => (typeof line === STRING_TYPE ? parseDocCommentMetadata(line) : false))
    );
}

/**
 * Returns true when the supplied lines include a `@deprecated` tag. The
 * merge orchestrator uses this to choose whether to suppress function-line
 * repositioning around the deprecated marker.
 */
export function checkHasDeprecatedTag(existingDocLines: DocCommentLines | string[]): boolean {
    return (
        Array.isArray(existingDocLines) &&
        existingDocLines.some((line) => {
            if (typeof line !== STRING_TYPE) {
                return false;
            }

            const metadata = parseDocCommentMetadata(line);
            return metadata && typeof metadata.tag === STRING_TYPE && metadata.tag.toLowerCase() === "deprecated";
        })
    );
}

/**
 * Returns true when any of the supplied lines use the legacy `// /` doc
 * prefix shape rather than the canonical `///` triple-slash form. The merge
 * orchestrator treats these as candidates for prefix normalization and may
 * use them as a signal that leading summary text should be promoted.
 */
export function checkHasDocLikePrefixes(existingDocLines: DocCommentLines | string[]): boolean {
    return (
        Array.isArray(existingDocLines) &&
        existingDocLines.some((line) => (typeof line === STRING_TYPE ? /^\s*\/\/\s*\/\s*/.test(line) : false))
    );
}

/**
 * Filter out description-tag lines whose textual content is empty. Lines that
 * do not match the supplied description predicate pass through unchanged so
 * the helper composes cleanly with caller-supplied detection logic.
 */
export function filterEmptyDescriptionLines(
    docs: MutableDocCommentLines,
    isDescriptionLine: (line: string) => boolean
): MutableDocCommentLines {
    return docs.filter((line) => {
        if (typeof line !== STRING_TYPE) {
            return true;
        }

        if (!isDescriptionLine(line)) {
            return true;
        }

        const metadata = parseDocCommentMetadata(line);
        const descriptionText = typeof metadata?.name === STRING_TYPE ? metadata.name.trim() : "";

        return descriptionText.length > 0;
    });
}

/**
 * Drop empty `@description` (or `@desc`) tag lines from the supplied doc
 * collection. The mutable wrapper preserves the consumer's array flags
 * because the caller expects to keep propagating them downstream.
 */
export function filterEmptyDescriptionTags(docs: DocCommentLines): MutableDocCommentLines {
    return toMutableArray(
        docs.filter((line) => {
            if (typeof line !== STRING_TYPE) {
                return true;
            }

            if (!/^\/\/\/\s*@description\b/i.test(line.trim())) {
                return true;
            }

            const metadata = parseDocCommentMetadata(line);
            const descriptionText = toTrimmedString(metadata?.name);

            return descriptionText.length > 0;
        })
    );
}

export const syntheticMergeClassification = Object.freeze({
    checkHasDeprecatedTag,
    checkHasDocLikePrefixes,
    checkOriginalDocLinesHasTags,
    filterEmptyDescriptionLines,
    filterEmptyDescriptionTags,
    getDocCommentSuffix,
    hasMultiLineDocCommentSummary
});
