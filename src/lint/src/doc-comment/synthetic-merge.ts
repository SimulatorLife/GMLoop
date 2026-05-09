import { Core, type DocCommentLines, type MutableDocCommentLines } from "@gmloop/core";

import {
    convertLegacyReturnsDescriptionLinesToMetadata,
    dedupeReturnDocLines,
    hasLegacyReturnsDescriptionLines,
    promoteLeadingDocCommentTextToDescription,
    reorderDescriptionLinesToTop
} from "./legacy.js";
import { parseDocCommentMetadata } from "./metadata.js";
import { computeSyntheticFunctionDocLines } from "./synthetic-generation.js";
import {
    collectImplicitArgumentDocNames,
    getParameterDocInfo,
    type ImplicitArgumentDocEntry,
    preferredParamDocNamesByNode,
    suppressedImplicitDocCanonicalByNode
} from "./synthetic-helpers.js";

const {
    copyDocCommentArrayFlags,
    findLastIndex,
    getCanonicalParamNameFromText,
    isNonEmptyArray,
    isNonEmptyString,
    isNonEmptyTrimmedString,
    normalizeDocCommentTypeAnnotations,
    normalizeGameMakerType,
    toMutableArray,
    toTrimmedString
} = Core;

const STRING_TYPE: string = "string";

function getDocCommentSuffix(trimmedLine: string): string | null {
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

function hasMultiLineDocCommentSummary(docLines: DocCommentLines | string[]): boolean {
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

function checkOriginalDocLinesHasTags(existingDocLines: DocCommentLines | string[]): boolean {
    return (
        Array.isArray(existingDocLines) &&
        existingDocLines.some((line) => (typeof line === STRING_TYPE ? parseDocCommentMetadata(line) : false))
    );
}

function checkHasDeprecatedTag(existingDocLines: DocCommentLines | string[]): boolean {
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

function checkHasDocLikePrefixes(existingDocLines: DocCommentLines | string[]): boolean {
    return (
        Array.isArray(existingDocLines) &&
        existingDocLines.some((line) => (typeof line === STRING_TYPE ? /^\s*\/\/\s*\/\s*/.test(line) : false))
    );
}

function filterEmptyDescriptionLines(
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
    }) as MutableDocCommentLines;
}

function filterEmptyDescriptionTags(docs: DocCommentLines): MutableDocCommentLines {
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
    ) as MutableDocCommentLines;
}

