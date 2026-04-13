import { isNonEmptyString, isObjectLike, isRegExpLike, toTrimmedString } from "../../utils/index.js";
import { getCommentBoundaryIndex, getCommentValue } from "../comment-utils.js";
import { applyJsDocReplacements } from "../doc-comment/type-normalization.js";
import { evaluateBannerCommentPolicy, isBelowBannerSlashThreshold } from "./banner-comment-policy.js";
import {
    DEFAULT_COMMENTED_OUT_CODE_PATTERNS,
    DEFAULT_LINE_COMMENT_OPTIONS,
    normalizeLineCommentOptions
} from "./options.js";

// BANNER DECORATION PATTERN DESIGN:
//
// The character class below defines which sequences count as "banner decorations"
// in line comments. Banner comments are visual separators like:
//   //============
//   //------------
//   //**********
//
// CRITICAL: The '=' character is intentionally OMITTED from this character class.
//
// WHY: Including '=' would cause the banner-normalization logic to treat the
// equality operator '==' inside commented-out code as a decorative sequence.
// For example, the comment "// if (room == rm_island)" would have its '=='
// incorrectly collapsed or removed during formatting, breaking the commented code.
//
// WHAT WOULD BREAK: Adding '=' here would corrupt any commented-out conditionals,
// comparisons, or assignments that use '==' or '===', making them unreadable or
// syntactically incorrect when un-commented.
//
// The current set ([-_~*#<>|:.]) safely covers common decoration characters
// without risking damage to commented-out code.
const BANNER_DECORATION_CLASS = "[-_~*#<>|:.]";
const LEADING_BANNER_DECORATION_PATTERN = new RegExp(String.raw`^(?:${BANNER_DECORATION_CLASS}{2,}\s*)+`);
const TRAILING_BANNER_DECORATION_PATTERN = new RegExp(String.raw`(?:\s*${BANNER_DECORATION_CLASS}{2,})+$`);
const INNER_BANNER_DECORATION_PATTERN = new RegExp(`${BANNER_DECORATION_CLASS}{2,}`, "g");
const TRAILING_SLASH_DECORATION_PATTERN = /\/{2,}\s*$/;

const DOC_TAG_LINE_PREFIX_PATTERN = /^\/+\(\s*\)@/;

// Pattern to detect doc-like comments (e.g., "// / text") which use a forward
// slash after the comment prefix to indicate documentation-style content.
// These should not be treated as banner decorations even if they contain
// characters like "**" that would normally be considered decoration.
const DOC_LIKE_COMMENT_PATTERN = /^\/\/\s+\/(?![/])/;

function getLineCommentRawText(comment, options: any = {}) {
    const commentStart = getCommentBoundaryIndex(comment, "start");
    const commentEnd = getCommentBoundaryIndex(comment, "end");

    if (options.originalText && commentStart !== null && commentEnd !== null) {
        return options.originalText.slice(commentStart, commentEnd + 1);
    }

    if (!isObjectLike(comment)) {
        return "";
    }

    if (comment.leadingText) {
        return comment.leadingText;
    }

    if (comment.raw) {
        return comment.raw;
    }

    const fallbackValue = comment.value == null ? "" : String(comment.value);

    return `//${fallbackValue}`;
}

type BannerNormalizationOptions = {
    assumeDecorated?: boolean;
};

