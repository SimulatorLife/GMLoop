/**
 * Shared codemod types used across all built-in codemods.
 *
 * These types describe edits, results, and options for simple text-manipulation
 * codemods that operate on source text. Each codemod defines its own Edit and
 * Result types using this shared shape; option types vary per-codemod.
 */

/**
 * A single text edit in source-text coordinates.
 */
/**
 * Core types and interfaces for the refactor engine.
 * Defines symbols, occurrences, conflicts, dependencies, and validation contracts
 * that coordinate semantic analysis, transpiler integration, and safe renaming.
 */

import { Core } from "@gmloop/core";

export type CodemodEdit = Readonly<{
    /** Inclusive start offset in the source text. */
    start: number;
    /** Exclusive end offset in the source text. */
    end: number;
    /** Replacement text for the region [start, end). */
    text: string;
}>;

/**
 * Base result returned by most simple source-text codemods.
 *
 * All codemods follow this shape: they report whether anything changed,
 * return the (potentially transformed) source text, and list the edits
 * that were applied.
 */
export type CodemodResult = Readonly<{
    /** Whether the source text changed. */
    changed: boolean;
    /** Transformed source text, or the original text when unchanged. */
    outputText: string;
    /** Edits applied to create the transformed text. */
    appliedEdits: ReadonlyArray<CodemodEdit>;
}>;

/**
 * Options for the doc-comment-alignment codemod.
 *
 * No options are currently supported.
 */
export type DocCommentAlignmentCodemodOptions = Readonly<Record<string, never>>;

/**
 * A single text edit produced by the doc-comment-alignment codemod.
 */
export type DocCommentAlignmentEdit = CodemodEdit;

/**
 * Per-file result returned by `applyDocCommentAlignmentCodemod`.
 */
export type DocCommentAlignmentResult = CodemodResult;

/**
 * A single edit produced by the loop-length hoisting codemod.
 */
export type LoopLengthHoistingEdit = CodemodEdit;

/**
 * Result payload returned by the loop-length hoisting codemod.
 */
export type LoopLengthHoistingResult = CodemodResult;

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

/**
 * Per-file result returned by `applyGlobalvarToGlobalCodemod`.
 */
export type GlobalvarToGlobalResult = Readonly<{
    /** Whether any edits were applied. */
    changed: boolean;
    /** The transformed source text (equals the input when `changed` is false). */
    outputText: string;
    /** All edits applied in the order they were generated (not necessarily sorted). */
    appliedEdits: ReadonlyArray<CodemodEdit>;
    /**
     * The globalvar variable names that were migrated.
     * Empty when no globalvar declarations were found.
     */
    migratedNames: ReadonlyArray<string>;
}>;

/**
 * Options for the loop-length hoisting codemod.
 */
export type LoopLengthHoistingCodemodOptions = Readonly<Record<string, never>>;

/**
 * Options for the scientific-notation codemod.
 *
 * No options are currently supported.
 */
export type ScientificNotationCodemodOptions = Readonly<Record<string, never>>;

/**
 * A single text edit produced by the scientific-notation codemod.
 */
export type ScientificNotationEdit = CodemodEdit;

/**
 * Per-file result returned by `applyScientificNotationCodemod`.
 */
export type ScientificNotationResult = CodemodResult;

/**
 * A single text edit produced by the globalvar-to-global codemod.
 * Alias for the shared CodemodEdit shape.
 */
export type GlobalvarToGlobalEdit = CodemodEdit;

export type MaybePromise<T> = T | Promise<T>;

export type Range = { start: number; end: number };

const { createEnumeratedOptionHelpers } = Core;

/**
 * Allowed naming case styles for naming-convention policy rules.
 */
export type NamingCaseStyle = "lower" | "upper" | "camel" | "lower_snake" | "upper_snake" | "pascal";

/**
 * Category keys that can be targeted by naming-convention policy rules.
 */
