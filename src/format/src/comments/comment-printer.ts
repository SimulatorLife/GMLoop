// Comment handling helpers relocated to the format workspace so Prettier can format comments directly.

import { Core } from "@gmloop/core";
import { util } from "prettier";
import { builders } from "prettier/doc";

import { countTrailingBlankLines } from "../printer/semicolons.js";

const { isObjectLike } = Core;

const { addDanglingComment, addLeadingComment } = util;
const { join, hardline } = builders;

type PrinterComment = {
    type?: "CommentLine" | "CommentBlock";
    value?: string;
    enclosingNode?: any;
    precedingNode?: any;
    followingNode?: any;
    printed?: boolean;
    attachToBrace?: boolean;
    attachToClauseBody?: boolean;
    [key: string]: any;
};

function hasTypeProperty(value: unknown): value is { type?: string } {
    return value !== null && typeof value === "object";
}

/**
 * Remove a comment from a node's `comments` array, if present.
 *
 * This helper encapsulates the "guard → indexOf → splice" pattern so that
 * callers do not need to reach through `node.comments.indexOf(…)` /
 * `node.comments.splice(…)` chains, keeping property-access depth within
 * Law-of-Demeter bounds.
 *
 * @param node - AST node that may carry a `comments` array (may be null/undefined)
 * @param comment - The comment instance to detach
 */
function removeCommentFromNodeList(
    node: { comments?: Array<PrinterComment> } | null | undefined,
    comment: PrinterComment
): void {
    if (!node || !Array.isArray(node.comments)) {
        return;
    }
    const index = node.comments.indexOf(comment);
    if (index !== -1) {
        node.comments.splice(index, 1);
    }
}

const EMPTY_BODY_TARGETS = [{ type: "BlockStatement", property: "body" }];

const EMPTY_PARENS_TARGETS = [
    { type: "CallExpression", property: "arguments" },
    { type: "ConstructorParentClause", property: "params" },
    { type: "FunctionDeclaration", property: "params" },
    { type: "ConstructorDeclaration", property: "params" }
];

const EMPTY_LITERAL_TARGETS = [
    { type: "ArrayExpression", property: "elements" },
    { type: "StructExpression", property: "properties" },
    { type: "EnumDeclaration", property: "members" }
];

function attachDanglingCommentToEmptyNode(
    comment: PrinterComment,
    descriptors: Array<{ type: string; property: string }>
) {
    const node = comment.enclosingNode;
    if (!node) {
        return false;
    }

    for (const { type, property } of descriptors) {
        if (node.type !== type) {
            continue;
        }

        const collection = node[property];
        const isEmptyArray = Array.isArray(collection) && collection.length === 0;
        const isCollectionMissing = collection == null;
        if (isEmptyArray || isCollectionMissing) {
            addDanglingComment(node, comment, false);
            return true;
        }
    }

    return false;
}

const OWN_LINE_COMMENT_HANDLERS = [
    handleDecorativeBlockCommentOwnLine,
    handleCommentInEmptyBody,
    handleCommentInEmptyParens,
    handleOnlyComments
];

const COMMON_COMMENT_HANDLERS = [
    handleOnlyComments,
    handleClauseBlockIntroComment,
    handleCommentAttachedToOpenBrace,
    handleCommentInEmptyParens
];

const END_OF_LINE_COMMENT_HANDLERS = [
    handleDecorativeBlockCommentOwnLine,
    handleDetachedOwnLineComment,
    ...COMMON_COMMENT_HANDLERS,
    handleMacroComments
];

const REMAINING_COMMENT_HANDLERS = [
    handleDecorativeBlockCommentOwnLine,
    handleDetachedOwnLineComment,
    ...COMMON_COMMENT_HANDLERS,
    handleCommentInEmptyLiteral,
    handleMacroComments
];

function runCommentHandlers(handlers, comment, text, options, ast, isLastComment) {
    for (const handler of handlers) {
        if (handler(comment, text, options, ast, isLastComment)) {
            return true;
        }
    }

    return false;
}

function shouldSuppressComment(comment, _options) {
    if (comment.printed === true) {
        return true;
    }

    return false;
}

function suppressFormattedComment(comment, options) {
    if (!shouldSuppressComment(comment, options)) {
        return false;
    }

    const targetComment = comment;
    targetComment.printed = true;
    return true;
}

const handleComments = {
    ownLine(comment, text, options, ast, isLastComment) {
        if (suppressFormattedComment(comment, options)) {
            return true;
        }
        return runCommentHandlers(OWN_LINE_COMMENT_HANDLERS, comment, text, options, ast, isLastComment);
    },
    endOfLine(comment, text, options, ast, isLastComment) {
        if (suppressFormattedComment(comment, options)) {
            return true;
        }
        return runCommentHandlers(END_OF_LINE_COMMENT_HANDLERS, comment, text, options, ast, isLastComment);
    },
    remaining(comment, text, options, ast, isLastComment) {
        if (suppressFormattedComment(comment, options)) {
            return true;
        }
        return runCommentHandlers(REMAINING_COMMENT_HANDLERS, comment, text, options, ast, isLastComment);
    }
};

