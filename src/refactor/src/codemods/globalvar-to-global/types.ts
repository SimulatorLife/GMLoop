/**
 * Types for the globalvar-to-global codemod.
 *
 * The codemod removes legacy `globalvar` declarations and rewrites all bare
 * identifier references to those declared names with `global.<name>` access
 * expressions, producing semantically equivalent code that uses the modern
 * `global.*` style mandated by the GML style guide.
 */

/**
 * A single text edit produced by the globalvar-to-global codemod.
 */
export type GlobalvarToGlobalEdit = Readonly<{
    /** Inclusive start offset in the source text. */
    start: number;
    /** Exclusive end offset in the source text. */
    end: number;
    /** Replacement text for the region [start, end). */
    text: string;
}>;

/**
 * Per-file result returned by `applyGlobalvarToGlobalCodemod`.
 */
export type GlobalvarToGlobalResult = Readonly<{
    /** Whether any edits were applied. */
    changed: boolean;
    /** The transformed source text (equals the input when `changed` is false). */
    outputText: string;
    /** All edits applied in the order they were generated (not necessarily sorted). */
    appliedEdits: ReadonlyArray<GlobalvarToGlobalEdit>;
    /**
     * The globalvar variable names that were migrated.
     * Empty when no globalvar declarations were found.
     */
    migratedNames: ReadonlyArray<string>;
}>;

/**
 * Options for the globalvar-to-global codemod.
 *
 * All options are optional; omitting them is equivalent to passing `{}`.
 */
export type GlobalvarToGlobalCodemodOptions = Readonly<{
    /**
     * Variable names to exclude from migration.
     *
     * When specified, `globalvar` declarations for these names are still removed
     * but their bare identifier references are left as-is.  This is useful when
     * a legacy compatibility layer already handles a specific global name and you
     * only want to migrate the remaining ones.
     *
     * Defaults to an empty array (all declared names are migrated).
     */
    excludeNames?: ReadonlyArray<string>;
}>;
