import { Core } from "@gmloop/core";

const { isObjectLike } = Core;

// Use flattened Core namespace helpers directly to match the Core export shape.
// Avoid nested destructuring (Core.Utils / Core.AST) per AGENTS.md.
const isNonEmptyArray = Core.isNonEmptyArray;
const getCommentArray = Core.getCommentArray;

const ENUM_INITIALIZER_OPERATOR_WIDTH = " = ".length;

/**
 * Mutate an enum declaration so subsequent printer passes know how much spacing
 * is required to align member names, initializers, and trailing comments.
 *
 * Each member receives bookkeeping properties (for example,
 * `_enumNameAlignmentPadding`) that store the padding width needed to align the
 * columnar layout. When no alignment work is required the function exits early
 * to avoid allocating metadata in hot printer paths.
 *
 * @param {{
 *     members?: Array<unknown> | null | undefined;
 *     hasTrailingComma?: boolean;
 } | null | undefined} enumNode Enum AST node to augment.
 * @param {(node: unknown) => string | null | undefined} [getNodeName]
 *        Optional resolver used to extract a stable member name.
 */
export function prepareEnumMembersForPrinting(enumNode, getNodeName) {
    if (!isObjectLike(enumNode)) {
        return;
    }

    const members = enumNode.members;
    if (!isNonEmptyArray(members)) {
        return;
    }

    const resolveName = typeof getNodeName === "function" ? getNodeName : undefined;
    const { memberStats, maxInitializerNameLength, allMembersHaveInitializer } = collectEnumMemberStats(
        members,
        resolveName
    );

    const shouldAlignInitializers = allMembersHaveInitializer && maxInitializerNameLength > 0;

    const maxMemberWidth = applyEnumMemberAlignment({
        memberStats,
        shouldAlignInitializers,
        maxInitializerNameLength
    });

    if (maxMemberWidth === 0) {
        return;
    }

    const hasTrailingComma = enumNode?.hasTrailingComma === true;
    applyTrailingCommentPadding({
        memberStats,
        maxMemberWidth,
        hasTrailingComma,
        shouldAlignInitializers
    });
}

/**
 * Retrieve the alignment padding previously attached by
 * {@link prepareEnumMembersForPrinting}. Callers default to zero so the printer
 * can treat members without metadata as already aligned.
 *
 * @param {unknown} member Enum member node carrying optional alignment state.
 * @returns {number} Non-negative padding width in spaces.
 */
export function getEnumNameAlignmentPadding(member) {
    if (!member) {
        return 0;
    }

    const padding = member._enumNameAlignmentPadding;
    return typeof padding === "number" && padding > 0 ? padding : 0;
}

function getEnumInitializerWidth(initializer) {
    if (initializer == null) {
        return 0;
    }

    if (typeof initializer === "number") {
        return String(initializer).length;
    }

    const normalized = typeof initializer === "object" ? extractInitializerText(initializer) : initializer;

    if (typeof normalized === "number") {
        return String(normalized).trim().length;
    }

    if (typeof normalized === "string") {
        return normalized.trim().length;
    }

    return String(normalized ?? "").trim().length;
}

function extractInitializerText(initializer) {
    if (typeof initializer._enumInitializerText === "string") {
        return initializer._enumInitializerText;
    }

    return initializer.value ?? "";
}

function collectTrailingEnumComments(member) {
    const trailingComments = getCommentArray(member).filter(
        (comment) =>
            comment &&
            typeof comment === "object" &&
            (("trailing" in comment && comment.trailing === true) ||
                ("placement" in comment && comment.placement === "endOfLine"))
    );

    return trailingComments.length > 0 ? trailingComments : null;
}

/**
 * Extract statistics for a single enum member, including name length,
 * initializer presence, and trailing comments.
 *
 * @param {unknown} member Enum member node to analyze.
 * @param {((node: unknown) => string | null | undefined) | undefined} resolveName
 *        Optional resolver to extract member name.
 * @returns {{
 *     member: unknown;
 *     nameLength: number;
 *     initializerWidth: number;
 *     hasInitializer: boolean;
 *     trailingComments: unknown[] | null;
 * }} Member statistics object.
 */
