/**
 * A single loop-length hoisting edit in source-text coordinates.
 */
export type LoopLengthHoistingEdit = Readonly<{
    /** Zero-based inclusive start offset. */
    start: number;
    /** Zero-based exclusive end offset. */
    end: number;
    /** Replacement text for the edit range. */
    text: string;
}>;

/**
 * Result payload returned by the loop-length hoisting codemod.
 */
export type LoopLengthHoistingResult = Readonly<{
    /** Whether the source text changed. */
    changed: boolean;
    /** Transformed source text, or the original text when unchanged. */
    outputText: string;
    /** Edits applied to create the transformed text. */
    appliedEdits: ReadonlyArray<LoopLengthHoistingEdit>;
}>;

/**
 * Options for the loop-length hoisting codemod.
 */
export type LoopLengthHoistingCodemodOptions = Readonly<Record<string, never>>;
