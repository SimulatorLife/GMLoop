import { shouldSkipTraversal } from "../../ast/index.js";
import { isEmptyRecord, isObjectLike, isSetLike } from "../../utils/index.js";

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

    return isEmptyRecord(metadata) ? null : metadata;
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

/**
 * Copy doc-comment metadata flags from a source array to a target array.
 *
 * These flags control formatting behavior for doc comment arrays and should
 * be preserved when arrays are cloned or transformed. The helper lives beside
 * node metadata because both APIs manage doc-comment-only metadata rather than
 * generic array behavior.
 *
 * @param source - Source array that may contain doc comment flags.
 * @param target - Target array to receive the flags.
 * @returns The target array for chaining.
 */
export function copyDocCommentArrayFlags<T>(source: Array<T>, target: Array<T>): Array<T> {
    if (!Array.isArray(source) || !Array.isArray(target)) {
        return target;
    }

    const sourceFlags = source as Array<T> & {
        _preserveDescriptionBreaks?: boolean;
        _suppressLeadingBlank?: boolean;
        _blockCommentDocs?: boolean;
    };
    const targetFlags = target as Array<T> & {
        _preserveDescriptionBreaks?: boolean;
        _suppressLeadingBlank?: boolean;
        _blockCommentDocs?: boolean;
    };

    if (sourceFlags._preserveDescriptionBreaks === true) {
        targetFlags._preserveDescriptionBreaks = true;
    }
    if (sourceFlags._suppressLeadingBlank === true) {
        targetFlags._suppressLeadingBlank = true;
    }
    if (sourceFlags._blockCommentDocs === true) {
        targetFlags._blockCommentDocs = true;
    }

    return target;
}
