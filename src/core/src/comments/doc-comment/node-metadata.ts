import { shouldSkipTraversal } from "../../ast/index.js";
import { isObjectLike, isSetLike } from "../../utils/index.js";

/**
 * Metadata stored on an AST node related to its doc comments.
 */
export type DocCommentNodeMetadata = {
    documentedParamNames?: ReadonlySet<string>;
    hasDeprecatedDocComment?: boolean;
};

const DOC_COMMENT_METADATA_KEY = Symbol("gmlDocCommentMetadata");

export function getDocCommentNodeMetadata(node: unknown): DocCommentNodeMetadata | null {
    if (shouldSkipTraversal(node)) {
        return null;
    }

    const payload = Reflect.get(node as object, DOC_COMMENT_METADATA_KEY);

    if (!isObjectLike(payload)) {
        return null;
    }

    const { documentedParamNames, hasDeprecatedDocComment } = payload as {
        documentedParamNames?: ReadonlySet<string>;
        hasDeprecatedDocComment?: boolean;
    };

    const metadata: DocCommentNodeMetadata = {};

    if (isSetLike(documentedParamNames) && documentedParamNames.size > 0) {
        metadata.documentedParamNames = documentedParamNames;
    }

    if (hasDeprecatedDocComment) {
        metadata.hasDeprecatedDocComment = true;
    }

    return Object.keys(metadata).length === 0 ? null : metadata;
}

export function setDocCommentNodeMetadata(node: unknown, payload: DocCommentNodeMetadata | null) {
    if (shouldSkipTraversal(node)) {
        return;
    }

    if (!payload) {
        Reflect.deleteProperty(node as object, DOC_COMMENT_METADATA_KEY);
        return;
    }

    Reflect.set(node as object, DOC_COMMENT_METADATA_KEY, payload);
}