function printComment(commentPath, options) {
    const comment = commentPath.getValue();

    if (Core.isCommentNode(comment)) {
        applyTrailingCommentPadding(comment);
        applyBottomCommentInlinePadding(comment, options);
        applySingleLeadingSpacePadding(comment, options);
        if (comment?._structPropertyTrailing) {
            comment._structPropertyHandled = true;
            comment.printed = true;
            return "";
        }
        comment.printed = true;

        switch (comment.type) {
            case "CommentBlock": {
                const sourceSpan = resolveCommentSourceSpan(comment, options?.originalText);
                let rawBlockComment = `/*${typeof comment.value === "string" ? comment.value : ""}*/`;
                if (sourceSpan !== null) {
                    rawBlockComment = sourceSpan.originalText.slice(sourceSpan.startIndex, sourceSpan.endIndex + 1);
                }

                const isOwnLineComment =
                    comment.trailing !== true &&
                    comment.placement !== "endOfLine" &&
                    !hasInlineContentBeforeComment(comment, options);
                if (isOwnLineComment) {
                    comment.inlinePadding = 0;
                }

                if ((comment as PrinterComment).attachToBrace === true && isOwnLineComment) {
                    return [hardline, rawBlockComment];
                }

                if (comment._gmlForceLeadingBlankLine === true) {
                    const endIndexRaw =
                        typeof comment.end === "number"
                            ? comment.end
                            : typeof comment.end === "object" &&
                                comment.end !== null &&
                                "index" in comment.end &&
                                typeof comment.end.index === "number"
                              ? comment.end.index
                              : comment.end;
                    const endIndex = typeof endIndexRaw === "number" ? endIndexRaw : 0;
                    const blankLines = countTrailingBlankLines(options.originalText, endIndex + 1);
                    if (blankLines > 0) {
                        return [hardline, rawBlockComment, hardline, hardline];
                    }
                    return [hardline, rawBlockComment, hardline];
                }
                return rawBlockComment;
            }
            case "CommentLine": {
                const isOwnLineComment =
                    comment.trailing !== true &&
                    comment.placement !== "endOfLine" &&
                    !hasInlineContentBeforeComment(comment, options);
                if (isOwnLineComment) {
                    comment.inlinePadding = 0;
                }

                const rawText = Core.getLineCommentRawText(comment, {
                    originalText: options?.originalText
                });
                // For trailing (end-of-line) comments, ensure there is a space after the
                // opening `//` so that `//text` becomes `// text`.  This normalizes only
                // comments Prettier explicitly marks as trailing (e.g. `code; //comment`)
                // and intentionally leaves own-line comments (commented-out code, banners,
                // doc lines, etc.) completely untouched.
                const commentText =
                    comment.trailing === true && /^\/\/[^\s/]/.test(rawText) ? `// ${rawText.slice(2)}` : rawText;
                const sourceIndentationWidth = resolveCommentSourceIndentationWidth(comment, options?.originalText);
                const previousSignificantCharacter = resolvePreviousSignificantSourceCharacterBeforeComment(
                    comment,
                    options?.originalText
                );
                const previousSignificantIndex = resolvePreviousSignificantSourceIndexBeforeComment(
                    comment,
                    options?.originalText
                );
                const previousSignificantIsCommentedOutBrace =
                    previousSignificantCharacter === "}" &&
                    previousSignificantIndex !== null &&
                    isSourceIndexInsideLineComment(previousSignificantIndex, options?.originalText);
                const isRegionDirectiveComment = /^#(?:end)?region\b/u.test(rawText.trimStart());
                const followsRegionDirective =
                    isRegionDirectiveComment !== true &&
                    hasTopLevelRegionDirectiveImmediatelyBeforeComment(comment, options?.originalText);
                const allowSourceDrivenBlankLinePrepend =
                    (isRegionDirectiveComment || followsRegionDirective) &&
                    (sourceIndentationWidth === 0 || previousSignificantCharacter === "{") &&
                    previousSignificantCharacter !== null &&
                    previousSignificantCharacter !== "/" &&
                    previousSignificantCharacter !== "*" &&
                    !previousSignificantIsCommentedOutBrace &&
                    !hasTopLevelDocLineImmediatelyBeforeComment(comment, options?.originalText);
                // When this comment is a leading comment on a node that has doc comments
                // (e.g. a `// Note:` remark before a function with `/// @param...` lines),
                // the outer printer's `shouldPreserveSourceGapBeforeDocCommentedNode` path
                // already emits the blank line between the preceding statement and the
                // function.  Adding another `hardline` here would produce a double blank
                // line.  Detect this by checking whether the following node carries attached
                // doc comments; if so, delegate the blank line entirely to the outer printer.
                const followingNodeHasDocComments =
                    comment.leading === true &&
                    Array.isArray((comment as PrinterComment).followingNode?.docComments) &&
                    (comment as PrinterComment).followingNode.docComments.length > 0;
                // Blank-line insertion is gated by `allowSourceDrivenBlankLinePrepend`.
                // When that flag is false (e.g. the comment follows a `///` doc line or
                // lives inside an indented body), Prettier's own blank-line preservation
                // already emits the correct separation; adding another `hardline` here
                // would produce a double blank line.  When the flag is true (e.g. a
                // top-level comment after a regular code statement), the formatter is
                // responsible for the blank line and we check either the comment's stored
                // leading-whitespace or the original source for two consecutive newlines.
                const shouldPrependBlankLine =
                    comment._gmlForceLeadingBlankLine === true ||
                    (allowSourceDrivenBlankLinePrepend &&
                        !followingNodeHasDocComments &&
                        (hasLeadingBlankLineInWhitespace(comment) ||
                            hasSimpleLeadingBlankLineInSource(comment, options?.originalText)));
                if (shouldPrependBlankLine) {
                    return [hardline, commentText];
                }
                return commentText;
            }
            default: {
                throw new Error(`Unknown comment type`);
            }
        }
    }
    if (Core.isObjectLike(comment)) {
        comment.printed = true;
    }

    return "";
}