function normalizeBannerCommentText(candidate, options: BannerNormalizationOptions = {}) {
    if (typeof candidate !== "string") {
        return null;
    }

    const raw = candidate;
    let text = raw.trim();
    if (text.length === 0) {
        return null;
    }

    const { assumeDecorated = false } = options;
    INNER_BANNER_DECORATION_PATTERN.lastIndex = 0;
    const hasInnerDecoration = INNER_BANNER_DECORATION_PATTERN.test(raw);

    const sawDecoration =
        assumeDecorated || hasInnerDecoration || TRAILING_SLASH_DECORATION_PATTERN.test(raw) || /\/{4,}/.test(raw);

    if (!sawDecoration) {
        return null;
    }

    text = text.replace(TRAILING_SLASH_DECORATION_PATTERN, "").trim();
    if (text.length === 0) {
        return null;
    }

    text = text.replace(/^\/{4,}\s*/, "");
    text = text.replace(LEADING_BANNER_DECORATION_PATTERN, "");
    text = text.replace(TRAILING_BANNER_DECORATION_PATTERN, "");

    INNER_BANNER_DECORATION_PATTERN.lastIndex = 0;
    const innerMatches = text.match(INNER_BANNER_DECORATION_PATTERN) || [];
    for (const match of innerMatches) {
        const firstChar = match[0];
        if (match.split("").every((char) => char === firstChar)) {
            text = text.replaceAll(match, " ");
        }
    }

    text = text.replaceAll(/\s+/g, " ");

    const normalized = text.trim();
    if (normalized.length === 0) {
        return null;
    }

    if (!/[A-Za-z0-9]/.test(normalized)) {
        return null;
    }

    return normalized;
}

/**
 * Classifies key properties of a comment for formatting decisions.
 */
function analyzeCommentContext(comment, trimmedOriginal: string) {
    const startsWithTripleSlash = trimmedOriginal.startsWith("///");
    const isPlainTripleSlash = startsWithTripleSlash && !trimmedOriginal.includes("@");

    const leadingSlashMatch = trimmedOriginal.match(/^\/+/);
    const leadingSlashCount = leadingSlashMatch ? leadingSlashMatch[0].length : 0;

    const hasPrecedingLineBreak =
        isObjectLike(comment) && typeof comment.leadingWS === "string" && /\r|\n/.test(comment.leadingWS);

    const hasInlineLeadingChar =
        isObjectLike(comment) &&
        typeof comment.leadingChar === "string" &&
        comment.leadingChar.length > 0 &&
        !/\r|\n/.test(comment.leadingChar);

    const isInlineComment =
        isObjectLike(comment) &&
        comment.isTopComment !== true &&
        (typeof comment.inlinePadding === "number" ||
            comment.trailing === true ||
            comment.placement === "endOfLine" ||
            (!hasPrecedingLineBreak && hasInlineLeadingChar));

    return {
        startsWithTripleSlash,
        isPlainTripleSlash,
        leadingSlashCount,
        isInlineComment
    };
}

/**
 * Attempts to format a comment as a banner or decorative comment.
 * Returns the formatted string if successful, null otherwise.
 */
function tryFormatBannerComment(
    comment,
    trimmedOriginal: string,
    trimmedValue: string,
    slashesMatch: RegExpMatchArray | null,
    hasDecorations: boolean,
    leadingSlashCount: number
): string | null {
    if (!slashesMatch) {
        return null;
    }

    // Use the policy evaluator to determine if this is a banner comment
    const policyEvaluation = evaluateBannerCommentPolicy({
        leadingSlashCount,
        hasDecorations
    });

    if (!policyEvaluation.isBanner) {
        return null;
    }

    // For comments with 4+ leading slashes we usually treat them as
    // decorative banners. However, some inputs use many slashes to
    // indicate nested doc-like tags (for example: "//// @func ...").
    // In those cases prefer promoting to a doc comment rather than
    // stripping to a regular comment line.
    const afterStripping = trimmedValue.replace(/^\/+\s*/, "").trimStart();
    if (afterStripping.startsWith("@")) {
        const formatted = applyJsDocReplacements(`/// ${afterStripping}`);
        return applyInlinePadding(comment, formatted);
    }

    // Treat as a banner/decorative comment.
    const bannerContent = normalizeBannerCommentText(trimmedValue);
    if (bannerContent) {
        return applyInlinePadding(comment, `// ${bannerContent}`);
    }

    // If the comment consists entirely of slashes (e.g. "////////////////"),
    // treat it as a decorative separator and suppress it.
    const contentAfterStripping = trimmedValue.replace(/^\/+\s*/, "");

    if (!/[A-Za-z0-9]/.test(contentAfterStripping)) {
        if (isObjectLike(comment)) {
            comment.leadingWS = "";
            comment.trailingWS = "";
        }
        const followingNode = comment?.followingNode;
        if (isObjectLike(followingNode) && followingNode?._featherSuppressLeadingEmptyLine !== false) {
            followingNode._featherSuppressLeadingEmptyLine = true;
        }
        return "";
    }

    // If normalization fails but there is content, return the comment with normalized slashes
    // (e.g. "//// comment" -> "// comment").
    return applyInlinePadding(comment, `// ${contentAfterStripping}`);
}