export function mergeSyntheticDocComments(
    node: any,
    existingDocLines: DocCommentLines | string[],
    options: any,
    overrides: any = {}
): MutableDocCommentLines {
    let normalizedExistingLines: MutableDocCommentLines = toMutableArray(
        existingDocLines.map((line) => line.trim())
    ) as MutableDocCommentLines;

    copyDocCommentArrayFlags(existingDocLines as any, normalizedExistingLines);
    const originalExistingHasTags = checkOriginalDocLinesHasTags(existingDocLines);
    const originalHasDeprecatedTag = checkHasDeprecatedTag(existingDocLines);

    // Compute synthetic lines early so promotion can consider synthetic tags
    // such as `/// @function` when deciding whether the file-top doc-like
    // comment text should be promoted into `@description` metadata.
    let preserveDescriptionBreaks = (existingDocLines as DocCommentLines)._preserveDescriptionBreaks === true;

    normalizedExistingLines = toMutableArray(
        reorderDescriptionLinesToTop(normalizedExistingLines)
    ) as MutableDocCommentLines;

    if (preserveDescriptionBreaks) {
        normalizedExistingLines._preserveDescriptionBreaks = true;
    }
    const dedupedResult = dedupeReturnDocLines(normalizedExistingLines);
    normalizedExistingLines = toMutableArray(dedupedResult.lines) as MutableDocCommentLines;
    const removedExistingReturnDuplicates = dedupedResult.removed;

    if (preserveDescriptionBreaks) {
        normalizedExistingLines._preserveDescriptionBreaks = true;
    }

    // Normalize legacy `Returns:` description lines early so the synthetic
    // computation sees an existing `@returns` tag when conversion occurs.
    // This prevents synthetic `@returns` entries from being added and
    // avoids conversion regressions where a legacy description would be
    // overwritten or duplicated by a synthetic `@returns` later in the
    // merging process.
    normalizedExistingLines = toMutableArray(
        convertLegacyReturnsDescriptionLinesToMetadata(normalizedExistingLines, {
            normalizeDocCommentTypeAnnotations: normalizeGameMakerType
        })
    ) as MutableDocCommentLines;

    const _computedSynthetic = computeSyntheticFunctionDocLines(node, normalizedExistingLines, options, overrides);

    // Only promote leading doc comment text to @description if the original
    // set contained tags (e.g., `@param`), used an alternate doc-like prefix
    // that should normalize (e.g., `// /`), or already included multi-line
    // summary text. This guards against synthetic tags causing plain single-
    // line summaries to be promoted unexpectedly while still supporting
    // multi-line narratives.
    const originalExistingHasDocLikePrefixes = checkHasDocLikePrefixes(existingDocLines);
    const hasMultiLineSummary = hasMultiLineDocCommentSummary(existingDocLines);

    ({ normalizedExistingLines, preserveDescriptionBreaks } = applyDocCommentPromotionIfNeeded({
        normalizedExistingLines,
        preserveDescriptionBreaks,
        syntheticLines: _computedSynthetic,
        originalExistingHasTags,
        originalExistingHasDocLikePrefixes,
        hasMultiLineSummary
    }));

    const syntheticLinesSource = reorderDescriptionLinesToTop(_computedSynthetic);
    const syntheticLines = toMutableArray(syntheticLinesSource) as MutableDocCommentLines;

    if ((syntheticLinesSource as any)?._preserveDescriptionBreaks === true) {
        syntheticLines._preserveDescriptionBreaks = true;
    }

    if ((syntheticLinesSource as any)?._suppressLeadingBlank === true) {
        syntheticLines._suppressLeadingBlank = true;
    }

    const implicitDocEntries =
        node?.type === "FunctionDeclaration" ||
        node?.type === "StructFunctionDeclaration" ||
        node?.type === "FunctionExpression"
            ? collectImplicitArgumentDocNames(node, options)
            : [];
    const declaredParamCount = Array.isArray(node?.params) ? node.params.length : 0;
    const hasImplicitDocEntries = implicitDocEntries.length > 0;
    const hasParamDocLines = normalizedExistingLines.some((line) => {
        if (typeof line !== STRING_TYPE) {
            return false;
        }

        return /^\/\/\/\s*@param\b/i.test(toTrimmedString(line));
    });
    const shouldForceParamPrune = hasParamDocLines && declaredParamCount === 0 && !hasImplicitDocEntries;

    const earlyReturn = attemptEarlyReturnOnSynthetic({
        syntheticLines,
        normalizedExistingLines,
        shouldForceParamPrune,
        existingDocLines,
        overrides
    });
    if (earlyReturn) {
        return earlyReturn;
    }

    const docTagHelpers = createDocTagHelpers();
    const mergeResult = mergeDocLines({
        normalizedExistingLines,
        syntheticLines,
        docTagHelpers,
        originalExistingHasTags,
        removedExistingReturnDuplicates
    });
    let { result, otherLines, returnsLines, removedAnyLine, syntheticFunctionName } = mergeResult;

    // Propagate the _preserveDescriptionBreaks flag from normalizedExistingLines to result
    if ((normalizedExistingLines as any)?._preserveDescriptionBreaks === true) {
        (result as any)._preserveDescriptionBreaks = true;
    }

    ({ result, removedAnyLine } = mergeReturnDocLinesAndRepositionFunctionTag({
        result,
        returnsLines,
        removedAnyLine,
        docTagHelpers,
        originalHasDeprecatedTag
    }));

    const suppressedCanonicals = suppressedImplicitDocCanonicalByNode.get(node);

    let reorderedDocs: MutableDocCommentLines = reorderParamDocLines({
        node,
        options,
        result,
        docTagHelpers,
        implicitDocEntries,
        declaredParamCount,
        suppressedCanonicals
    });

    reorderedDocs = reorderDescriptionBlock({
        docs: reorderedDocs,
        docTagHelpers,
        syntheticFunctionName
    });

    reorderedDocs = toMutableArray(reorderDescriptionLinesToTop(reorderedDocs)) as MutableDocCommentLines;

    reorderedDocs = filterEmptyDescriptionLines(reorderedDocs, docTagHelpers.isDescriptionLine);

    if (suppressedCanonicals && suppressedCanonicals.size > 0) {
        reorderedDocs = reorderedDocs.filter((line) => {
            if (!docTagHelpers.isParamLine(line)) {
                return true;
            }

            const canonical = docTagHelpers.getParamCanonicalName(line);
            return !canonical || !suppressedCanonicals.has(canonical);
        });
    }

    reorderedDocs = reorderedDocs.map((line) => {
        if (!docTagHelpers.isParamLine(line)) {
            return line;
        }

        const match = line.match(/^(\/\/\/\s*@param\s*)((?:\{[^}]*\}|<[^>]*>)\s*)?(.*)$/i);
        if (!match) {
            return normalizeDocCommentTypeAnnotations(line);
        }

        const [, prefix, rawTypeSection = "", rawNameSection = ""] = match;
        const nameSplit = splitParamNameAndRemainder(rawNameSection);
        if (!nameSplit) {
            return normalizeDocCommentTypeAnnotations(line);
        }

        const { name: rawName, remainder } = nameSplit;
        const normalizedPrefix = `${prefix.replace(/\s*$/, "")} `;
        let normalizedTypeSection = rawTypeSection.trim();
        if (normalizedTypeSection.startsWith("{") && normalizedTypeSection.endsWith("}")) {
            const innerType = normalizedTypeSection.slice(1, -1);
            const normalizedInner = normalizeGameMakerType(innerType.replaceAll("|", ","));
            normalizedTypeSection = `{${normalizedInner}}`;
        } else if (normalizedTypeSection.startsWith("<") && normalizedTypeSection.endsWith(">")) {
            const innerType = normalizedTypeSection.slice(1, -1);
            const normalizedInner = normalizeGameMakerType(innerType.replaceAll("|", ","));
            normalizedTypeSection = `{${normalizedInner}}`;
        }
        const typePart = normalizedTypeSection.length > 0 ? `${normalizedTypeSection} ` : "";
        const normalizedName = rawName.trim();
        const remainingRemainder = remainder;

        const remainderText = remainingRemainder.trim();
        const hasDescription = remainderText.length > 0;
        let descriptionPart = "";

        if (hasDescription) {
            const hyphenMatch = remainingRemainder.match(/^(\s*-\s*)(.*)$/);
            let normalizedDescription: string;

            if (hyphenMatch) {
                const rawDescription = hyphenMatch[2] ?? "";
                normalizedDescription = rawDescription.trim();
            } else {
                normalizedDescription = remainderText.replace(/^[-\s]+/, "");
            }

            if (normalizedDescription.length > 0) {
                descriptionPart = ` ${normalizedDescription}`;
            }
        }

        const updatedLine = `${normalizedPrefix}${typePart}${normalizedName}${descriptionPart}`;
        return normalizeDocCommentTypeAnnotations(updatedLine);
    });

    if ((result as any)?._preserveDescriptionBreaks === true) {
        preserveDescriptionBreaks = true;
    }

    result = finalizeDescriptionBlocks({
        docs: reorderedDocs,
        docTagHelpers,
        preserveDescriptionBreaks,
        options
    });

    if (removedAnyLine || otherLines.length > 0) {
        result._suppressLeadingBlank = true;
    }

    let filteredResult: MutableDocCommentLines = filterEmptyDescriptionTags(result);

    if (result._suppressLeadingBlank) {
        filteredResult._suppressLeadingBlank = true;
    }

    // If synthetic tags were computed and merged above, re-run promotion to
    // convert leading doc-like summary lines into a `@description` tag when a
    // doc tag now follows the summary. This can happen when the tag is
    // synthetic (inserted by computeSyntheticFunctionDocLines) and not present
    // in the original `existingDocLines` — re-running promotion here ensures
    // the presence of synthetic tags enables the promotion and avoids leaving
    // the summary as a plain inline/trailing comment.
    try {
        // Prevent unwanted @description promotions for plain triple-slash summaries.
        // The promotion logic triggers when existing doc lines contain metadata tags
        // or use the doc-like `// /` prefix style. Without this guard, synthetic
        // tags (e.g., @param entries auto-generated during the merge) would cause
        // plain summary comments to be promoted to @description tags, changing the
        // comment's presentation. We only run promotion when the original source
        // already had structured metadata, ensuring synthetic additions don't alter
        // the author's intended comment style.
        const hasDescriptionTag = filteredResult.some(
            (line) => typeof line === STRING_TYPE && /^\/\/\/\s*@description\b/i.test(line.trim())
        );

        if ((originalExistingHasTags || originalExistingHasDocLikePrefixes) && !hasDescriptionTag) {
            filteredResult = toMutableArray(
                promoteLeadingDocCommentTextToDescription(filteredResult)
            ) as MutableDocCommentLines;
        }
    } catch {
        // Tolerate missing Core service during test scenarios or when the doc
        // comment service is unavailable. The promotion step is a formatting
        // enhancement, not a critical requirement, so we fall back to the
        // unpromoted result rather than throwing. This defensive posture keeps
        // the merge operation resilient across different runtime contexts without
        // sacrificing correctness.
    }

    // If the original existing doc lines contained plain triple-slash
    // summary lines but no explicit doc tags, prefer to keep the summary
    // as plain text rather than a promoted `@description` tag and ensure a
    // blank line separates the summary from the synthetic metadata.
    try {
        const originalHasPlainSummary =
            Array.isArray(existingDocLines) &&
            existingDocLines.some((l) => (typeof l === STRING_TYPE ? /^\/\/\/\s*(?!@).+/.test(l.trim()) : false));
        const originalHasTags =
            Array.isArray(existingDocLines) &&
            existingDocLines.some((l) => (typeof l === STRING_TYPE ? parseDocCommentMetadata(l) : false));
        const hasMultiLineSummaryInExisting = hasMultiLineDocCommentSummary(existingDocLines);
        if (originalHasPlainSummary && !originalHasTags && !hasMultiLineSummaryInExisting) {
            const summaryLines = [] as string[];
            const remainingLines = [] as string[];

            for (const ln of filteredResult) {
                if (typeof ln !== STRING_TYPE) continue;
                if (/^\/\/\/\s*@description\b/i.test(ln.trim())) {
                    const meta = parseDocCommentMetadata(ln);
                    const descriptionText = typeof meta?.name === STRING_TYPE ? meta.name : "";
                    summaryLines.push(`/// ${descriptionText}`);
                    continue;
                }
                if (/^\/\/\/\s*@/i.test(ln.trim())) {
                    remainingLines.push(ln);
                    continue;
                }
                // Treat other triple slash lines as summary continuations
                if (/^\/\/\/\s*/.test(ln.trim())) {
                    summaryLines.push(ln);
                    continue;
                }
                remainingLines.push(ln);
            }

            if (summaryLines.length > 0 && remainingLines.length > 0) {
                // Ensure a blank separator between summary block and synthetic metadata
                const combined = [...summaryLines, "", ...remainingLines];

                filteredResult = toMutableArray(combined as any) as MutableDocCommentLines;
            }
        }
    } catch {
        // Suppress errors during blank-line insertion for plain summaries.
        // Separating summary lines from synthetic metadata is a formatting
        // nicety, not a correctness requirement. If the operation fails (e.g.,
        // due to unexpected comment structure or runtime constraints), we
        // continue with the unseparated result rather than aborting the entire
        // merge. This keeps diagnostic operations resilient without masking
        // critical failures elsewhere in the pipeline.
    }
    const convertedResult = convertLegacyReturnsDescriptionLinesToMetadata(filteredResult, {
        normalizeDocCommentTypeAnnotations: normalizeGameMakerType
    });

    const prunedConvertedResult = convertedResult.filter((line) => {
        if (typeof line !== STRING_TYPE) {
            return true;
        }

        if (!docTagHelpers.isDescriptionLine(line)) {
            return true;
        }

        const metadata = parseDocCommentMetadata(line);
        const descriptionText = typeof metadata?.name === STRING_TYPE ? metadata.name.trim() : "";

        return descriptionText.length > 0;
    });

    // Check for missing continuation lines
    const finalResult = toMutableArray(prunedConvertedResult) as MutableDocCommentLines;
    if (preserveDescriptionBreaks) {
        (finalResult as any)._preserveDescriptionBreaks = true;
    }
    return finalResult;
}

