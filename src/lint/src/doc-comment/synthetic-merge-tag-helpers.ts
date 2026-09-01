/**
 * Doc-tag detection helpers for the synthetic-doc-merge pipeline.
 *
 * The merge orchestrator needs to answer the same recurring questions many
 * times over a single merge run: "is this a `@param` line?", "is this an
 * `@override` line?", "what is the canonical parameter name from this
 * line?". Factoring the predicates into a cached factory keeps each merge
 * pass cheap and stops the orchestrator from re-creating equivalent
 * closures for every call site.
 *
 * Extracted from `synthetic-merge.ts` so the orchestrator can focus on the
 * merge sequence instead of carrying predicate factories inline.
 */

import { Core } from "@gmloop/core";

import { parseDocCommentMetadata } from "./metadata.js";

const { getCanonicalParamNameFromText, toTrimmedString } = Core;

const STRING_TYPE: string = "string";

/**
 * Apply a doc-comment tag regex to a single line, guarding against the
 * shared-state pitfalls of `RegExp` instances declared with `g` or `y`
 * flags by resetting `lastIndex` before testing.
 */
export function docTagMatches(line: unknown, pattern: RegExp): boolean {
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

/**
 * Returns true when the line looks like a `@returns` (or legacy `@return`)
 * tag. Lives next to `docTagMatches` because both are pure, regex-based
 * shape predicates consumed by the helpers factory below.
 */
export function isReturnLine(line: unknown): boolean {
    if (typeof line !== "string") {
        return false;
    }
    return /^\/\/\/\s*@returns?\b/i.test(line.trim());
}

/**
 * Bundles the doc-comment tag predicates used by the merge orchestrator
 * alongside a per-line cache for canonical `@param` names. The cache is
 * intentionally attached to the helpers object rather than module-level
 * state so each merge call site gets its own scratch space without
 * leaking data between passes.
 */
export function createDocTagHelpers() {
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

export type DocTagHelpers = ReturnType<typeof createDocTagHelpers>;

export const syntheticMergeTagHelpers = Object.freeze({
    createDocTagHelpers,
    docTagMatches,
    isReturnLine
});