/**
 * Attempts to promote a comment to doc comment format (///) if it contains @ tags.
 * Returns the formatted string if successful, null otherwise.
 */
function tryPromoteToDocComment(
    comment,
    trimmedOriginal: string,
    trimmedValue: string,
    slashesMatch: RegExpMatchArray | null,
    isPlainTripleSlash: boolean
): string | null {
    // Handle the "/ @tag" pattern where a single forward slash appears before
    // a JSDoc tag (e.g., "// / @param x"). This pattern is treated as a
    // documentation-style comment that should be normalized to the standard
    // "/// @param x" form. Detecting and rewriting this pattern ensures that
    // doc-like comments are consistently formatted, even when the original
    // source uses non-standard spacing or slash counts.
    if (slashesMatch && !isPlainTripleSlash && trimmedValue.startsWith("/") && !trimmedValue.startsWith("//")) {
        const remainder = trimmedValue.slice(1);
        if (remainder.trim().startsWith("@")) {
            const shouldInsertSpace = remainder.length > 0 && /\w/.test(remainder.charAt(1) || "");
            const formatted = applyJsDocReplacements(`///${shouldInsertSpace ? " " : ""}${remainder}`);
            return applyInlinePadding(comment, formatted);
        }
    }

    // Check if comment starts with @ tag but needs to be promoted to doc comment format
    // For example: "/ @description" or "// @description" should become "/// @description"
    if (!trimmedOriginal.startsWith("///") && trimmedOriginal.startsWith("/") && trimmedOriginal.includes("@")) {
        const afterSlashes = trimmedOriginal.replace(/^\/+\s*/, "");
        if (afterSlashes.startsWith("@")) {
            const shouldInsertSpace = afterSlashes.length > 0 && /\w/.test(afterSlashes.charAt(1) || "");
            const formatted = applyJsDocReplacements(`///${shouldInsertSpace ? " " : ""}${afterSlashes}`);
            return applyInlinePadding(comment, formatted);
        }
    }

    return null;
}

/**
 * Handles doc-like comment patterns (e.g., "// / text" should become "/// text").
 */