/**
 * Orchestrates the post-merge doc-tag line layout for return and function
 * documentation. Coordinates three focused responsibilities:
 *
 *  1. `mergeReturnLinesIntoResult` - injects return-tag lines into the result
 *  2. `repositionFunctionLineNearIgnoreOrOverride` - places @function near @ignore/@override
 *  3. `repositionFunctionLinesAfterDeprecatedTag` - places @function after @deprecated
 *
 * @internal
 */
function mergeReturnDocLinesAndRepositionFunctionTag({
    result,
    returnsLines,
    removedAnyLine,
    docTagHelpers,
    originalHasDeprecatedTag
}: {
    result: MutableDocCommentLines;
    returnsLines: DocCommentLines;
    removedAnyLine: boolean;
    docTagHelpers: DocTagHelpers;
    originalHasDeprecatedTag: boolean;
}): { result: MutableDocCommentLines; removedAnyLine: boolean } {
    // 1. Inject return-tag lines into the result, tracking whether any existing
    //    @returns lines were removed in the process.
    ({ result, removedAnyLine } = mergeReturnLinesIntoResult({ result, returnsLines, removedAnyLine }));

    // 2. Deduplicate any @returns entries introduced by the merge step.
    const finalDedupedResult = dedupeReturnDocLines(result);
    result = toMutableArray(finalDedupedResult.lines) as MutableDocCommentLines;
    if (finalDedupedResult.removed) {
        removedAnyLine = true;
    }

    // 3. Reposition @function near @ignore or @override if either is present.
    result = repositionFunctionLineNearIgnoreOrOverride(result, docTagHelpers);

    // 4. When @deprecated is present, push all @function lines after it.
    if (originalHasDeprecatedTag) {
        result = repositionFunctionLinesAfterDeprecatedTag(result, docTagHelpers);
    }

    return { result, removedAnyLine };
}

function mergeReturnLinesIntoResult({
    result,
    returnsLines,
    removedAnyLine
}: {
    result: MutableDocCommentLines;
    returnsLines: DocCommentLines;
    removedAnyLine: boolean;
}): { result: MutableDocCommentLines; removedAnyLine: boolean } {
    if (!isNonEmptyArray(returnsLines)) {
        return { result, removedAnyLine };
    }

    const { lines: dedupedReturns } = dedupeReturnDocLines(returnsLines, {
        includeNonReturnLine: (_line, trimmed) => trimmed.length > 0
    });

    if (dedupedReturns.length === 0) {
        return { result, removedAnyLine };
    }

    const filteredResult = [];
    let removedExistingReturns = false;

    for (const line of result) {
        if (typeof line === STRING_TYPE && /^\/\/\/\s*@returns\b/i.test(toTrimmedString(line))) {
            removedExistingReturns = true;
            continue;
        }

        filteredResult.push(line);
    }

    let appendIndex = filteredResult.length;
    while (
        appendIndex > 0 &&
        typeof filteredResult[appendIndex - 1] === STRING_TYPE &&
        filteredResult[appendIndex - 1].trim() === ""
    ) {
        appendIndex -= 1;
    }

    const mergedResult = [
        ...filteredResult.slice(0, appendIndex),
        ...dedupedReturns,
        ...filteredResult.slice(appendIndex)
    ] as any;
    if ((result as any)._preserveDescriptionBreaks === true) {
        mergedResult._preserveDescriptionBreaks = true;
    }

    return { result: mergedResult, removedAnyLine: removedAnyLine || removedExistingReturns };
}