export type NamingCategory =
    | "resource"
    | "scriptResourceName"
    | "objectResourceName"
    | "roomResourceName"
    | "spriteResourceName"
    | "audioResourceName"
    | "timelineResourceName"
    | "shaderResourceName"
    | "fontResourceName"
    | "pathResourceName"
    | "animationCurveResourceName"
    | "sequenceResourceName"
    | "tilesetResourceName"
    | "particleSystemResourceName"
    | "noteResourceName"
    | "extensionResourceName"
    | "variable"
    | "localVariable"
    | "globalVariable"
    | "instanceVariable"
    | "staticVariable"
    | "argument"
    | "catchArgument"
    | "loopIndexVariable"
    | "callable"
    | "function"
    | "constructorFunction"
    | "typeName"
    | "structDeclaration"
    | "enum"
    | "member"
    | "enumMember"
    | "constant"
    | "macro";

/**
 * Raw user-authored rule options for a single naming category.
 */
export interface NamingRuleConfig {
    caseStyle?: NamingCaseStyle;
    prefix?: string;
    suffix?: string;
    minChars?: number;
    maxChars?: number;
    bannedPrefixes?: Array<string>;
    bannedSuffixes?: Array<string>;
}

/**
 * User-authored naming policy consumed by rename validation and planning.
 */
export interface NamingConventionPolicy {
    rules: Partial<Record<NamingCategory, NamingRuleConfig | false>>;
    exclusivePrefixes?: Record<string, NamingCategory>;
    exclusiveSuffixes?: Record<string, NamingCategory>;
}

/**
 * Stable identifiers for codemods exposed through project configuration and the CLI.
 */
export type RefactorCodemodId =
    | "docCommentAlignment"
    | "scientificNotation"
    | "globalvarToGlobal"
    | "loopLengthHoisting"
    | "namingConvention";

/**
 * Normalized config payloads keyed by registered codemod id.
 */
export interface RefactorCodemodConfigMap {
    docCommentAlignment: DocCommentAlignmentCodemodOptions;
    scientificNotation: ScientificNotationCodemodOptions;
    globalvarToGlobal: GlobalvarToGlobalCodemodOptions;
    loopLengthHoisting: LoopLengthHoistingCodemodOptions;
    namingConvention: NamingConventionPolicy;
}

/**
 * Config payload for a single registered codemod.
 */
export type RefactorCodemodConfigEntry<T extends RefactorCodemodId = RefactorCodemodId> =
    | RefactorCodemodConfigMap[T]
    | false;

/**
 * Refactor-specific configuration loaded from the `refactor` section of `gmloop.json`.
 */
export interface RefactorProjectConfig {
    codemods?: Partial<{ [K in RefactorCodemodId]: RefactorCodemodConfigEntry<K> }>;
}

/**
 * Normalized rule values after inheritance/default resolution for a category.
 */
export interface ResolvedNamingRule {
    prefix: string;
    suffix: string;
    caseStyle: NamingCaseStyle;
    minChars: number | null;
    maxChars: number | null;
    bannedPrefixes: ReadonlyArray<string>;
    bannedSuffixes: ReadonlyArray<string>;
}

/**
 * Resolved rule map keyed by naming category.
 */
export type ResolvedNamingConventionRules = Partial<Record<NamingCategory, ResolvedNamingRule>>;

/**
 * Create type-safe enum validators with case-sensitive matching.
 * Adapts Core's createEnumeratedOptionHelpers for strict enum validation.
 *
 * @param enumObj - Enum object with string values
 * @param typeName - Human-readable name for error messages
 * @returns Helper object with is, parse, and require methods
 */