function tryFormatDocLikeComment(comment, trimmedOriginal: string): string | null {
    const docLikeMatch = trimmedOriginal.match(/^\/\/\s+\/(?![/])/);
    if (!docLikeMatch) {
        return null;
    }

    const remainder = trimmedOriginal.slice(docLikeMatch[0].length).trimStart();

    // If the original comment value itself looks like a nested commented-out
    // line (for example the AST produces a value like " // // something"),
    // prefer preserving the nested comment visual ("//     // something")
    // rather than promoting it to a doc comment ("/// something").
    if (
        remainder.startsWith("//") ||
        (isObjectLike(comment) && typeof comment.value === "string" && /^\s*\/\//.test(comment.value))
    ) {
        const inner = remainder.startsWith("//") ? remainder : comment.value.trimStart();
        const padded = `//     ${inner}`;
        return applyInlinePadding(comment, padded);
    }

    // Only promote if it looks like a doc tag (starts with @)
    if (remainder.startsWith("@")) {
        const formatted = `///${remainder.length > 0 ? ` ${remainder}` : ""}`;
        return applyInlinePadding(comment, formatted);
    }
    return null;
}

/**
 * Handles existing doc comments (/// @tag).
 */
function tryFormatExistingDocComment(
    comment,
    trimmedOriginal: string,
    trimmedValue: string,
    startsWithTripleSlash: boolean
): string | null {
    if (!startsWithTripleSlash || !trimmedOriginal.includes("@")) {
        return null;
    }

    const content = trimmedValue.replace(/^\/+\s*/, "");
    const formatted = applyJsDocReplacements(`/// ${content}`) as string;

    return applyInlinePadding(comment, formatted);
}

/**
 * Handles doc tag line prefix patterns (e.g., "//() @tag").
 */
function tryFormatDocTagPrefix(comment, trimmedOriginal: string, trimmedValue: string): string | null {
    const docTagSource = DOC_TAG_LINE_PREFIX_PATTERN.test(trimmedValue)
        ? trimmedValue
        : DOC_TAG_LINE_PREFIX_PATTERN.test(trimmedOriginal)
          ? trimmedOriginal
          : null;

    if (!docTagSource) {
        return null;
    }

    let formattedCommentLine = `///${docTagSource.replace(DOC_TAG_LINE_PREFIX_PATTERN, " @")}`;
    formattedCommentLine = applyJsDocReplacements(formattedCommentLine) as string;

    return applyInlinePadding(comment, formattedCommentLine);
}

/**
 * Handles commented-out code detection and formatting.
 */
function tryFormatCommentedOutCode(
    comment,
    trimmedOriginal: string,
    trimmedValue: string,
    rawValue: string,
    codeDetectionPatterns: RegExp[]
): string | null {
    const leadingWhitespaceMatch = rawValue.match(/^\s*/);
    const leadingWhitespace = leadingWhitespaceMatch ? leadingWhitespaceMatch[0] : "";
    const valueWithoutTrailingWhitespace = rawValue.replace(/\s+$/, "");
    const coreValue = valueWithoutTrailingWhitespace.slice(leadingWhitespace.length);

    if (
        coreValue.length === 0 ||
        (!trimmedValue.startsWith("//") && !looksLikeCommentedOutCode(coreValue, codeDetectionPatterns))
    ) {
        return null;
    }

    const containsTabs = /\t/.test(leadingWhitespace) || /\t/.test(coreValue);
    const shouldPreserveTabs = isObjectLike(comment) && (isNonEmptyString(comment.leadingChar) || containsTabs);
    const whitespaceSegment = shouldPreserveTabs ? leadingWhitespace : leadingWhitespace.replaceAll("\t", "    ");
    const formattedCommentLine = whitespaceSegment.length > 0 ? `//${whitespaceSegment}${coreValue}` : `//${coreValue}`;

    return applyInlinePadding(comment, formattedCommentLine, shouldPreserveTabs);
}

/**
 * Formats plain triple-slash comments that aren't doc comments.
 */
function tryFormatPlainTripleSlash(
    comment,
    trimmedOriginal: string,
    isPlainTripleSlash: boolean,
    isInlineComment: boolean,
    leadingSlashCount: number
): string | null {
    if (!isPlainTripleSlash) {
        return null;
    }

    const rawRemainder = trimmedOriginal.slice(3);
    const remainder = rawRemainder.trimStart();

    if (remainder.length === 0) {
        return "";
    }

    // Preserve continuation-style triple-slash lines that carry deliberate
    // visual indentation (typically @description continuation text).
    if (!isInlineComment && /^\s{2,}\S/.test(rawRemainder) && !remainder.startsWith("@")) {
        return applyInlinePadding(comment, trimmedOriginal);
    }

    if (isInlineComment) {
        const formatted = remainder.length > 0 ? `// ${remainder}` : "//";
        return applyInlinePadding(comment, formatted);
    }

    if (comment?.isBottomComment === true && /^\d/.test(remainder)) {
        const formatted = remainder.length > 0 ? `// ${remainder}` : "//";
        return applyInlinePadding(comment, formatted);
    }

    if (!isInlineComment && /^\d+\s*[).:-]/.test(remainder)) {
        const formatted = `// ${remainder}`;
        return applyInlinePadding(comment, formatted);
    }

    // Use the policy evaluator to check if this should be treated as a banner
    const policyEvaluation = evaluateBannerCommentPolicy({
        leadingSlashCount,
        hasDecorations: false // No decorations present in plain triple-slash comments
    });

    if (policyEvaluation.isBanner) {
        return applyInlinePadding(comment, trimmedOriginal);
    }

    return null;
}