function repositionFunctionLineNearIgnoreOrOverride(
    result: MutableDocCommentLines,
    docTagHelpers: DocTagHelpers
): MutableDocCommentLines {
    const functionIndex = result.findIndex(docTagHelpers.isFunctionLine);
    if (functionIndex <= 0) {
        return result;
    }

    const [functionLine] = result.splice(functionIndex, 1);
    const ignoreIndex = result.findIndex((line) => docTagHelpers.docTagMatches(line, /^\/\/\/\s*@ignore\b/i));
    const overrideIndex = result.findIndex((line) => docTagHelpers.docTagMatches(line, /^\/\/\/\s*@override\b/i));

    if (ignoreIndex === 0) {
        result.splice(1, 0, functionLine);
    } else if (overrideIndex === -1) {
        result.unshift(functionLine);
    } else {
        result.splice(overrideIndex + 1, 0, functionLine);
    }

    return result;
}

function isDeprecatedDocTagLine(line: unknown): boolean {
    return typeof line === STRING_TYPE && /^\/\/\/\s*@deprecated\b/i.test(toTrimmedString(line));
}

function repositionFunctionLinesAfterDeprecatedTag(
    result: MutableDocCommentLines,
    docTagHelpers: DocTagHelpers
): MutableDocCommentLines {
    const functionLines: MutableDocCommentLines = [];
    const remainingLines: MutableDocCommentLines = [];

    for (const line of result) {
        if (docTagHelpers.isFunctionLine(line)) {
            functionLines.push(line);
        } else {
            remainingLines.push(line);
        }
    }

    if (functionLines.length === 0) {
        return result;
    }

    const deprecatedIndex = findLastIndex(remainingLines, isDeprecatedDocTagLine);
    if (deprecatedIndex === -1) {
        return result;
    }

    const insertIndex = deprecatedIndex + 1;
    while (insertIndex < remainingLines.length && remainingLines[insertIndex] === "") {
        remainingLines.splice(insertIndex, 1);
    }

    remainingLines.splice(insertIndex, 0, ...functionLines);

    const suppressLeadingBlank = result._suppressLeadingBlank;
    const reorderedResult = remainingLines;
    if (suppressLeadingBlank) {
        reorderedResult._suppressLeadingBlank = true;
    }

    return reorderedResult;
}

type ReorderParamDocLinesParams = {
    node: any;
    options: any;
    result: MutableDocCommentLines;
    docTagHelpers: DocTagHelpers;
    implicitDocEntries: readonly ImplicitArgumentDocEntry[];
    declaredParamCount: number;
    suppressedCanonicals: Set<string> | undefined;
};

function splitParamNameAndRemainder(text: string): {
    name: string;
    remainder: string;
} | null {
    if (typeof text !== STRING_TYPE) {
        return null;
    }

    let index = 0;
    while (index < text.length && /\s/.test(text[index])) {
        index += 1;
    }

    if (index >= text.length) {
        return null;
    }

    const start = index;
    const firstChar = text[index];

    if (firstChar === "[") {
        let depth = 0;
        for (; index < text.length; index += 1) {
            const char = text[index];
            if (char === "[") {
                depth += 1;
            } else if (char === "]") {
                depth -= 1;
                if (depth === 0) {
                    index += 1;
                    break;
                }
            }
        }

        if (depth > 0) {
            const name = text.slice(start).trim();
            return name.length > 0 ? { name, remainder: "" } : null;
        }
    } else {
        while (index < text.length && !/\s/.test(text[index])) {
            index += 1;
        }
    }

    const name = text.slice(start, index);
    if (name.trim().length === 0) {
        return null;
    }

    return {
        name,
        remainder: text.slice(index)
    };
}

function reorderParamDocLines({
    node,
    options,
    result,
    docTagHelpers,
    implicitDocEntries,
    declaredParamCount,
    suppressedCanonicals
}: ReorderParamDocLinesParams): MutableDocCommentLines {
    const paramDocsByCanonical = new Map<string, string>();
    const implicitEntriesByIndex = new Map<number, ImplicitArgumentDocEntry>();

    for (const entry of implicitDocEntries) {
        if (!entry || typeof entry.index !== "number") {
            continue;
        }

        if (!implicitEntriesByIndex.has(entry.index)) {
            implicitEntriesByIndex.set(entry.index, entry);
        }
    }

    const resolveDocLineFromCandidates = (candidates: Array<string | null>): string | null => {
        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }

            const docLine = paramDocsByCanonical.get(candidate);
            if (docLine) {
                paramDocsByCanonical.delete(candidate);
                return docLine;
            }
        }

        return null;
    };

    const getEntryNameCanonical = (entry: ImplicitArgumentDocEntry | null) => {
        const entryName = entry && typeof entry.name === STRING_TYPE ? entry.name : null;
        return entryName ? getCanonicalParamNameFromText(entryName) : null;
    };

    for (const line of result) {
        if (typeof line !== STRING_TYPE) {
            continue;
        }

        if (!docTagHelpers.isParamLine(line)) {
            continue;
        }

        const canonical = docTagHelpers.getParamCanonicalName(line);
        if (canonical) {
            paramDocsByCanonical.set(canonical, line);
        }
    }

    if (suppressedCanonicals && suppressedCanonicals.size > 0) {
        for (const canonical of suppressedCanonicals) {
            const candidate = paramDocsByCanonical.get(canonical);
            if (!candidate) continue;

            const directReferenceExists = implicitDocEntries.some((entry) => {
                if (!entry) return false;
                const key = entry.canonical || entry.fallbackCanonical || entry.name;
                if (!key) return false;
                return key === canonical && entry.hasDirectReference === true;
            });

            if (!directReferenceExists) {
                paramDocsByCanonical.delete(canonical);
            }
        }
    }

    if (implicitDocEntries.length > 0) {
        const fallbackCanonicalsToRemove = new Set<string>();

        for (const entry of implicitDocEntries) {
            if (
                entry?.fallbackCanonical &&
                entry.fallbackCanonical !== entry.canonical &&
                entry.hasDirectReference !== true
            ) {
                fallbackCanonicalsToRemove.add(entry.fallbackCanonical);
            }
        }

        for (const fallbackCanonical of fallbackCanonicalsToRemove) {
            paramDocsByCanonical.delete(fallbackCanonical);
        }
    }

    const hasImplicitDocEntries = implicitDocEntries.length > 0;
    let orderedParamDocs: string[] = [];
    if (Array.isArray(node.params)) {
        for (const [paramIndex, param] of node.params.entries()) {
            const paramInfo = getParameterDocInfo(param, node, options);
            const canonical = paramInfo?.name ? getCanonicalParamNameFromText(paramInfo.name) : null;

            const implicitEntry = implicitEntriesByIndex.get(paramIndex) ?? null;
            const docLine = resolveDocLineFromCandidates([
                canonical,
                getEntryNameCanonical(implicitEntry),
                implicitEntry?.canonical ?? null,
                implicitEntry?.fallbackCanonical ?? null
            ]);

            if (docLine) {
                orderedParamDocs.push(docLine);
            }
        }
    }

    if (orderedParamDocs.length === 0) {
        for (const entry of implicitDocEntries) {
            const docLine = resolveDocLineFromCandidates([
                entry?.canonical ?? null,
                getEntryNameCanonical(entry ?? null),
                entry?.fallbackCanonical ?? null
            ]);
            if (docLine) {
                orderedParamDocs.push(docLine);
            }
        }
    }

    const shouldDropRemainingParamDocs =
        !hasImplicitDocEntries && declaredParamCount === 0 && paramDocsByCanonical.size > 0;

    if (!shouldDropRemainingParamDocs) {
        for (const doc of paramDocsByCanonical.values()) {
            orderedParamDocs.push(doc);
        }
    }

    if (orderedParamDocs.length > 0) {
        orderedParamDocs = reorderDocLines({
            orderedParamDocs,
            docTagHelpers,
            node,
            options,
            implicitDocEntries
        });
    }

    const finalDocs: MutableDocCommentLines = [];
    let insertedParams = false;

    for (const line of result) {
        if (docTagHelpers.isParamLine(line)) {
            if (!insertedParams && orderedParamDocs.length > 0) {
                finalDocs.push(...orderedParamDocs);
                insertedParams = true;
            }
            continue;
        }

        finalDocs.push(line);
    }

    if (!insertedParams && orderedParamDocs.length > 0) {
        finalDocs.push(...orderedParamDocs);
    }

    return finalDocs;
}

