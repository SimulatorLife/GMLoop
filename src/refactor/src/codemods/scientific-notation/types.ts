/**
 * Types for the scientific-notation codemod.
 */

/**
 * A single text edit produced by the scientific-notation codemod.
 */
export type ScientificNotationEdit = Readonly<{
    /** Inclusive start offset in the source text. */
    start: number;
    /** Exclusive end offset in the source text. */
    end: number;
    /** Replacement text for the region [start, end). */
    text: string;
}>;

/**
 * Per-file result returned by `applyScientificNotationCodemod`.
 */
export type ScientificNotationResult = Readonly<{
    changed: boolean;
    outputText: string;
    appliedEdits: ReadonlyArray<ScientificNotationEdit>;
}>;

/**
 * Options for the scientific-notation codemod.
 *
 * No options are currently supported.
 */
export type ScientificNotationCodemodOptions = Readonly<Record<string, never>>;
