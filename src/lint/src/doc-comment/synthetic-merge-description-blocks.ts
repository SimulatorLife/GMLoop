/**
 * Description-block reordering and finalization helpers for the
 * synthetic-doc-merge pipeline.
 *
 * The merge orchestrator walks a doc-comment array, finds the
 * `@description` block, and either drops it (when the block duplicates
 * the synthetic function name) or repositions it ahead of the first
 * `@param`/`@returns` tag. These helpers are isolated here because they
 * describe a single concern — placement of the description block — and
 * keep the merge orchestrator focused on the higher-level merge
 * sequence.
 *
 * Extracted from `synthetic-merge.ts` so the description-block logic can
 * evolve (for example, to support additional description-block shapes)
 * without expanding the merge orchestrator further.
 */

import type { MutableDocCommentLines } from "@gmloop/core";

import { parseDocCommentMetadata } from "./metadata.js";
import { type DocTagHelpers, isReturnLine } from "./synthetic-merge-tag-helpers.js";

const STRING_TYPE: string = "string";

type ReorderDescriptionBlockParams = {
    docs: MutableDocCommentLines;
    docTagHelpers: DocTagHelpers;
    syntheticFunctionName: string | null;
};

/**
 * Locate the contiguous `@description` block and reposition it ahead of
 * the first `@param` or `@returns` tag. The block is omitted when its
 * body is empty or simply re-states the synthetic function name with a
 * parenthetical — in those cases the description adds no information
 * beyond what the merge already inferred.
 */
export function reorderDescriptionBlock({
    docs,
    docTagHelpers,
    syntheticFunctionName
}: ReorderDescriptionBlockParams): MutableDocCommentLines {
    const descriptionStartIndex = docs.findIndex(docTagHelpers.isDescriptionLine);
    if (descriptionStartIndex === -1) {
        return docs;
    }

    let descriptionEndIndex = descriptionStartIndex + 1;
    while (
        descriptionEndIndex < docs.length &&
        typeof docs[descriptionEndIndex] === STRING_TYPE &&
        docs[descriptionEndIndex].startsWith("///") &&
        !parseDocCommentMetadata(docs[descriptionEndIndex])
    ) {
        descriptionEndIndex += 1;
    }

    const descriptionBlock = docs.slice(descriptionStartIndex, descriptionEndIndex);
    const docsWithoutDescription = [...docs.slice(0, descriptionStartIndex), ...docs.slice(descriptionEndIndex)];

    const descriptionLine = descriptionBlock.find(docTagHelpers.isDescriptionLine);
    if (!descriptionLine) {
        return docs;
    }

    const descriptionMetadata = parseDocCommentMetadata(descriptionLine);
    const descriptionText = typeof descriptionMetadata?.name === STRING_TYPE ? descriptionMetadata.name.trim() : "";

    let shouldOmitDescriptionBlock = false;
    if (descriptionText.length === 0) {
        shouldOmitDescriptionBlock = true;
    } else if (syntheticFunctionName && descriptionText.startsWith(syntheticFunctionName)) {
        const remainder = descriptionText.slice(syntheticFunctionName.length);
        const trimmedRemainder = remainder.trim();
        if (trimmedRemainder.startsWith("(") && trimmedRemainder.endsWith(")")) {
            shouldOmitDescriptionBlock = true;
        }
    }

    if (shouldOmitDescriptionBlock) {
        return docsWithoutDescription;
    }

    let firstTagIndex = -1;
    for (const [index, element] of docsWithoutDescription.entries()) {
        if (docTagHelpers.isParamLine(element) || isReturnLine(element)) {
            firstTagIndex = index;
            break;
        }
    }

    const insertionIndex = firstTagIndex === -1 ? docsWithoutDescription.length : firstTagIndex;

    const result = [
        ...docsWithoutDescription.slice(0, insertionIndex),
        ...descriptionBlock,
        ...docsWithoutDescription.slice(insertionIndex)
    ] as any;

    if ((docs as any)._preserveDescriptionBreaks === true) {
        result._preserveDescriptionBreaks = true;
    }

    return result;
}

type FinalizeDescriptionBlocksParams = {
    docs: MutableDocCommentLines;
    docTagHelpers: DocTagHelpers;
    preserveDescriptionBreaks: boolean;
    options: any;
};

/**
 * Final description-block post-processing pass. To align with Prettier's
 * default behaviour the helper intentionally does not reflow doc comments
 * to fit the configured `printWidth`; user-authored line breaks are
 * preserved verbatim so that synthetic doc-comment generation cannot
 * introduce surprise rewrites. The params are kept in the signature for
 * future extension without forcing callers to update their call sites.
 */
export function finalizeDescriptionBlocks({ docs }: FinalizeDescriptionBlocksParams): MutableDocCommentLines {
    // To align with Prettier's default behavior, we never break up or reflow doc comments
    // to fit the printWidth. Returning the original lines ensures that user-defined
    // line breaks and formatting are preserved.
    return docs;
}

export type { FinalizeDescriptionBlocksParams, ReorderDescriptionBlockParams };

export const syntheticMergeDescriptionBlocks = Object.freeze({
    finalizeDescriptionBlocks,
    reorderDescriptionBlock
});