/**
 * Preserve a single leading space preceding a comment when that space is the
 * first character on its line. Prettier normally normalizes whitespace before
 * comments, but in GML files a solitary indent after a newline often indicates
 * intent (for example, banner-like separators). This helper records the needed
 * inline padding without altering trailing/leading classifications so the
 * printer can respect the original layout.
 */
function applySingleLeadingSpacePadding(comment, options) {
    if (!Core.isObjectLike(comment) || !options) {
        return;
    }

    const sourceSpan = resolveCommentSourceSpan(comment, options.originalText);
    if (!sourceSpan || sourceSpan.startIndex <= 0) {
        return;
    }

    const { originalText, startIndex } = sourceSpan;
    const precedingChar = originalText[startIndex - 1];
    if (precedingChar !== " ") {
        return;
    }

    const beforePrecedingIndex = startIndex - 2;
    const beforePrecedingChar = beforePrecedingIndex >= 0 ? originalText[beforePrecedingIndex] : "\n";

    if (beforePrecedingChar !== "\n" && beforePrecedingChar !== "\r") {
        return;
    }

    comment.inlinePadding = typeof comment.inlinePadding === "number" ? Math.max(comment.inlinePadding, 1) : 1;
}

function getCommentStartIndex(comment) {
    const start = comment?.start;
    if (typeof start === "number") {
        return start;
    }

    if (start && typeof start.index === "number") {
        return start.index;
    }

    return null;
}

function resolveCommentSourceSpan(comment, originalText) {
    if (!Core.isObjectLike(comment)) {
        return null;
    }

    if (typeof originalText !== "string") {
        return null;
    }

    const startIndex = getCommentStartIndex(comment);
    const endIndex = getCommentEndIndex(comment);

    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex < startIndex) {
        return null;
    }

    return { startIndex, endIndex, originalText };
}

function hasLeadingBlankLineInWhitespace(comment): boolean {
    const leadingWhitespace = typeof comment?.leadingWS === "string" ? comment.leadingWS : "";
    return /\n[\t ]*\n/u.test(leadingWhitespace);
}

function resolveCommentSourceIndentationWidth(comment, originalText): number | null {
    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (!sourceSpan) {
        return null;
    }

    const { startIndex } = sourceSpan;
    const previousLineBreakIndex = sourceSpan.originalText.lastIndexOf("\n", startIndex - 1);
    const lineStartIndex = previousLineBreakIndex === -1 ? 0 : previousLineBreakIndex + 1;
    const linePrefix = sourceSpan.originalText.slice(lineStartIndex, startIndex).replaceAll("\r", "");
    if (linePrefix.trim().length > 0) {
        return null;
    }

    return linePrefix.replaceAll("\t", "    ").length;
}

function resolvePreviousSignificantSourceCharacterBeforeComment(comment, originalText): string | null {
    const sourceIndex = resolvePreviousSignificantSourceIndexBeforeComment(comment, originalText);
    if (sourceIndex === null) {
        return null;
    }

    return originalText[sourceIndex] ?? null;
}

function resolvePreviousSignificantSourceIndexBeforeComment(comment, originalText): number | null {
    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (!sourceSpan) {
        return null;
    }

    for (let index = sourceSpan.startIndex - 1; index >= 0; index -= 1) {
        const char = sourceSpan.originalText[index];
        if (char === " " || char === "\t" || char === "\n" || char === "\r") {
            continue;
        }

        return index;
    }

    return null;
}

function isSourceIndexInsideLineComment(index: number, originalText: string | null | undefined): boolean {
    if (typeof originalText !== "string" || index < 0 || index >= originalText.length) {
        return false;
    }

    const lineStartIndex = originalText.lastIndexOf("\n", index);
    const linePrefix = originalText.slice(lineStartIndex === -1 ? 0 : lineStartIndex + 1, index + 1);
    return linePrefix.includes("//");
}

function hasTopLevelDocLineImmediatelyBeforeComment(comment, originalText): boolean {
    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (!sourceSpan) {
        return false;
    }

    const lines = sourceSpan.originalText.slice(0, sourceSpan.startIndex).split(/\r?\n/u);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index] ?? "";
        if (line.trim().length === 0) {
            continue;
        }

        return line.startsWith("///");
    }

    return false;
}

function hasSimpleLeadingBlankLineInSource(comment, originalText) {
    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (!sourceSpan) {
        return false;
    }

    const { startIndex } = sourceSpan;
    let newlineCount = 0;
    let index = startIndex - 1;

    while (index >= 0) {
        const char = originalText[index];

        if (char === "\n" || char === "\r") {
            newlineCount += 1;
            if (newlineCount >= 2) {
                return true;
            }
            index -= 1;
            continue;
        }

        if (char === " " || char === "\t") {
            index -= 1;
            continue;
        }

        return false;
    }

    return newlineCount >= 2;
}

function hasTopLevelRegionDirectiveImmediatelyBeforeComment(comment, originalText): boolean {
    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (!sourceSpan) {
        return false;
    }

    const sourceBeforeComment = sourceSpan.originalText.slice(0, sourceSpan.startIndex);
    const sourceLines = sourceBeforeComment.split(/\r?\n/u);
    let sourceIndex = sourceLines.length - 1;
    while (sourceIndex >= 0) {
        const candidateLine = sourceLines[sourceIndex]?.trim();
        if (candidateLine === "") {
            sourceIndex -= 1;
            continue;
        }
        return /^#(?:end)?region\b/u.test(candidateLine);
    }

    return false;
}

