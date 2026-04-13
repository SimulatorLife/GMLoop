import { isObjectLike, isSetLike, shouldSkipTraversal } from "./utils.js";

/**
 * Metadata stored on an AST node related to its doc comments.
 */
export type DocCommentNodeMetadata = {
    documentedParamNames?: ReadonlySet<string>;
    hasDeprecatedDocComment?: boolean;
};

const DOC_COMMENT_METADATA_KEY = Symbol("gmlDocCommentMetadata");
const DOC_COMMENT_DEPRECATED_SET_KEY = Symbol("gmlDocCommentDeprecatedFunctionNames");

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

export function setDeprecatedDocCommentFunctionSet(ast: unknown, functions: Set<string> | null) {
    if (!isObjectLike(ast)) {
        return;
    }

    if (functions === null || functions.size === 0) {
        Reflect.deleteProperty(ast as object, DOC_COMMENT_DEPRECATED_SET_KEY);
        return;
    }

    Reflect.set(ast as object, DOC_COMMENT_DEPRECATED_SET_KEY, functions);
}

export function getDeprecatedDocCommentFunctionSet(ast: unknown): ReadonlySet<string> | null {
    if (!isObjectLike(ast)) {
        return null;
    }

    const functions = Reflect.get(ast as object, DOC_COMMENT_DEPRECATED_SET_KEY);

    if (isSetLike(functions)) {
        // The set was stored by setDeprecatedDocCommentFunctionSet which accepts
        // Set<string>, so the contained values are guaranteed to be strings.
        return functions as ReadonlySet<string>;
    }

    return null;
}