function collectSingleMemberStats(member, resolveName) {
    const rawName = resolveName ? resolveName(member?.name) : undefined;
    const nameLength = typeof rawName === "string" ? rawName.length : 0;
    const initializer = member?.initializer;
    const hasInitializer = Boolean(initializer);
    const initializerWidth = getEnumInitializerWidth(initializer);

    return {
        member,
        nameLength,
        initializerWidth,
        hasInitializer,
        trailingComments: collectTrailingEnumComments(member)
    };
}

function collectEnumMemberStats(members, resolveName) {
    const memberCount = members.length;
    const memberStats = Array.from({ length: memberCount });

    // Avoid `Array#map` here to prevent allocating a fresh callback closure on every
    // enum formatting pass. The enum alignment logic runs frequently in real-world GML
    // codebases (which often contain dozens or hundreds of enums), and profiling shows
    // that using a manual loop instead of `.map()` reduces both allocation pressure and
    // total formatting time by a measurable margin. This is a hot path optimization:
    // the code produces the same `memberStats` array structure, but skips the overhead
    // of wrapping each iteration in a callback function, which lets the JIT compile
    // more aggressive inline code. The tradeoff is slightly more verbose iteration logic
    // in exchange for faster enum printing, which matters because enum alignment is one
    // of the formatter's performance bottlenecks when handling large GameMaker projects.
    //
    // We also compute maxInitializerNameLength and allMembersHaveInitializer in a single
    // pass to avoid multiple O(n) iterations over the memberStats array.
    let maxInitializerNameLength = 0;
    let allMembersHaveInitializer = true;

    for (let index = 0; index < memberCount; index += 1) {
        const stats = collectSingleMemberStats(members[index], resolveName);
        memberStats[index] = stats;

        if (stats.hasInitializer && stats.nameLength > maxInitializerNameLength) {
            maxInitializerNameLength = stats.nameLength;
        } else if (!stats.hasInitializer) {
            allMembersHaveInitializer = false;
        }
    }

    return { memberStats, maxInitializerNameLength, allMembersHaveInitializer };
}

function applyEnumMemberAlignment({ memberStats, shouldAlignInitializers, maxInitializerNameLength }) {
    let maxMemberWidth = 0;

    for (const entry of memberStats) {
        const alignmentPadding =
            shouldAlignInitializers && entry.hasInitializer ? maxInitializerNameLength - entry.nameLength : 0;

        entry.member._enumNameAlignmentPadding = alignmentPadding;

        const initializerSpan = entry.hasInitializer ? ENUM_INITIALIZER_OPERATOR_WIDTH + entry.initializerWidth : 0;

        const memberWidth = entry.nameLength + alignmentPadding + initializerSpan;

        entry.memberWidth = memberWidth;
        if (memberWidth > maxMemberWidth) {
            maxMemberWidth = memberWidth;
        }
    }

    return maxMemberWidth;
}

function applyTrailingCommentPadding({ memberStats, maxMemberWidth, hasTrailingComma, shouldAlignInitializers }) {
    if (shouldAlignInitializers) {
        return;
    }

    const lastIndex = memberStats.length - 1;

    // Manual index iteration avoids allocating iterator tuples from
    // `Array#entries()` while the printer walks enum members.
    for (let index = 0; index <= lastIndex; index += 1) {
        const entry = memberStats[index];
        const trailingComments = entry.trailingComments;
        if (!Core.isNonEmptyArray(trailingComments)) {
            continue;
        }

        const trailingCount = trailingComments.length;

        const basePadding = maxMemberWidth - entry.memberWidth;
        if (basePadding <= 0) {
            continue;
        }

        const commaWidth = index !== lastIndex || hasTrailingComma ? 1 : 0;
        const extraPadding = basePadding - commaWidth;

        if (extraPadding <= 0) {
            continue;
        }

        for (let commentIndex = 0; commentIndex < trailingCount; commentIndex += 1) {
            const comment = trailingComments[commentIndex];
            const previous = comment._enumTrailingPadding;

            // Skip reassignments when another member already provided padding
            // that meets or exceeds the computed width. This mirrors the
            // original Math.max call while avoiding the extra allocation.
            if (typeof previous !== "number" || previous < extraPadding) {
                comment._enumTrailingPadding = extraPadding;
            }
        }
    }
}