function applyTrailingCommentPadding(comment) {
    if (!Core.isObjectLike(comment)) {
        return;
    }

    const isTrailingComment = Boolean(
        comment.trailing || comment.placement === "endOfLine" || comment._structPropertyTrailing
    );

    if (!isTrailingComment) {
        return;
    }

    const enumPadding = typeof comment._enumTrailingPadding === "number" ? comment._enumTrailingPadding : 0;

    const adjustedPadding = Math.max(enumPadding, 0);

    if (typeof comment.inlinePadding === "number") {
        comment.inlinePadding = Math.max(comment.inlinePadding, adjustedPadding);
    } else if (adjustedPadding > 0) {
        comment.inlinePadding = adjustedPadding;
    }
}

function hasInlineContentBeforeComment(comment, options) {
    if (!Core.isObjectLike(comment) || !options) {
        return false;
    }

    const sourceSpan = resolveCommentSourceSpan(comment, options.originalText);
    if (!sourceSpan || sourceSpan.startIndex <= 0) {
        return false;
    }

    const { originalText, startIndex } = sourceSpan;
    const lastLineBreak = originalText.lastIndexOf("\n", startIndex - 1);
    const lineStart = lastLineBreak === -1 ? 0 : lastLineBreak + 1;
    const precedingSegment = originalText.slice(lineStart, startIndex);
    return /\S/.test(precedingSegment.replaceAll("\r", ""));
}

function getNextNonWhitespaceCharacterAfterComment(comment, originalText) {
    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (!sourceSpan) {
        return null;
    }

    const { endIndex } = sourceSpan;
    for (let index = endIndex + 1; index < originalText.length; index += 1) {
        const char = originalText[index];
        if (char === "\n" || char === "\r" || char === " " || char === "\t") {
            continue;
        }
        return char;
    }

    return null;
}

function applyBottomCommentInlinePadding(comment, options) {
    if (
        !Core.isObjectLike(comment) ||
        comment.isBottomComment !== true ||
        !hasInlineContentBeforeComment(comment, options)
    ) {
        return;
    }

    const nextChar = getNextNonWhitespaceCharacterAfterComment(comment, options?.originalText);
    if (nextChar !== null) {
        return;
    }

    // Prettier already injects a single space between the preceding code and
    // the trailing comment doc, so only request one extra padding space here to
    // reach the two-space target that the fixtures expect.
    comment.inlinePadding = 1;
}

function collectDanglingComments(path, filter) {
    const node = path.getValue();
    if (!node?.comments) {
        return [];
    }

    const entries = [];
    path.each((commentPath) => {
        const comment = commentPath.getValue();
        if (Core.isCommentNode(comment) && !comment.leading && !comment.trailing && (!filter || filter(comment))) {
            entries.push({
                commentIndex: commentPath.getName(),
                comment
            });
        }
    }, "comments");

    return entries;
}

function printCommentAtIndex(path, options, commentIndex) {
    return path.call((commentPath) => printComment(commentPath, options), "comments", commentIndex);
}

function collectPrintedDanglingComments(path, options, filter) {
    return collectDanglingComments(path, filter).map(({ commentIndex, comment }) => ({
        comment,
        printed: printCommentAtIndex(path, options, commentIndex)
    }));
}

function printDanglingComments(path, options, filter) {
    const entries = collectPrintedDanglingComments(path, options, filter);

    if (entries.length === 0) {
        return "";
    }

    return entries.map(({ comment, printed }) => (comment.attachToBrace ? [" ", printed] : [printed]));
}

function printDanglingCommentsAsGroup(path, options, filter) {
    const entries = collectPrintedDanglingComments(path, options, filter);

    if (entries.length === 0) {
        return "";
    }

    return buildDanglingCommentGroupParts(entries);
}

function buildDanglingCommentGroupParts(entries) {
    const parts = [];
    const finalIndex = entries.length - 1;

    for (const [index, entry] of entries.entries()) {
        appendDanglingCommentGroupEntry(parts, entry, index, finalIndex);
    }

    return parts;
}

function appendDanglingCommentGroupEntry(parts, entry, index, finalIndex) {
    const { comment, printed } = entry;

    if (index === 0) {
        parts.push(whitespaceToDoc(normalizeDanglingGroupLeadingWhitespace(comment.leadingWS)));
    }

    parts.push([printed]);

    if (index !== finalIndex) {
        parts.push(resolveDanglingCommentSeparator(comment));
    }
}

function normalizeDanglingGroupLeadingWhitespace(text: unknown): string {
    if (typeof text !== "string") {
        return "";
    }

    return text.replace(/(\r?\n)[ \t]+$/, "$1");
}

function resolveDanglingCommentSeparator(comment) {
    if (isDecorativeBlockComment(comment)) {
        return hardline;
    }
    const separator = whitespaceToDoc(comment.trailingWS);
    return separator === "" ? " " : separator;
}

function handleCommentInEmptyBody(comment /*, text, options, ast, isLastComment */) {
    return attachDanglingCommentToEmptyNode(comment, EMPTY_BODY_TARGETS);
}