type ReorderDocLinesParams = {
    orderedParamDocs: string[];
    docTagHelpers: DocTagHelpers;
    node: any;
    options: any;
    implicitDocEntries: readonly ImplicitArgumentDocEntry[];
};

function reorderDocLines({
    orderedParamDocs,
    docTagHelpers,
    node,
    options,
    implicitDocEntries
}: ReorderDocLinesParams): string[] {
    const docsByCanonical = new Map<string, string>();
    for (const docLine of orderedParamDocs) {
        if (typeof docLine !== STRING_TYPE) {
            continue;
        }

        const canonical = docTagHelpers.getParamCanonicalName(docLine);
        if (canonical) {
            docsByCanonical.set(canonical, docLine);
        }
    }

    const preferredDocs = preferredParamDocNamesByNode.get(node);
    const implicitEntryByIndex = new Map<number, ImplicitArgumentDocEntry>();
    for (const entry of implicitDocEntries) {
        if (entry && Number.isInteger(entry.index)) {
            implicitEntryByIndex.set(entry.index, entry);
        }
    }
    const reordered: string[] = [];

    const tryAppendDocLine = (canonical: string | null | undefined): boolean => {
        if (!canonical) {
            return false;
        }

        const docLine = docsByCanonical.get(canonical);
        if (!docLine) {
            return false;
        }

        reordered.push(docLine);
        docsByCanonical.delete(canonical);
        return true;
    };

    if (Array.isArray(node.params)) {
        for (const [index, param] of node.params.entries()) {
            const implicitEntry = implicitEntryByIndex.get(index);
            if (implicitEntry) {
                const implicitCanonical = implicitEntry.canonical || getCanonicalParamNameFromText(implicitEntry.name);
                if (tryAppendDocLine(implicitCanonical)) {
                    continue;
                }
            }

            const preferredName = preferredDocs?.get(index);
            if (preferredName) {
                const preferredCanonical = getCanonicalParamNameFromText(preferredName);
                if (tryAppendDocLine(preferredCanonical)) {
                    continue;
                }
            }

            const paramInfo = getParameterDocInfo(param, node, options);
            const paramCanonical = paramInfo?.name ? getCanonicalParamNameFromText(paramInfo.name) : null;
            tryAppendDocLine(paramCanonical);
        }
    }

    for (const docLine of docsByCanonical.values()) {
        reordered.push(docLine);
    }

    return reordered;
}

/**
 * Merge synthetic doc comments with existing metadata while preserving order.
 */
export function shouldGenerateSyntheticDocForFunction(
    node: any,
    parent: any,
    existingDocLines: DocCommentLines | string[],
    options: any
): boolean {
    if (!node || !parent || (parent.type !== "Program" && parent.type !== "BlockStatement")) {
        return false;
    }

    if (node.type === "ConstructorDeclaration") {
        return true;
    }

    if (node.type !== "FunctionDeclaration" && node.type !== "StructFunctionDeclaration") {
        return false;
    }

    const convertedExistingForSynthetic = convertLegacyReturnsDescriptionLinesToMetadata(existingDocLines, {
        normalizeDocCommentTypeAnnotations: normalizeGameMakerType
    });
    const syntheticLines = computeSyntheticFunctionDocLines(node, convertedExistingForSynthetic, options);

    if (syntheticLines.length > 0) {
        return true;
    }

    if (hasLegacyReturnsDescriptionLines(existingDocLines)) {
        return true;
    }

    if (isNonEmptyArray(existingDocLines)) {
        return true;
    }

    const hasParamDocLines = existingDocLines.some((line) => {
        if (typeof line !== STRING_TYPE) {
            return false;
        }

        const trimmed = toTrimmedString(line);
        return /^\/\/\/\s*@param\b/i.test(trimmed);
    });

    if (hasParamDocLines) {
        const declaredParamCount = Array.isArray(node.params) ? node.params.length : 0;
        let hasImplicitDocEntries = false;

        if (node.type === "FunctionDeclaration" || node.type === "StructFunctionDeclaration") {
            const implicitEntries = collectImplicitArgumentDocNames(node, options);
            hasImplicitDocEntries = implicitEntries.length > 0;
        }

        if (declaredParamCount === 0 && !hasImplicitDocEntries) {
            return true;
        }
    }

    const hasMultiLineSummary = hasMultiLineDocCommentSummary(existingDocLines);
    if (hasMultiLineSummary) {
        return true;
    }

    return (
        Array.isArray(node.params) &&
        node.params.some((param) => {
            return param?.type === "DefaultParameter";
        })
    );
}