function createEnumHelpers<T extends Record<string, string>>(enumObj: T, typeName: string) {
    type EnumValue = T[keyof T];
    const values = Object.values(enumObj);
    const validValues = values.join(", ");
    const formatInvalidEnumMessage = (value: unknown, context?: string): string => {
        const contextInfo = context ? ` (in ${context})` : "";
        return `Invalid ${typeName}: ${JSON.stringify(value)}${contextInfo}. Must be one of: ${validValues}.`;
    };

    const coreHelpers = createEnumeratedOptionHelpers(values, {
        caseSensitive: true,
        enforceStringType: false // We'll handle type enforcement manually for better error messages
    });

    return {
        is: (value: unknown): value is EnumValue => {
            return typeof value === "string" && coreHelpers.normalize(value) !== null;
        },
        parse: (value: unknown): EnumValue | null => {
            return coreHelpers.normalize(value) as EnumValue | null;
        },
        require: (value: unknown, context?: string): EnumValue => {
            const normalized = typeof value === "string" ? coreHelpers.normalize(value) : null;
            if (normalized === null) {
                throw new TypeError(formatInvalidEnumMessage(value, context));
            }
            return normalized as EnumValue;
        }
    };
}

/**
 * Enumerated constants for GML symbol kinds.
 *
 * Symbol IDs follow the pattern `gml/{kind}/{name}`, where `kind` identifies
 * the semantic category of the symbol. This enum centralizes valid symbol
 * kinds to prevent stringly-typed branches and provides a single source of
 * truth for validation.
 *
 * @example
 * // Use typed constants instead of raw strings
 * if (symbolKind === SymbolKind.SCRIPT) { ... }
 *
 * // Validate runtime strings
 * const kind = parseSymbolKind(rawInput);
 */
export const SymbolKind = Object.freeze({
    SCRIPT: "script",
    VAR: "var",
    EVENT: "event",
    MACRO: "macro",
    ENUM: "enum"
} as const);

export type SymbolKindValue = (typeof SymbolKind)[keyof typeof SymbolKind];

const symbolKindHelpers = createEnumHelpers(SymbolKind, "symbol kind");

/**
 * Check whether a value is a valid symbol kind.
 *
 * @param value - Candidate value to test
 * @returns True if value matches a known SymbolKind constant
 *
 * @example
 * if (isSymbolKind(rawString)) {
 *   // Safe to use as SymbolKindValue
 * }
 */
export function isSymbolKind(value: unknown): value is SymbolKindValue {
    return symbolKindHelpers.is(value);
}

/**
 * Parse and validate a symbol kind string.
 *
 * @param value - Raw string to parse
 * @returns Valid SymbolKindValue or null if invalid
 *
 * @example
 * const kind = parseSymbolKind(symbolParts[1]);
 * if (kind === null) {
 *   // Handle invalid kind
 * }
 */
export function parseSymbolKind(value: unknown): SymbolKindValue | null {
    return symbolKindHelpers.parse(value);
}

/**
 * Parse and validate a symbol kind string, throwing on invalid input.
 *
 * @param value - Raw string to parse
 * @param context - Optional context for error message
 * @returns Valid SymbolKindValue
 * @throws {TypeError} If value is not a valid symbol kind
 *
 * @example
 * const kind = requireSymbolKind(symbolParts[1], symbolId);
 */
export function requireSymbolKind(value: unknown, context?: string): SymbolKindValue {
    return symbolKindHelpers.require(value, context);
}

/**
 * Enumerated constants for refactoring conflict types.
 *
 * Conflicts represent issues detected during rename validation that would
 * break semantics or cause ambiguity. This enum centralizes valid conflict
 * types to prevent stringly-typed branches and provides a single source of
 * truth for validation.
 *
 * @example
 * // Use typed constants instead of raw strings
 * if (conflict.type === ConflictType.RESERVED) { ... }
 *
 * // Validate runtime strings
 * const type = parseConflictType(rawInput);
 */
export const ConflictType = Object.freeze({
    INVALID_IDENTIFIER: "invalid_identifier",
    SHADOW: "shadow",
    RESERVED: "reserved",
    MISSING_SYMBOL: "missing_symbol",
    LARGE_RENAME: "large_rename",
    MANY_DEPENDENTS: "many_dependents",
    ANALYSIS_ERROR: "analysis_error"
} as const);