function handleDetachedOwnLineComment(comment /*, text, options, ast */) {
    const { precedingNode, followingNode } = comment;

    if (!precedingNode || !followingNode) {
        return false;
    }

    const commentLine = comment?.start?.line;
    const precedingEndLine = precedingNode?.end?.line;
    const followingStartLine = followingNode?.start?.line;

    if (!Number.isFinite(commentLine) || !Number.isFinite(precedingEndLine) || !Number.isFinite(followingStartLine)) {
        return false;
    }

    if (commentLine <= precedingEndLine) {
        return false;
    }

    if (commentLine >= followingStartLine) {
        return false;
    }

    addLeadingComment(followingNode, comment);
    comment.leading = true;
    comment.trailing = false;
    comment.placement = "ownLine";
    const leadingWhitespace = typeof comment.leadingWS === "string" ? comment.leadingWS : "";
    if (!/[\r\n]/.test(leadingWhitespace)) {
        comment.leadingWS = "\n\n";
    } else if (!/[\r\n][\t ]*[\r\n]/.test(leadingWhitespace)) {
        comment.leadingWS = `${leadingWhitespace}\n`;
    }
    comment.trailingWS = "\n";
    return true;
}

function handleDecorativeBlockCommentOwnLine(comment, _text, _options, ast) {
    const text = _text;
    void _options;
    if (!comment || comment.type !== "CommentBlock") {
        return false;
    }

    const decorated = formatDecorativeBlockComment(comment, text);
    if (decorated === null) {
        return false;
    }

    const followingNode = comment.followingNode ?? findFollowingNodeForComment(ast, comment);
    if (!followingNode) {
        return false;
    }

    const hadPrecedingNode = Boolean(comment.precedingNode);
    const shouldForceLeadingBlankLine = !hadPrecedingNode && comment.enclosingNode?.type === "Program";

    removeCommentFromNodeList(followingNode, comment);
    addLeadingComment(followingNode, comment);
    removeCommentFromNodeList(comment.precedingNode, comment);
    removeCommentFromNodeList(comment.enclosingNode, comment);
    comment.precedingNode = null;
    comment.followingNode = followingNode;
    comment.leading = true;
    comment.trailing = false;
    comment.placement = "ownLine";
    comment._gmlForceLeadingBlankLine = shouldForceLeadingBlankLine;
    const leadingWhitespace = typeof comment.leadingWS === "string" ? comment.leadingWS : "";

    if (shouldForceLeadingBlankLine && !/\r|\n/.test(leadingWhitespace)) {
        comment.leadingWS = "\n";
    }
    comment.trailingWS = shouldForceLeadingBlankLine ? "\n" : "";
    return true;
}

function findFollowingNodeForComment(ast, comment) {
    const commentEndIndex = getCommentEndIndex(comment);
    if (!Number.isFinite(commentEndIndex)) {
        return null;
    }

    const visited = new WeakSet();
    const stack = [ast];
    let candidate = null;
    let candidateStart = Infinity;

    while (stack.length > 0) {
        const node = stack.pop();
        if (!isObjectLike(node)) {
            continue;
        }

        if (visited.has(node)) {
            continue;
        }
        visited.add(node);

        if (Core.isNode(node) && !Core.isCommentNode(node)) {
            const startIndex = Core.getNodeStartIndex(node);
            if (typeof startIndex === "number" && startIndex > commentEndIndex && startIndex < candidateStart) {
                candidate = node;
                candidateStart = startIndex;
            }
        }

        // Use Object.keys instead of Object.entries to avoid allocating intermediate
        // [key, value] tuple arrays on every visited node. Benchmarked at ~16% faster
        // in AST traversals versus Object.entries. Mirrors the optimization in
        // collectCommentNodes (src/core/src/comments/comment-utils.ts).
        for (const key of Object.keys(node)) {
            if (key === "comments" || key === "docComments") {
                continue;
            }

            const value = node[key];
            pushChildrenToStack(stack, value);
        }
    }

    return candidate;
}

function pushChildrenToStack(stack, value) {
    if (value && typeof value === "object") {
        if (Array.isArray(value)) {
            for (const entry of value) {
                if (entry && typeof entry === "object") {
                    stack.push(entry);
                }
            }
        } else {
            stack.push(value);
        }
    }
}

function getCommentEndIndex(comment) {
    const end = comment?.end;
    if (typeof end === "number") {
        return end;
    }

    if (end && typeof end.index === "number") {
        return end.index;
    }

    return null;
}

function handleMacroComments(comment) {
    if (comment.enclosingNode?.type === "MacroDeclaration") {
        comment.printed = true;
        return true;
    }
    return false;
}

function isDecorativeBlockComment(comment) {
    if (!comment || comment.type !== "CommentBlock") {
        return false;
    }

    const value = typeof comment.value === "string" ? comment.value : null;
    if (value === null) {
        return false;
    }

    return hasDecorativeSlashBanner(value);
}

function handleCommentAttachedToOpenBrace(comment, _text, _options, ast /*, isLastComment */) {
    void _text;
    void _options;
    let enclosingNode = comment.enclosingNode;

    if (!enclosingNode && comment?.leadingChar === "{") {
        enclosingNode = findBraceOwnerForComment(ast, comment);
        if (enclosingNode) {
            comment.enclosingNode = enclosingNode;
        }
    }

    if (!isBlockStatement(enclosingNode) && enclosingNode?.type !== "SwitchStatement") {
        return false;
    }

    const leadingWhitespace = typeof comment?.leadingWS === "string" ? comment.leadingWS : "";
    const isCommentImmediatelyAfterOpeningBrace = comment?.leadingChar === "{" && !/[\r\n]/u.test(leadingWhitespace);
    if (!isCommentOnNodeStartLine(comment, enclosingNode) && !isCommentImmediatelyAfterOpeningBrace) {
        return false;
    }

    comment.attachToBrace = true;
    addDanglingComment(enclosingNode, comment, false);
    return true;
}

