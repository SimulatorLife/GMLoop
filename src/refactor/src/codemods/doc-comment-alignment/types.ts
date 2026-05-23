/**
 * Types for the doc-comment-alignment codemod.
 */

/**
 * A single text edit produced by the doc-comment-alignment codemod.
 */
export type DocCommentAlignmentEdit = Readonly<{
    start: number;
    end: number;
    text: string;
}>;

/**
 * Per-file result returned by `applyDocCommentAlignmentCodemod`.
 */
export type DocCommentAlignmentResult = Readonly<{
    changed: boolean;
    outputText: string;
    appliedEdits: ReadonlyArray<DocCommentAlignmentEdit>;
}>;

/**
 * Options for the doc-comment-alignment codemod.
 *
 * No options are currently supported.
 */
export type DocCommentAlignmentCodemodOptions = Readonly<Record<string, never>>;
