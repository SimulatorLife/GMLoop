/**
 * Types for the with-self-unwrap codemod.
 *
 * The codemod removes redundant `with (self) { ... }` statements by inlining
 * the body block at the surrounding indentation level, producing semantically
 * equivalent code without the unnecessary `with` wrapper.
 *
 * Safety constraints applied before transformation:
 *  - The body must not reference the `other` built-in identifier.  Inside a
 *    `with` block `other` refers to the calling instance; outside it the
 *    binding is different, so its presence changes semantics.
 *  - The body must not contain unguarded `break` or `continue` statements.
 *    Inside `with (self)` those keywords target the (single-iteration) `with`
 *    loop; removing the wrapper would redirect them to any enclosing loop or
 *    switch, changing control flow.
 *
 * Only block-statement bodies (`with (self) { ... }`) are transformed;
 * single-expression bodies (`with (self) statement;`) are left unchanged.
 */

/**
 * A single text replacement produced by the with-self-unwrap codemod.
 */
export type WithSelfUnwrapEdit = Readonly<{
    /** Inclusive start offset in the source text. */
    start: number;
    /** Exclusive end offset in the source text. */
    end: number;
    /** Replacement text for the region [start, end). */
    text: string;
}>;

/**
 * Per-file result returned by `applyWithSelfUnwrapCodemod`.
 */
export type WithSelfUnwrapResult = Readonly<{
    /** Whether any edits were applied. */
    changed: boolean;
    /** The transformed source text (equals the input when `changed` is false). */
    outputText: string;
    /** All edits applied in ascending offset order. */
    appliedEdits: ReadonlyArray<WithSelfUnwrapEdit>;
    /** Number of `with (self)` blocks that were unwrapped. */
    unwrappedCount: number;
}>;

/**
 * Options for the with-self-unwrap codemod.
 *
 * No options are currently defined; the type is provided for forward
 * compatibility with the registered-codemod config pipeline.
 */
export type WithSelfUnwrapCodemodOptions = Readonly<Record<string, never>>;