function handleClauseBlockIntroComment(comment, _text, _options, _ast /*, isLastComment */) {
    void _text;
    void _options;
    void _ast;
    const { enclosingNode, precedingNode, followingNode } = comment;
    if (!enclosingNode || !followingNode) {
        return false;
    }

    const clauseConfig = resolveClauseCommentConfig(enclosingNode);
    if (!clauseConfig) {
        return false;
    }

    const clauseNode = enclosingNode[clauseConfig.clauseKey];
    const bodyNode = enclosingNode[clauseConfig.bodyKey];
    if (bodyNode !== followingNode) {
        return false;
    }

    if (clauseNode !== precedingNode) {
        return false;
    }

    if (clauseNode?.type !== "ParenthesizedExpression") {
        return false;
    }

    if (!isCommentOnNodeEndLine(comment, clauseNode)) {
        return false;
    }

    if (bodyNode?.type === "BlockStatement") {
        comment.attachToBrace = true;
        addDanglingComment(bodyNode, comment, false);
    } else {
        comment.attachToClauseBody = true;
        addDanglingComment(enclosingNode, comment, false);
    }

    if (typeof comment.leadingWS === "string") {
        comment.leadingWS = comment.leadingWS.replaceAll("\t", "    ");
    }

    comment.leading = false;
    comment.trailing = false;
    delete comment.placement;
    return true;
}

function resolveClauseCommentConfig(node) {
    switch (node?.type) {
        case "IfStatement": {
            return { clauseKey: "test", bodyKey: "consequent" };
        }
        case "WhileStatement":
        case "RepeatStatement":
        case "WithStatement": {
            return { clauseKey: "test", bodyKey: "body" };
        }
        default: {
            return null;
        }
    }
}

function isBlockStatement(node) {
    return node?.type === "BlockStatement";
}

function findBraceOwnerForComment(ast, comment) {
    if (!ast || !comment) {
        return null;
    }

    const { index: commentIndex, line: commentLine } = getLocationMetadata(comment.start);

    if (!Number.isFinite(commentIndex) || !Number.isFinite(commentLine)) {
        return null;
    }

    let match = null;
    const stack = [ast];
    const seen = new Set();

    while (stack.length > 0) {
        const node = stack.pop();
        if (!isObjectLike(node) || seen.has(node)) {
            continue;
        }

        seen.add(node);

        if (!node.type) {
            continue;
        }

        const { index: startIndex, line: startLine } = getLocationMetadata(node.start);
        const { index: endIndex } = getLocationMetadata(node.end);

        if (
            Number.isFinite(startIndex) &&
            Number.isFinite(endIndex) &&
            commentIndex >= startIndex &&
            commentIndex <= endIndex &&
            commentLine === startLine &&
            node.type === "SwitchStatement" &&
            (!match || getLocationMetadata(match.start).index <= startIndex)
        ) {
            match = node;
        }

        for (const value of Object.values(node)) {
            if (Array.isArray(value)) {
                pushTypedEntries(stack, value);
                continue;
            }

            if (hasTypeProperty(value) && value.type && value.type !== "CommentBlock" && value.type !== "CommentLine") {
                stack.push(value);
            }
        }
    }

    return match;
}

function pushTypedEntries(stack: Array<any>, entries: Array<unknown>): void {
    for (const entry of entries) {
        if (hasTypeProperty(entry) && entry.type) {
            stack.push(entry);
        }
    }
}

function getLocationMetadata(position) {
    if (position == null) {
        return { index: Number.NaN, line: Number.NaN };
    }

    if (typeof position === "number") {
        return { index: position, line: Number.NaN };
    }

    const index = typeof position.index === "number" ? position.index : Number.NaN;
    const line = typeof position.line === "number" ? position.line : Number.NaN;

    return { index, line };
}

function isCommentOnNodeLine(comment, node, getNodeLine) {
    const commentLine = comment.start?.line;
    const nodeLine = getNodeLine(node);

    const isCommentLineMissing = commentLine == null;
    const isNodeLineMissing = nodeLine == null;

    if (isCommentLineMissing || isNodeLineMissing) {
        return false;
    }

    return commentLine === nodeLine;
}

function isCommentOnNodeStartLine(comment, node) {
    return isCommentOnNodeLine(comment, node, (target) => target?.start?.line);
}

function isCommentOnNodeEndLine(comment, node) {
    return isCommentOnNodeLine(comment, node, (target) => target?.end?.line);
}

function handleCommentInEmptyParens(comment /*, text, options, ast, isLastComment */) {
    if (comment.leadingChar !== "(" || comment.trailingChar !== ")") {
        return false;
    }

    return attachDanglingCommentToEmptyNode(comment, EMPTY_PARENS_TARGETS);
}

function handleCommentInEmptyLiteral(comment /*, text, options, ast, isLastComment */) {
    return attachDanglingCommentToEmptyNode(comment, EMPTY_LITERAL_TARGETS);
}