/**
 * Formats a line comment according to the project's style conventions.
 * Uses a series of specialized helper functions to handle different comment patterns,
 * making the control flow easier to follow through early returns and guard clauses.
 */
function formatLineComment(comment, lineCommentOptions: any = DEFAULT_LINE_COMMENT_OPTIONS) {
    const normalizedOptions = normalizeLineCommentOptions(lineCommentOptions);
    const { codeDetectionPatterns } = normalizedOptions;
    const original = getLineCommentRawText(comment, lineCommentOptions);
    const trimmedOriginal = original.trim();
    const rawValue = getCommentValue(comment);
    const trimmedValue = getCommentValue(comment, { trim: true });

    // Guard: empty comments. Formatting a zero-length comment serves no purpose
    // and would produce an empty line or whitespace-only output that adds no
    // semantic value. Returning null here signals to the caller that this comment
    // should be omitted from the formatted result, keeping the output clean and
    // preventing the accumulation of meaningless blank comment lines.
    if (trimmedValue.length === 0) {
        return null;
    }

    const context = analyzeCommentContext(comment, trimmedOriginal);
    const { startsWithTripleSlash, isPlainTripleSlash, leadingSlashCount, isInlineComment } = context;

    const slashesMatch = original.match(/^\s*(\/{2,})(.*)$/);
    const contentWithoutSlashes = trimmedValue.replace(/^\/+\s*/, "");

    // Check if this is a doc-like comment before treating it as a banner
    const isDocLikeComment = DOC_LIKE_COMMENT_PATTERN.test(trimmedOriginal);

    const hasDecorations =
        !isDocLikeComment &&
        (LEADING_BANNER_DECORATION_PATTERN.test(contentWithoutSlashes) ||
            TRAILING_BANNER_DECORATION_PATTERN.test(contentWithoutSlashes) ||
            (contentWithoutSlashes.match(INNER_BANNER_DECORATION_PATTERN) || []).length > 0 ||
            TRAILING_SLASH_DECORATION_PATTERN.test(contentWithoutSlashes));

    if (
        contentWithoutSlashes.length === 0 &&
        trimmedValue.length > 0 &&
        isBelowBannerSlashThreshold(leadingSlashCount)
    ) {
        return applyInlinePadding(comment, "//");
    }

    // Try banner comment formatting
    const bannerResult = tryFormatBannerComment(
        comment,
        trimmedOriginal,
        trimmedValue,
        slashesMatch,
        hasDecorations,
        leadingSlashCount
    );
    if (bannerResult !== null) {
        return bannerResult;
    }

    // Try promoting to doc comment
    const docPromotionResult = tryPromoteToDocComment(
        comment,
        trimmedOriginal,
        trimmedValue,
        slashesMatch,
        isPlainTripleSlash
    );
    if (docPromotionResult !== null) {
        return docPromotionResult;
    }

    // Try formatting plain triple-slash comments
    const tripleSlashResult = tryFormatPlainTripleSlash(
        comment,
        trimmedOriginal,
        isPlainTripleSlash,
        isInlineComment,
        leadingSlashCount
    );
    if (tripleSlashResult !== null) {
        return tripleSlashResult;
    }

    // Try formatting doc-like comments
    const docLikeResult = tryFormatDocLikeComment(comment, trimmedOriginal);
    if (docLikeResult !== null) {
        return docLikeResult;
    }

    // Try formatting existing doc comments
    const existingDocResult = tryFormatExistingDocComment(
        comment,
        trimmedOriginal,
        trimmedValue,
        startsWithTripleSlash
    );
    if (existingDocResult !== null) {
        return existingDocResult;
    }

    // Try formatting doc tag prefix patterns
    const docTagPrefixResult = tryFormatDocTagPrefix(comment, trimmedOriginal, trimmedValue);
    if (docTagPrefixResult !== null) {
        return docTagPrefixResult;
    }

    // Try formatting commented-out code
    const commentedCodeResult = tryFormatCommentedOutCode(
        comment,
        trimmedOriginal,
        trimmedValue,
        rawValue,
        codeDetectionPatterns
    );
    if (commentedCodeResult !== null) {
        return commentedCodeResult;
    }

    // Default: format as a regular comment
    const fallbackSpacing = resolveFallbackSpacing({
        isInlineComment,
        trimmedValue,
        rawValue
    });
    const fallbackContent =
        startsWithTripleSlash && isPlainTripleSlash && trimmedValue.startsWith("/") && !trimmedValue.startsWith("//")
            ? trimmedValue.slice(1).trimStart()
            : trimmedValue;
    const fallbackCommentLine = fallbackSpacing ? `//${fallbackSpacing}${fallbackContent}` : `//${fallbackContent}`;
    const fallbackPreserveTabs = /\t/.test(fallbackSpacing);

    return applyInlinePadding(comment, fallbackCommentLine, fallbackPreserveTabs);
}