function docTagMatches(line: unknown, pattern: RegExp): boolean {
    if (typeof line !== STRING_TYPE) {
        return false;
    }

    const trimmed = toTrimmedString(line);
    if (trimmed.length === 0) {
        return false;
    }

    if (pattern.global || pattern.sticky) {
        pattern.lastIndex = 0;
    }

    return pattern.test(trimmed);
}

function isReturnLine(line: unknown): boolean {
    if (typeof line !== "string") {
        return false;
    }
    return /^\/\/\/\s*@returns?\b/i.test(line.trim());
}

type DocTagHelpers = ReturnType<typeof createDocTagHelpers>;

type MergeDocLinesParams = {
    normalizedExistingLines: MutableDocCommentLines;
    syntheticLines: DocCommentLines;
    docTagHelpers: DocTagHelpers;
    originalExistingHasTags: boolean;
    removedExistingReturnDuplicates: boolean;
};

function createDocTagHelpers() {
    const paramCanonicalNameCache = new Map<unknown, string | null>();

    const isFunctionLine = (line: unknown) => docTagMatches(line, /^\/\/\/\s*@function\b/i);
    const isOverrideLine = (line: unknown) => docTagMatches(line, /^\/\/\/\s*@override\b/i);
    const isParamLine = (line: unknown) => docTagMatches(line, /^\/\/\/\s*@param\b/i);
    const isDescriptionLine = (line: unknown) => docTagMatches(line, /^\/\/\/\s*@description\b/i);

    const getParamCanonicalName = (line: unknown, metadata?: ReturnType<typeof parseDocCommentMetadata>) => {
        if (typeof line !== STRING_TYPE) {
            return null;
        }

        if (paramCanonicalNameCache.has(line)) {
            return paramCanonicalNameCache.get(line);
        }

        const docMetadata = metadata === undefined ? parseDocCommentMetadata(line) : metadata;
        const canonical = docMetadata?.tag === "param" ? getCanonicalParamNameFromText(docMetadata.name) : null;

        paramCanonicalNameCache.set(line, canonical);
        return canonical;
    };

    return {
        docTagMatches,
        isFunctionLine,
        isOverrideLine,
        isParamLine,
        isDescriptionLine,
        getParamCanonicalName
    };
}

type ReorderDescriptionBlockParams = {
    docs: MutableDocCommentLines;
    docTagHelpers: DocTagHelpers;
    syntheticFunctionName: string | null;
};

