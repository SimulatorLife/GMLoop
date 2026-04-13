import { Core } from "@gmloop/core";

const {
    getCommentArray,
    getNodeStartIndex,
    isDocCommentLine,
    isFunctionLikeNode,
    isNode,
    isNonEmptyArray,
    isNonEmptyTrimmedString,
    toMutableArray
} = Core;

export interface DocCommentTraversalManager {
    forEach(callback: (node: unknown, comments?: readonly unknown[] | null) => void): void;
}

export interface DocCommentCollectionManager {
    getComments(functionNode: unknown): Array<unknown>;
}

export interface DocCommentPresenceManager {
    hasDocComment(functionNode: unknown): boolean;
}

export interface DocCommentDescriptionManager {
    extractDescription(functionNode: unknown): string | null;
}

export interface DocCommentUpdateManager {
    applyUpdates(docUpdates: unknown): void;
}

type DocCommentManager = DocCommentTraversalManager &
    DocCommentCollectionManager &
    DocCommentPresenceManager &
    DocCommentDescriptionManager &
    DocCommentUpdateManager;

const DOC_COMMENT_MANAGERS: WeakMap<object, DocCommentManager> = new WeakMap();

const NOOP_DOC_COMMENT_MANAGER = Object.freeze({
    applyUpdates(_docUpdates: unknown) {},
    forEach(_callback: (node: unknown, comments?: readonly unknown[] | null) => void) {},
    getComments() {
        return [];
    },
    extractDescription() {
        return null;
    },
    hasDocComment() {
        return false;
    }
}) as DocCommentManager;

export function prepareDocCommentEnvironment(ast: unknown): DocCommentManager {
    if (!isNode(ast)) {
        return NOOP_DOC_COMMENT_MANAGER;
    }

    let manager = DOC_COMMENT_MANAGERS.get(ast);

    if (manager) {
        return manager;
    }

    manager = Object.freeze(createDocCommentManager(ast));
    DOC_COMMENT_MANAGERS.set(ast, manager);
    return manager;
}

/**
 * Resolve the doc-comment traversal service for the given AST.
 *
 * Returns the cached, frozen {@link DocCommentManager} which implements all
 * service interfaces. TypeScript narrows the return type so callers only see
 * the traversal facet at compile time.
 */
export function resolveDocCommentTraversalService(ast?: unknown): DocCommentTraversalManager {
    return prepareDocCommentEnvironment(ast);
}

/**
 * Resolve the doc-comment collection service for the given AST.
 */
export function resolveDocCommentCollectionService(ast?: unknown): DocCommentCollectionManager {
    return prepareDocCommentEnvironment(ast);
}

/**
 * Resolve the doc-comment presence service for the given AST.
 */
export function resolveDocCommentPresenceService(ast?: unknown): DocCommentPresenceManager {
    return prepareDocCommentEnvironment(ast);
}

/**
 * Resolve the doc-comment description service for the given AST.
 */
export function resolveDocCommentDescriptionService(ast?: unknown): DocCommentDescriptionManager {
    return prepareDocCommentEnvironment(ast);
}

/**
 * Resolve the doc-comment update service for the given AST.
 */
export function resolveDocCommentUpdateService(ast?: unknown): DocCommentUpdateManager {
    return prepareDocCommentEnvironment(ast);
}

function createDocCommentManager(ast: unknown): DocCommentManager {
    normalizeDocCommentWhitespace(ast);

    const commentGroups = mapDocCommentsToFunctions(ast);

    return {
        applyUpdates(docUpdates) {
            applyDocCommentUpdates(commentGroups, docUpdates);
        },
        forEach(callback) {
            if (typeof callback !== "function") {
                return;
            }

            for (const [fn, comments] of commentGroups.entries()) {
                callback(fn, comments ?? []);
            }
        },
        getComments(functionNode) {
            const comments = commentGroups.get(functionNode);
            return toMutableArray(comments);
        },
        extractDescription(functionNode) {
            return extractFunctionDescription(commentGroups, functionNode);
        },
        hasDocComment(functionNode) {
            const comments = commentGroups.get(functionNode);
            return isNonEmptyArray(comments);
        }
    };
}

