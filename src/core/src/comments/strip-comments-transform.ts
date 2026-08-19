/**
 * Provides a configurable transform that can remove comments or JSDoc before formatting/printing.
 * Shared between the lint and plugin pipelines so both use the same canonical implementation.
 */
import { walkObjectGraph } from "../ast/object-graph.js";
import type { MutableGameMakerAstNode } from "../ast/types.js";
import { createParserTransform } from "../transforms/parser-transform.js";
import { isObjectLike } from "../utils/object.js";
import { isCommentNode } from "./comment-utils.js";

export type StripCommentsTransformOptions = {
    stripComments: boolean;
    stripJsDoc: boolean;
    dropCommentedOutCode: boolean;
};

const JS_DOC_KEYS = ["doc", "docComment", "jsdoc"] as const;

/**
 * Deletes each of `keys` from `value` when present, in place.
 */
function deleteOwnKeys(value: MutableGameMakerAstNode, keys: readonly string[]): void {
    for (const key of keys) {
        if (Object.hasOwn(value, key)) {
            delete value[key];
        }
    }
}

/**
 * Filters comment nodes out of a non-root `comments` array, deleting the
 * property entirely when nothing is left. Root-level comments are handled
 * separately after the walk (see `execute`) so `ast.comments` is always a
 * defined array, even when empty—tests and downstream consumers rely on that.
 */
function stripNestedComments(value: MutableGameMakerAstNode): void {
    const comments = value.comments;
    if (!Array.isArray(comments)) {
        return;
    }

    const filtered = comments.filter((c) => !isCommentNode(c));
    if (filtered.length === 0) {
        delete value.comments;
    } else {
        value.comments = filtered;
    }
}

/**
 * Removes comment nodes and related metadata according to the caller's options.
 */
function execute(ast: MutableGameMakerAstNode, options: StripCommentsTransformOptions): MutableGameMakerAstNode {
    // Walk the AST and drop comment-related properties as requested by the options.
    if (!isObjectLike(ast)) {
        return ast;
    }

    walkObjectGraph(ast, {
        enterObject(value) {
            if (!isObjectLike(value)) {
                return;
            }

            if (options.stripComments) {
                if (value !== ast) {
                    stripNestedComments(value);
                }

                if (Array.isArray(value.docComments)) {
                    delete value.docComments;
                }
            }

            if (options.stripJsDoc) {
                deleteOwnKeys(value, JS_DOC_KEYS);
            }

            return true;
        }
    });

    // Process root-level comments last. Filter out comment nodes but preserve
    // any non-comment entries (e.g., annotations). Always assign back to
    // `ast.comments` so downstream code finds a defined array.
    if (options.stripComments && Array.isArray(ast.comments)) {
        ast.comments = (ast.comments as unknown[]).filter((c) => !isCommentNode(c));
    }

    return ast;
}

/**
 * Transform that strips comments, JSDoc annotations, or both from a GML AST.
 * Used by both the lint and plugin pipelines before further processing.
 */
export const stripCommentsTransform = createParserTransform<StripCommentsTransformOptions>(
    "strip-comments",
    {
        stripComments: true,
        stripJsDoc: true,
        dropCommentedOutCode: false
    },
    execute
);