function handleOnlyComments(comment, options, ast /*, isLastComment */) {
    if (attachDocCommentToFollowingNode(comment, options, ast)) {
        return true;
    }

    const emptyProgram = findEmptyProgramTarget(ast, comment.enclosingNode, comment.followingNode);
    if (emptyProgram) {
        addDanglingComment(emptyProgram, comment, false);
        return true;
    }

    return false;
}

function attachDocCommentToFollowingNode(comment, options, ast) {
    if (comment?._gmlAttachedDocComment === true) {
        comment.printed = true;
        return true;
    }

    const immediateFollowingNode = resolveFollowingNonCommentNode(comment);
    const followingNode =
        isDocCommentTargetNode(immediateFollowingNode) || !ast
            ? immediateFollowingNode
            : findFollowingNodeForComment(ast, comment);

    if (!isDocCommentCandidate(comment, followingNode)) {
        return false;
    }
    if (hasMixedCommentSyntaxBetweenCommentAndTarget(comment, followingNode, options?.originalText)) {
        return false;
    }

    const rawText = Core.getLineCommentRawText(comment, {
        originalText: options?.originalText
    });
    const shouldAttachAsDocComment = /^\s*\/\/\//u.test(rawText);

    if (!shouldAttachAsDocComment) {
        return false;
    }

    if (!followingNode.docComments) {
        followingNode.docComments = [];
    }

    followingNode.docComments.push(comment);
    comment._gmlAttachedDocComment = true;
    comment.printed = true;
    return true;
}

function hasMixedCommentSyntaxBetweenCommentAndTarget(comment, followingNode, originalText) {
    if (typeof originalText !== "string") {
        return false;
    }

    const commentEndIndex = getCommentEndIndex(comment);
    const followingNodeStartIndex = Core.getNodeStartIndex(followingNode);
    if (
        commentEndIndex === null ||
        typeof followingNodeStartIndex !== "number" ||
        commentEndIndex >= followingNodeStartIndex
    ) {
        return false;
    }

    const textBetweenCommentAndTarget = originalText.slice(commentEndIndex + 1, followingNodeStartIndex);
    return /(^|\r?\n)[ \t]*\/\/(?!\/)|\/\*/u.test(textBetweenCommentAndTarget);
}

function isDocCommentCandidate(comment, followingNode) {
    if (comment.type !== "CommentLine" && comment.type !== "CommentBlock") {
        return false;
    }

    return isDocCommentTargetNode(followingNode);
}

function isFunctionLikeDocInitializer(node: unknown): boolean {
    if (!isObjectLike(node)) {
        return false;
    }

    const nodeRecord = node as Record<string, unknown>;
    const initializerType = nodeRecord.type;
    if (
        initializerType === "FunctionDeclaration" ||
        initializerType === "FunctionExpression" ||
        initializerType === "ConstructorDeclaration"
    ) {
        return true;
    }

    if (initializerType === "ParenthesizedExpression") {
        return isFunctionLikeDocInitializer(nodeRecord.expression);
    }

    return false;
}

function isFunctionInitializedVariableDeclaration(node: unknown): boolean {
    if (!isObjectLike(node)) {
        return false;
    }

    const nodeRecord = node as Record<string, unknown>;
    if (nodeRecord.type !== "VariableDeclaration") {
        return false;
    }

    const declarations = nodeRecord.declarations;
    if (!Array.isArray(declarations) || declarations.length !== 1) {
        return false;
    }

    const declarator = declarations[0];
    if (!isObjectLike(declarator)) {
        return false;
    }

    const declaratorRecord = declarator as Record<string, unknown>;
    if (declaratorRecord.type !== "VariableDeclarator") {
        return false;
    }

    return isFunctionLikeDocInitializer(declaratorRecord.init);
}

function isDocCommentTargetNode(node) {
    if (!isObjectLike(node)) {
        return false;
    }

    const nodeType = Reflect.get(node, "type");
    return nodeType === "FunctionDeclaration" || nodeType === "ConstructorDeclaration"
        ? true
        : isFunctionInitializedVariableDeclaration(node);
}

function resolveFollowingNonCommentNode(comment) {
    let candidate = comment?.followingNode ?? null;

    while (Core.isCommentNode(candidate) && isObjectLike(candidate) && "followingNode" in candidate) {
        const nextCandidate = candidate.followingNode;
        if (!nextCandidate || nextCandidate === candidate) {
            break;
        }
        candidate = nextCandidate;
    }

    return candidate;
}

function hasEmptyBody(candidate) {
    return Array.isArray(candidate?.body) && candidate.body.length === 0;
}

function isEmptyProgramNode(candidate) {
    return candidate?.type === "Program" && hasEmptyBody(candidate);
}

function findEmptyProgramTarget(ast, enclosingNode, followingNode) {
    if (hasEmptyBody(ast)) {
        return ast;
    }

    if (isEmptyProgramNode(enclosingNode)) {
        return enclosingNode;
    }

    if (isEmptyProgramNode(followingNode)) {
        return followingNode;
    }

    return null;
}

function formatDecorativeBlockComment(comment, originalText) {
    const value = typeof comment?.value === "string" ? comment.value : null;
    if (value === null) {
        return null;
    }

    const lines = value.split(/\r?\n/);
    if (containsCommentedOutCodeLines(lines)) {
        return null;
    }
    const significantLines = lines.filter((line) => Core.isNonEmptyTrimmedString(line));
    if (significantLines.length === 0) {
        return null;
    }

    if (!hasDecorativeSlashBanner(value)) {
        return null;
    }

    const sourceSpan = resolveCommentSourceSpan(comment, originalText);
    if (sourceSpan !== null) {
        const sourceCommentText = sourceSpan.originalText.slice(sourceSpan.startIndex, sourceSpan.endIndex + 1);
        return normalizeDecorativeCommentSourceIndentation(sourceCommentText, comment);
    }

    return `/*${value}*/`;
}