function normalizeDocCommentWhitespace(ast) {
    const comments = getCommentArray(ast);

    if (comments.length === 0) {
        return;
    }

    for (const comment of comments) {
        if (
            typeof comment === "object" &&
            comment !== null &&
            "type" in comment &&
            (comment as { type: unknown }).type === "CommentLine" &&
            "leadingWS" in comment &&
            typeof (comment as { leadingWS: unknown }).leadingWS === "string" &&
            /(?:\r\n|\r|\n|\u2028|\u2029)\s*(?:\r\n|\r|\n|\u2028|\u2029)/.test(
                (comment as { leadingWS: string }).leadingWS
            )
        ) {
            (comment as { leadingWS: string }).leadingWS = "\n";
        }
    }
}

function mapDocCommentsToFunctions(ast) {
    const functions = collectFunctionNodes(ast).toSorted((a, b) => {
        const aStart = getNodeStartIndex(a) ?? 0;
        const bStart = getNodeStartIndex(b) ?? 0;
        return aStart - bStart;
    });

    const groups = new Map();
    for (const fn of functions) {
        groups.set(fn, []);
    }

    const astComments = getCommentArray(ast);

    if (astComments.length === 0 || functions.length === 0) {
        return groups;
    }

    let functionIndex = 0;
    for (const comment of astComments) {
        if (!isDocCommentLine(comment)) {
            continue;
        }

        const commentStart =
            typeof comment === "object" && comment !== null && "start" in comment
                ? (comment as { start: unknown }).start
                : null;
        const commentIndex =
            typeof commentStart === "number"
                ? commentStart
                : typeof commentStart === "object" && commentStart !== null && "index" in commentStart
                  ? (commentStart as { index: unknown }).index
                  : null;
        if (typeof commentIndex !== "number") {
            continue;
        }

        while (functionIndex < functions.length) {
            const targetStart = getNodeStartIndex(functions[functionIndex]);
            if (typeof targetStart !== "number" || targetStart > commentIndex) {
                break;
            }
            functionIndex += 1;
        }

        if (functionIndex >= functions.length) {
            break;
        }

        const targetFunction = functions[functionIndex];
        const bucket = groups.get(targetFunction);
        if (bucket) {
            bucket.push(comment);
        }
    }

    return groups;
}

/**
 * Collects all function-like nodes from the given AST.
 *
 * DUPLICATION CHECK: This function performs a manual tree traversal to find function
 * nodes, which appears to overlap with Core.walkObjectGraph. However, there are subtle
 * differences:
 *   - Core.walkObjectGraph is a general-purpose walker that visits all nodes.
 *   - This function is specialized: it only collects nodes that match isFunctionLikeNode,
 *     and it may have doc-comment-specific filtering logic.
 *
 * QUESTION: Can this be replaced by Core.walkObjectGraph with a predicate callback?
 * For example:
 *   const functions = [];
 *   Core.walkObjectGraph(ast, (node) => {
 *       if (isFunctionLikeNode(node)) functions.push(node);
 *   });
 *
 * RECOMMENDATION: If Core.walkObjectGraph supports filtering or callback-based collection,
 * use it to eliminate the duplication. If this traversal has doc-comment-specific
 * requirements (e.g., special handling of comment nodes or metadata), document why it
 * can't use the generic walker and what makes it different.
 */
function collectFunctionNodes(ast) {
    const functions = [];

    function traverse(node) {
        if (!isNode(node)) {
            return;
        }

        if (isFunctionLikeNode(node)) {
            functions.push(node);
        }

        const keys = Object.keys(node);

        for (const key of keys) {
            if (key === "start" || key === "end" || key === "comments") {
                continue;
            }

            const value = node[key];

            if (Array.isArray(value)) {
                // Collect children from a shallow snapshot so visitors that
                // splice the original array (for example transforms pruning
                // siblings during traversal) do not cause us to skip entries.
                const snapshot = value.slice();

                for (const child of snapshot) {
                    traverse(child);
                }
            } else if (isNode(value)) {
                traverse(value);
            }
        }
    }

    traverse(ast);
    return functions;
}