function resolveFallbackSpacing({
    isInlineComment,
    trimmedValue,
    rawValue
}: {
    isInlineComment: boolean;
    trimmedValue: string;
    rawValue: unknown;
}): string {
    if (isInlineComment) {
        return trimmedValue.length > 0 ? " " : "";
    }

    const fallbackLeadingWhitespace = typeof rawValue === "string" ? (rawValue.match(/^\s*/)?.[0] ?? "") : "";
    const normalizedFallbackWhitespace = fallbackLeadingWhitespace.replaceAll("\t", "    ");
    if (normalizedFallbackWhitespace.length > 0) {
        return normalizedFallbackWhitespace;
    }

    return trimmedValue.length > 0 ? " " : "";
}

function applyInlinePadding(comment, formattedText, preserveTabs = false) {
    const normalizedText =
        !preserveTabs && formattedText.includes("\t") ? formattedText.replaceAll("\t", "    ") : formattedText;

    const paddingWidth = resolveInlinePaddingWidth(comment);

    if (paddingWidth <= 0) {
        return normalizedText;
    }

    return " ".repeat(paddingWidth) + normalizedText;
}

function resolveInlinePaddingWidth(comment) {
    if (!isObjectLike(comment)) {
        return 0;
    }

    const { inlinePadding } = comment;
    if (typeof inlinePadding === "number" && inlinePadding > 0) {
        return inlinePadding;
    }

    return 0;
}

function looksLikeCommentedOutCode(text, codeDetectionPatterns) {
    const trimmed = toTrimmedString(text);
    if (trimmed.length === 0) {
        return false;
    }

    // Remove potential comment prefixes before testing patterns
    // For example: "// if (condition)" becomes "if (condition)"
    // This allows the patterns to match the actual code content
    const contentWithoutCommentPrefix = trimmed.replace(/^\/+\s*/, "");

    const patterns = Array.isArray(codeDetectionPatterns) ? codeDetectionPatterns : DEFAULT_COMMENTED_OUT_CODE_PATTERNS;

    for (const pattern of patterns) {
        if (!isRegExpLike(pattern)) {
            continue;
        }

        if (typeof pattern.lastIndex === "number") {
            pattern.lastIndex = 0;
        }

        if (pattern.test(contentWithoutCommentPrefix)) {
            return true;
        }
    }

    return false;
}

export { applyInlinePadding, formatLineComment, getLineCommentRawText, normalizeBannerCommentText };