function reorderDescriptionBlock({
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

function finalizeDescriptionBlocks({ docs }: FinalizeDescriptionBlocksParams): MutableDocCommentLines {
    // To align with Prettier's default behavior, we never break up or reflow doc comments
    // to fit the printWidth. Returning the original lines ensures that user-defined
    // line breaks and formatting are preserved.
    return docs;
}

function mergeDocLines({
    normalizedExistingLines,
    syntheticLines,
    docTagHelpers,
    originalExistingHasTags,
    removedExistingReturnDuplicates
}: MergeDocLinesParams) {
    const { isFunctionLine, isOverrideLine, isParamLine, getParamCanonicalName } = docTagHelpers;

    const functionLines = syntheticLines.filter(isFunctionLine);
    const syntheticFunctionMetadata = functionLines
        .map((line) => parseDocCommentMetadata(line))
        .find((meta) => meta?.tag === "function" && typeof meta.name === STRING_TYPE);
    const syntheticFunctionName =
        typeof syntheticFunctionMetadata?.name === STRING_TYPE ? syntheticFunctionMetadata.name.trim() : null;
    let otherLines = syntheticLines.filter((line) => !isFunctionLine(line)) as MutableDocCommentLines;
    const overrideLines = otherLines.filter(isOverrideLine);
    otherLines = otherLines.filter((line) => !isOverrideLine(line));
    let returnsLines;

    let mergedLines = [...normalizedExistingLines];
    let removedAnyLine = removedExistingReturnDuplicates;

    if (functionLines.length > 0) {
        const functionMerge = mergeFunctionDocLines({
            mergedLines,
            functionLines,
            originalExistingHasTags,
            isFunctionLine,
            isParamLine
        });
        mergedLines = functionMerge.mergedLines;
        removedAnyLine = removedAnyLine || functionMerge.removedAnyLine;
    }

    if (overrideLines.length > 0) {
        const overrideMerge = mergeOverrideDocLines({
            mergedLines,
            overrideLines,
            isFunctionLine,
            isOverrideLine
        });
        mergedLines = overrideMerge.mergedLines;
        removedAnyLine = removedAnyLine || overrideMerge.removedAnyLine;
    }

    const paramLineIndices = collectParamLineIndices({
        mergedLines,
        isParamLine,
        getParamCanonicalName
    });

    if (otherLines.length > 0) {
        const paramUpdate = updateParamLinesFromOtherLines({
            otherLines,
            mergedLines,
            paramLineIndices,
            getParamCanonicalName
        });
        otherLines = paramUpdate.otherLines;
        mergedLines = paramUpdate.mergedLines;
        removedAnyLine = removedAnyLine || paramUpdate.removedAnyLine;
    }

    if (otherLines.length > 0) {
        const returnExtraction = extractReturnLinesFromOtherLines(otherLines);
        otherLines = returnExtraction.otherLines;
        returnsLines = returnExtraction.returnsLines;
    }

    const syntheticParamNames = new Set(otherLines.map((line) => getParamCanonicalName(line)).filter(isNonEmptyString));

    if (syntheticParamNames.size > 0) {
        const filtered = removeExistingParamLinesWithSyntheticNames({
            mergedLines,
            syntheticParamNames,
            isParamLine,
            getParamCanonicalName
        });
        mergedLines = filtered.mergedLines;
        removedAnyLine = removedAnyLine || filtered.removedAnyLine;
    }

    const result = insertOtherLinesAfterFunction({
        mergedLines,
        otherLines,
        isFunctionLine,
        isParamLine
    });

    return {
        result,
        otherLines,
        returnsLines,
        removedAnyLine,
        syntheticFunctionName
    };
}

type MergeFunctionDocLinesParams = {
    mergedLines: MutableDocCommentLines;
    functionLines: DocCommentLines;
    originalExistingHasTags: boolean;
    isFunctionLine: (line: unknown) => boolean;
    isParamLine: (line: unknown) => boolean;
};

function mergeFunctionDocLines({
    mergedLines,
    functionLines,
    originalExistingHasTags,
    isFunctionLine,
    isParamLine
}: MergeFunctionDocLinesParams) {
    const existingFunctionIndices = mergedLines
        .map((line, index) => (isFunctionLine(line) ? index : -1))
        .filter((index) => index !== -1);

    if (existingFunctionIndices.length > 0) {
        const [firstIndex, ...duplicateIndices] = existingFunctionIndices;
        const nextLines = [...mergedLines];

        for (let i = duplicateIndices.length - 1; i >= 0; i--) {
            nextLines.splice(duplicateIndices[i], 1);
        }

        nextLines.splice(firstIndex, 1, ...functionLines);
        return { mergedLines: nextLines, removedAnyLine: true };
    }

    const firstParamIndex = mergedLines.findIndex(isParamLine);

    const insertionIndex = originalExistingHasTags
        ? firstParamIndex === -1
            ? mergedLines.length
            : firstParamIndex
        : mergedLines.length;

    const precedingLine = insertionIndex > 0 ? mergedLines[insertionIndex - 1] : null;
    const trimmedPreceding = toTrimmedString(precedingLine);
    const isDocCommentLine = typeof trimmedPreceding === STRING_TYPE && /^\/\/\//.test(trimmedPreceding);
    const isDocTagLine = isDocCommentLine && /^\/\/\/\s*@/i.test(trimmedPreceding);

    let precedingDocTag = null;
    if (isDocCommentLine && isDocTagLine) {
        const metadata = parseDocCommentMetadata(precedingLine);
        if (metadata && typeof metadata.tag === STRING_TYPE) {
            precedingDocTag = metadata.tag.toLowerCase();
        }
    }

    const shouldSeparateDocTag = precedingDocTag === "deprecated";
    const needsSeparatorBeforeFunction =
        trimmedPreceding !== "" &&
        typeof precedingLine === STRING_TYPE &&
        !isFunctionLine(precedingLine) &&
        (!isDocCommentLine || !isDocTagLine || shouldSeparateDocTag);

    let nextLines = mergedLines;
    let insertAt = insertionIndex;

    if (needsSeparatorBeforeFunction) {
        nextLines = [...mergedLines.slice(0, insertionIndex), "", ...mergedLines.slice(insertionIndex)];
        insertAt = insertionIndex + 1;
    }

    nextLines = [...nextLines.slice(0, insertAt), ...functionLines, ...nextLines.slice(insertAt)];

    return { mergedLines: nextLines, removedAnyLine: true };
}

type MergeOverrideDocLinesParams = {
    mergedLines: MutableDocCommentLines;
    overrideLines: DocCommentLines;
    isFunctionLine: (line: unknown) => boolean;
    isOverrideLine: (line: unknown) => boolean;
};

function mergeOverrideDocLines({
    mergedLines,
    overrideLines,
    isFunctionLine,
    isOverrideLine
}: MergeOverrideDocLinesParams) {
    const existingOverrideIndices = mergedLines
        .map((line, index) => (isOverrideLine(line) ? index : -1))
        .filter((index) => index !== -1);

    if (existingOverrideIndices.length > 0) {
        const [firstOverrideIndex, ...duplicateOverrideIndices] = existingOverrideIndices;
        const nextLines = [...mergedLines];

        for (let i = duplicateOverrideIndices.length - 1; i >= 0; i -= 1) {
            nextLines.splice(duplicateOverrideIndices[i], 1);
        }

        nextLines.splice(firstOverrideIndex, 1, ...overrideLines);
        return { mergedLines: nextLines, removedAnyLine: true };
    }

    const firstFunctionIndex = mergedLines.findIndex(isFunctionLine);
    const insertionIndex = firstFunctionIndex === -1 ? 0 : firstFunctionIndex;

    return {
        mergedLines: [...mergedLines.slice(0, insertionIndex), ...overrideLines, ...mergedLines.slice(insertionIndex)],
        removedAnyLine: true
    };
}

type CollectParamLineIndicesParams = {
    mergedLines: MutableDocCommentLines;
    isParamLine: (line: unknown) => boolean;
    getParamCanonicalName: (line: unknown, metadata?: ReturnType<typeof parseDocCommentMetadata>) => string | null;
};

function collectParamLineIndices({ mergedLines, isParamLine, getParamCanonicalName }: CollectParamLineIndicesParams) {
    const paramLineIndices = new Map<string, number>();
    for (const [index, line] of mergedLines.entries()) {
        if (!isParamLine(line)) {
            continue;
        }

        const canonical = getParamCanonicalName(line);
        if (canonical) {
            paramLineIndices.set(canonical, index);
        }
    }

    return paramLineIndices;
}

type UpdateParamLinesFromOtherLinesParams = {
    otherLines: DocCommentLines;
    mergedLines: MutableDocCommentLines;
    paramLineIndices: Map<string, number>;
    getParamCanonicalName: (line: unknown, metadata?: ReturnType<typeof parseDocCommentMetadata>) => string | null;
};

function updateParamLinesFromOtherLines({
    otherLines,
    mergedLines,
    paramLineIndices,
    getParamCanonicalName
}: UpdateParamLinesFromOtherLinesParams) {
    const normalizedOtherLines = [];
    let removedAnyLine = false;
    const nextMergedLines = mergedLines;

    for (const line of otherLines) {
        const metadata = parseDocCommentMetadata(line);
        const canonical = getParamCanonicalName(line, metadata);

        if (canonical && paramLineIndices.has(canonical) && metadata?.name) {
            const lineIndex = paramLineIndices.get(canonical);
            const existingLine = nextMergedLines[lineIndex];

            const updatedLine = updateParamLineWithDocName(existingLine, metadata.name);
            if (updatedLine !== existingLine) {
                nextMergedLines[lineIndex] = updatedLine;
                removedAnyLine = true;
            }
            continue;
        }

        normalizedOtherLines.push(line);
    }

    return {
        otherLines: normalizedOtherLines,
        mergedLines: nextMergedLines,
        removedAnyLine
    };
}

function extractReturnLinesFromOtherLines(otherLines: DocCommentLines) {
    const nonReturnLines: MutableDocCommentLines = [];
    const extractedReturns: MutableDocCommentLines = [];

    for (const line of otherLines) {
        const metadata = parseDocCommentMetadata(line);
        if (metadata?.tag === "returns") {
            extractedReturns.push(line);
            continue;
        }

        nonReturnLines.push(line);
    }

    if (extractedReturns.length === 0) {
        return {
            otherLines: otherLines as MutableDocCommentLines,
            returnsLines: undefined
        };
    }

    return {
        otherLines: nonReturnLines,
        returnsLines: extractedReturns as DocCommentLines
    };
}

type RemoveExistingParamLinesParams = {
    mergedLines: MutableDocCommentLines;
    syntheticParamNames: Set<string>;
    isParamLine: (line: unknown) => boolean;
    getParamCanonicalName: (line: unknown, metadata?: ReturnType<typeof parseDocCommentMetadata>) => string | null;
};

function removeExistingParamLinesWithSyntheticNames({
    mergedLines,
    syntheticParamNames,
    isParamLine,
    getParamCanonicalName
}: RemoveExistingParamLinesParams) {
    const beforeLength = mergedLines.length;
    const filteredLines = mergedLines.filter((line) => {
        if (!isParamLine(line)) {
            return true;
        }

        const canonical = getParamCanonicalName(line);
        if (!canonical) {
            return false;
        }

        return !syntheticParamNames.has(canonical);
    });

    return {
        mergedLines: filteredLines,
        removedAnyLine: filteredLines.length !== beforeLength
    };
}

type InsertOtherLinesParams = {
    mergedLines: MutableDocCommentLines;
    otherLines: DocCommentLines;
    isFunctionLine: (line: unknown) => boolean;
    isParamLine: (line: unknown) => boolean;
};

function insertOtherLinesAfterFunction({
    mergedLines,
    otherLines,
    isFunctionLine,
    isParamLine
}: InsertOtherLinesParams) {
    const lastFunctionIndex = findLastIndex(mergedLines, isFunctionLine);
    let insertionIndex = lastFunctionIndex === -1 ? 0 : lastFunctionIndex + 1;

    if (lastFunctionIndex === -1) {
        while (
            insertionIndex < mergedLines.length &&
            typeof mergedLines[insertionIndex] === STRING_TYPE &&
            mergedLines[insertionIndex].trim() === ""
        ) {
            insertionIndex += 1;
        }
    }

    while (
        insertionIndex < mergedLines.length &&
        typeof mergedLines[insertionIndex] === STRING_TYPE &&
        isParamLine(mergedLines[insertionIndex])
    ) {
        insertionIndex += 1;
    }

    return toMutableArray([
        ...mergedLines.slice(0, insertionIndex),
        ...otherLines,
        ...mergedLines.slice(insertionIndex)
    ]) as MutableDocCommentLines;
}

type ApplyDocCommentPromotionParams = {
    normalizedExistingLines: MutableDocCommentLines;
    preserveDescriptionBreaks: boolean;
    syntheticLines: MutableDocCommentLines;
    originalExistingHasTags: boolean;
    originalExistingHasDocLikePrefixes: boolean;
    hasMultiLineSummary: boolean;
};

function applyDocCommentPromotionIfNeeded(params: ApplyDocCommentPromotionParams): {
    normalizedExistingLines: MutableDocCommentLines;
    preserveDescriptionBreaks: boolean;
} {
    let {
        normalizedExistingLines,
        preserveDescriptionBreaks,
        syntheticLines,
        originalExistingHasTags,
        originalExistingHasDocLikePrefixes,
        hasMultiLineSummary
    } = params;

    if (originalExistingHasTags || originalExistingHasDocLikePrefixes || hasMultiLineSummary) {
        const promoted = promoteLeadingDocCommentTextToDescription(
            normalizedExistingLines,
            syntheticLines,
            originalExistingHasDocLikePrefixes || hasMultiLineSummary
        );
        normalizedExistingLines = toMutableArray(promoted) as MutableDocCommentLines;

        if (
            (promoted as any)._preserveDescriptionBreaks === true ||
            (normalizedExistingLines as any)._preserveDescriptionBreaks === true
        ) {
            preserveDescriptionBreaks = true;
            (normalizedExistingLines as any)._preserveDescriptionBreaks = true;
        }

        if (!originalExistingHasTags) {
            (normalizedExistingLines as any)._suppressLeadingBlank = true;
        }
    }

    return {
        normalizedExistingLines,
        preserveDescriptionBreaks
    };
}

type AttemptEarlyReturnParams = {
    syntheticLines: DocCommentLines;
    normalizedExistingLines: DocCommentLines;
    shouldForceParamPrune: boolean;
    existingDocLines: DocCommentLines | string[];
    overrides: any;
};

function attemptEarlyReturnOnSynthetic({
    syntheticLines,
    normalizedExistingLines,
    shouldForceParamPrune,
    existingDocLines,
    overrides
}: AttemptEarlyReturnParams) {
    if (syntheticLines.length === 0 && !shouldForceParamPrune) {
        return toMutableArray(
            convertLegacyReturnsDescriptionLinesToMetadata(normalizedExistingLines, {
                normalizeDocCommentTypeAnnotations: normalizeGameMakerType
            })
        ) as MutableDocCommentLines;
    }

    if (normalizedExistingLines.length === 0) {
        return toMutableArray(
            convertLegacyReturnsDescriptionLinesToMetadata(syntheticLines, {
                normalizeDocCommentTypeAnnotations: normalizeGameMakerType
            })
        ) as MutableDocCommentLines;
    }

    if (
        overrides &&
        overrides.preserveDocCommentParamNames === true &&
        Array.isArray(existingDocLines) &&
        existingDocLines.length > 0
    ) {
        return toMutableArray(existingDocLines) as MutableDocCommentLines;
    }

    return null;
}

function updateParamLineWithDocName(line: string, newDocName: string): string {
    if (typeof line !== STRING_TYPE || typeof newDocName !== STRING_TYPE) {
        return line;
    }

    const match = line.match(/^(\/\/\/\s*)(@param|@arg|@argument)((?:\s+(?:\{[^}]+\}|<[^>]+>))?)(\s*)/i);

    if (!match) {
        return `/// @param ${newDocName}`;
    }

    const [, slashPrefix, , typePart, spaceAfterType] = match;

    const newTag = "@param";

    let newTypePart = typePart;
    if (typePart && typePart.trim().startsWith("<")) {
        newTypePart = typePart.replace(/<([^>]+)>/, "{$1}");
    }

    let newPrefix = `${slashPrefix}${newTag}${newTypePart}${spaceAfterType}`;
    newPrefix = normalizeDocCommentTypeAnnotations(newPrefix);

    const fullPrefixLength = match[0].length;
    const remainder = line.slice(fullPrefixLength);
    const nameSplit = splitParamNameAndRemainder(remainder);

    if (!nameSplit) {
        return `/// @param ${newDocName}`;
    }

    return newPrefix + newDocName + nameSplit.remainder;
}