function applyDocCommentUpdates(commentGroups, docUpdates) {
    if (!docUpdates || docUpdates.size === 0) {
        return;
    }

    for (const [fn, update] of docUpdates.entries()) {
        if (!isDocCommentUpdateEligible(update)) {
            continue;
        }

        const comments = resolveDocCommentCollection(commentGroups, fn);
        if (!comments) {
            continue;
        }

        const descriptionComment = findDescriptionComment(comments);
        if (!descriptionComment) {
            continue;
        }

        applyDescriptionCommentUpdate(descriptionComment, update);
    }
}

function isDocCommentUpdateEligible(update) {
    return !!update && !update.hasDocComment && isNonEmptyTrimmedString(update.expression);
}

function resolveDocCommentCollection(commentGroups, fn) {
    const comments = commentGroups.get(fn);
    if (!comments || comments.length === 0) {
        return null;
    }

    return comments;
}

function findDescriptionComment(comments) {
    return (
        comments.find((comment) => typeof comment?.value === "string" && /@description\b/i.test(comment.value)) ?? null
    );
}

function applyDescriptionCommentUpdate(descriptionComment, update) {
    let updatedDescription = buildUpdatedDescription(update.description, update.expression);

    if (!isNonEmptyTrimmedString(updatedDescription)) {
        return;
    }

    const originalDescription = typeof update.description === "string" ? update.description.trim() : "";

    if (originalDescription.endsWith(".") && !/[.!?]$/.test(updatedDescription)) {
        updatedDescription = `${updatedDescription}.`;
    }

    const prefixMatch = descriptionComment.value.match(/^(\s*\/\s*@description\s*)/i);
    const prefix = prefixMatch ? prefixMatch[1] : "/ @description ";

    descriptionComment.value = `${prefix}${updatedDescription}`;
}

function extractFunctionDescription(commentGroups, functionNode) {
    const comments = commentGroups.get(functionNode);
    if (!comments) {
        return null;
    }

    for (const comment of comments) {
        if (typeof comment.value === "string" && comment.value.includes("@description")) {
            return extractDescriptionContent(comment.value);
        }
    }

    return null;
}

function extractDescriptionContent(value) {
    if (typeof value !== "string") {
        return "";
    }

    return value.replace(/^\s*\/\s*@description\s*/i, "").trim();
}

function buildUpdatedDescription(existing, expression) {
    const originalDescription = existing ?? "";

    if (!isNonEmptyTrimmedString(expression)) {
        return originalDescription;
    }

    const normalizedExpression = expression.trim();

    if (!isNonEmptyTrimmedString(existing)) {
        return `Simplified: ${normalizedExpression}`;
    }

    const trimmed = existing.trim();
    const lowered = trimmed.toLowerCase();
    const includes = (needle) => lowered.includes(needle);

    if (includes("original multi-branch") || includes("guard extraction")) {
        return originalDescription;
    }

    if (includes("original") || includes("multi-clause")) {
        return `Simplified: ${normalizedExpression}`;
    }

    if (includes("simplified")) {
        const colonIndex = trimmed.indexOf(":");
        return colonIndex === -1
            ? `Simplified: ${normalizedExpression}`
            : `${trimmed.slice(0, colonIndex + 1)} ${normalizedExpression}`;
    }

    const equalityIndex = trimmed.indexOf("==");
    if (equalityIndex !== -1) {
        const prefix = trimmed.slice(0, equalityIndex + 2).trimEnd();
        return `${prefix} ${normalizedExpression}`;
    }

    const mentionsReturn = /\breturn\b/.test(lowered);
    const mentionsBranching = /\b(?:if|else)\b/.test(lowered);

    if (mentionsReturn && mentionsBranching) {
        return originalDescription;
    }

    const withoutPeriod = trimmed.replace(/\.?\s*$/, "");
    const separator = mentionsReturn ? "; ==" : " ==";
    return `${withoutPeriod}${separator} ${normalizedExpression}`;
}
