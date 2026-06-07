import { Core } from "@gmloop/core";

import { getCommentEndIndex, isWhitespaceBetween } from "./documented-params.js";
import { resolveDocCommentTraversalService } from "./manager.js";

const { getBodyStatements, getNodeName, getNodeStartIndex, isLineComment, isNode } = Core;

type CandidateCommentNode = {
    value?: string;
};

type DocCommentTraversalService = {
    forEach(callback: (node: unknown, comments?: readonly CandidateCommentNode[] | null) => void): void;
};

/**
 * Collects the names of top-level functions annotated with `@deprecated` so
 * downstream consumers can treat them specially without re-traversing the AST.
 */
export function collectDeprecatedFunctionNames(
    ast: unknown,
    sourceText?: string | null,
    docCommentTraversal?: DocCommentTraversalService | null
): Set<string> {
    const names = new Set<string>();

    if (typeof sourceText !== "string" || sourceText.length === 0) {
        return names;
    }

    if (!isNode(ast)) {
        return names;
    }

    const bodyStatements = getBodyStatements(ast);
    if (bodyStatements.length === 0) {
        return names;
    }

    const topLevelFunctions = new Set(
        bodyStatements.filter((node) => isNode(node) && node.type === "FunctionDeclaration")
    );

    if (topLevelFunctions.size === 0) {
        return names;
    }

    const traversal: DocCommentTraversalService = docCommentTraversal ?? resolveDocCommentTraversalService(ast);

    traversal.forEach((node, comments) => {
        if (!topLevelFunctions.has(node)) {
            return;
        }

        const startIndex = getNodeStartIndex(node);
        if (typeof startIndex !== "number") {
            return;
        }

        const deprecatedComment = findDeprecatedDocComment(comments ?? [], startIndex, sourceText);

        if (!deprecatedComment) {
            return;
        }

        const identifier = getNodeName(node);

        if (identifier) {
            names.add(identifier);
        }
    });

    return names;
}

/**
 * Finds the final deprecated doc comment preceding a function so consumers can
 * inspect it without replicating traversal logic.
 */
export function findDeprecatedDocComment(
    docComments: readonly CandidateCommentNode[],
    functionStart: number,
    sourceText: string
): CandidateCommentNode | null {
    for (let index = docComments.length - 1; index >= 0; index -= 1) {
        const comment = docComments[index];

        if (!isDeprecatedComment(comment)) {
            continue;
        }

        const commentEnd = getCommentEndIndex(comment);

        if (typeof commentEnd !== "number" || commentEnd >= functionStart) {
            continue;
        }

        if (!isWhitespaceBetween(commentEnd + 1, functionStart, sourceText)) {
            continue;
        }

        return comment;
    }

    return null;
}

function isDeprecatedComment(comment: CandidateCommentNode) {
    if (!isLineComment(comment)) {
        return false;
    }

    const value = (comment as { value?: unknown })?.value;
    if (typeof value !== "string") {
        return false;
    }

    return /@deprecated\b/i.test(value);
}