export type ConflictTypeValue = (typeof ConflictType)[keyof typeof ConflictType];

const conflictTypeHelpers = createEnumHelpers(ConflictType, "conflict type");

/**
 * Check whether a value is a valid conflict type.
 *
 * @param value - Candidate value to test
 * @returns True if value matches a known ConflictType constant
 *
 * @example
 * if (isConflictType(rawString)) {
 *   // Safe to use as ConflictTypeValue
 * }
 */
export function isConflictType(value: unknown): value is ConflictTypeValue {
    return conflictTypeHelpers.is(value);
}

/**
 * Parse and validate a conflict type string.
 *
 * @param value - Raw string to parse
 * @returns Valid ConflictTypeValue or null if invalid
 *
 * @example
 * const type = parseConflictType(rawInput);
 * if (type === null) {
 *   // Handle invalid type
 * }
 */
export function parseConflictType(value: unknown): ConflictTypeValue | null {
    return conflictTypeHelpers.parse(value);
}

/**
 * Parse and validate a conflict type string, throwing on invalid input.
 *
 * @param value - Raw string to parse
 * @param context - Optional context for error message
 * @returns Valid ConflictTypeValue
 * @throws {TypeError} If value is not a valid conflict type
 *
 * @example
 * const type = requireConflictType(conflict.type, "validation");
 */
export function requireConflictType(value: unknown, context?: string): ConflictTypeValue {
    return conflictTypeHelpers.require(value, context);
}

/**
 * Enumerated constants for symbol occurrence kinds.
 *
 * Occurrence kinds distinguish between definitions (where symbols are declared)
 * and references (where symbols are used). This enum centralizes valid occurrence
 * kinds to prevent stringly-typed branches and provides a single source of truth
 * for validation.
 *
 * @example
 * // Use typed constants instead of raw strings
 * if (occurrence.kind === OccurrenceKind.DEFINITION) { ... }
 *
 * // Validate runtime strings
 * const kind = parseOccurrenceKind(rawInput);
 */
export const OccurrenceKind = Object.freeze({
    DEFINITION: "definition",
    REFERENCE: "reference"
} as const);

export type OccurrenceKindValue = (typeof OccurrenceKind)[keyof typeof OccurrenceKind];

const occurrenceKindHelpers = createEnumHelpers(OccurrenceKind, "occurrence kind");

/**
 * Check whether a value is a valid occurrence kind.
 *
 * @param value - Candidate value to test
 * @returns True if value matches a known OccurrenceKind constant
 *
 * @example
 * if (isOccurrenceKind(rawString)) {
 *   // Safe to use as OccurrenceKindValue
 * }
 */
export function isOccurrenceKind(value: unknown): value is OccurrenceKindValue {
    return occurrenceKindHelpers.is(value);
}

/**
 * Parse and validate an occurrence kind string.
 *
 * @param value - Raw string to parse
 * @returns Valid OccurrenceKindValue or null if invalid
 *
 * @example
 * const kind = parseOccurrenceKind(occ.kind);
 * if (kind === null) {
 *   // Handle invalid kind
 * }
 */
export function parseOccurrenceKind(value: unknown): OccurrenceKindValue | null {
    return occurrenceKindHelpers.parse(value);
}

/**
 * Parse and validate an occurrence kind string, throwing on invalid input.
 *
 * @param value - Raw string to parse
 * @param context - Optional context for error message
 * @returns Valid OccurrenceKindValue
 * @throws {TypeError} If value is not a valid occurrence kind
 *
 * @example
 * const kind = requireOccurrenceKind(occ.kind, "occurrence analysis");
 */
export function requireOccurrenceKind(value: unknown, context?: string): OccurrenceKindValue {
    return occurrenceKindHelpers.require(value, context);
}

export * from "./types/index.js";