function normalizeDecorativeCommentSourceIndentation(sourceCommentText: string, comment: PrinterComment): string {
    const lines = sourceCommentText.split(/\r?\n/).map((line) => line.replaceAll("\t", "    "));
    if (lines.length === 0) {
        return sourceCommentText;
    }

    const nonEmptyLines = lines.map((line, index) => ({ index, line })).filter(({ line }) => line.trim().length > 0);
    if (nonEmptyLines.length === 0) {
        return lines.join("\n");
    }

    const desiredIndentation = resolveDecorativeCommentTargetIndentation(comment);
    const firstNonEmptyIndex = nonEmptyLines[0]?.index ?? -1;
    const lastNonEmptyIndex = nonEmptyLines.at(-1)?.index ?? -1;

    if (firstNonEmptyIndex < 0 || lastNonEmptyIndex < 0) {
        return lines.join("\n");
    }

    const openingLine = lines[firstNonEmptyIndex] ?? "";
    const openingIndentation = openingLine.length - openingLine.trimStart().length;
    const openingDedent = Math.max(0, openingIndentation - desiredIndentation);

    let minimumInteriorIndentation: number | null = null;
    for (let lineIndex = firstNonEmptyIndex + 1; lineIndex < lastNonEmptyIndex; lineIndex += 1) {
        const interiorLine = lines[lineIndex] ?? "";
        if (interiorLine.trim().length === 0) {
            continue;
        }

        const interiorIndentation = interiorLine.length - interiorLine.trimStart().length;
        if (minimumInteriorIndentation === null || interiorIndentation < minimumInteriorIndentation) {
            minimumInteriorIndentation = interiorIndentation;
        }
    }

    const desiredInteriorIndentation = desiredIndentation + 4;
    const interiorDedent =
        minimumInteriorIndentation === null
            ? openingDedent
            : Math.max(0, minimumInteriorIndentation - desiredInteriorIndentation);

    const normalizedLines = lines.map((line, lineIndex) => {
        if (line.trim().length === 0) {
            return "";
        }

        if (lineIndex === firstNonEmptyIndex) {
            return line.slice(Math.min(openingDedent, line.length));
        }

        if (lineIndex > firstNonEmptyIndex && lineIndex < lastNonEmptyIndex) {
            const trimmedLine = line.trimStart();
            const contentIndentation = line.length - trimmedLine.length;
            const dedentedContentIndentation = Math.max(0, contentIndentation - interiorDedent);
            const targetIndentation = Math.max(desiredInteriorIndentation, dedentedContentIndentation);
            return `${" ".repeat(targetIndentation)}${trimmedLine}`;
        }

        return line.slice(Math.min(openingDedent, line.length));
    });

    const closingIndex = normalizedLines.findLastIndex((line) => line.trim().length > 0);
    if (closingIndex !== -1 && /^\s*\*\/{10,}\s*$/.test(normalizedLines[closingIndex])) {
        normalizedLines[closingIndex] = normalizedLines[closingIndex].trimStart();
    }

    return normalizedLines.join("\n");
}

function resolveDecorativeCommentTargetIndentation(comment: PrinterComment): number {
    const followingColumn = comment?.followingNode?.start?.column;
    if (typeof followingColumn === "number" && Number.isFinite(followingColumn)) {
        return Math.max(0, followingColumn);
    }

    const precedingColumn = comment?.precedingNode?.start?.column;
    if (typeof precedingColumn === "number" && Number.isFinite(precedingColumn)) {
        return Math.max(0, precedingColumn);
    }

    if (comment?.enclosingNode?.type === "Program") {
        return 0;
    }

    return 0;
}

function hasDecorativeSlashBanner(commentValue: string): boolean {
    const lines = commentValue.split(/\r?\n/);
    let hasDecorativeLine = false;

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0) {
            continue;
        }

        if (Core.isDecorativeSlashCommentLine(trimmedLine)) {
            hasDecorativeLine = true;
        }
    }

    return hasDecorativeLine;
}

function containsCommentedOutCodeLines(lines) {
    const codeDetectionPatterns = Core.DEFAULT_COMMENTED_OUT_CODE_PATTERNS;

    for (const line of lines) {
        const trimmed = line.trimStart();
        const content = normalizeCommentedCodeCandidate(trimmed);
        if (content === "") {
            continue;
        }

        if (/^\/+$/.test(content)) {
            continue;
        }

        for (const pattern of codeDetectionPatterns) {
            pattern.lastIndex = 0;
            if (pattern.test(content)) {
                return true;
            }
        }
    }

    return false;
}

function normalizeCommentedCodeCandidate(trimmedLine) {
    if (trimmedLine.startsWith("//")) {
        return trimmedLine.slice(2).trim();
    }

    if (trimmedLine.startsWith("*")) {
        return trimmedLine.slice(1).trim();
    }

    return trimmedLine.trim();
}

function whitespaceToDoc(text) {
    const lineBreakCount = Core.getLineBreakCount(text);
    if (lineBreakCount === 0) {
        return text;
    }

    const lines = Core.splitLines(text);
    return join(hardline, lines);
}

export { handleComments, printComment, printDanglingComments, printDanglingCommentsAsGroup };
