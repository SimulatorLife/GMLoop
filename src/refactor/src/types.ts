/**
 * Core types and interfaces for the refactor engine.
 * Defines symbols, occurrences, conflicts, dependencies, and validation contracts
 * that coordinate semantic analysis, transpiler integration, and safe renaming.
 */

import { Core } from "@gmloop/core";

import type { StorageBackend } from "./backends/storage-backend.js";
import type { GlobalvarToGlobalCodemodOptions } from "./codemods/globalvar-to-global/types.js";
import type { LoopLengthHoistingCodemodOptions } from "./codemods/loop-length-hoisting/types.js";
import type { FileRename, WorkspaceEdit } from "./workspace-edit.js";

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
export type RefactorCodemodId = "globalvarToGlobal" | "loopLengthHoisting" | "namingConvention";

/**
 * Normalized config payloads keyed by registered codemod id.
 */
export interface RefactorCodemodConfigMap {
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

export interface AstNode {
    type?: string;
    name?: string;
    start: number;
    end: number;
    children?: Array<AstNode>;
}

export interface SymbolLocation {
    symbolId: string;
    name: string;
    range: Range;
}

export interface SymbolOccurrence {
    path: string;
    start: number;
    end: number;
    scopeId?: string;
    kind?: OccurrenceKindValue;
}

export interface SymbolLookupResult {
    name: string;
}

export interface FileSymbol {
    id: string;
}

export interface DependentSymbol {
    symbolId: string;
    filePath: string;
}

export interface ParserBridge {
    parse(filePath: string): MaybePromise<AstNode>;
}

export interface SemanticValidationResult {
    errors?: Array<string>;
    warnings?: Array<string>;
}

/**
 * Symbol existence and lookup operations.
 *
 * Provides the ability to check whether symbols exist and perform
 * scope-aware name lookups without coupling to occurrence tracking,
 * dependency analysis, or file-level operations.
 */
export interface SymbolResolver {
    hasSymbol(symbolId: string): MaybePromise<boolean>;
    resolveSymbolId(name: string): MaybePromise<string | null | undefined>;
    lookup(name: string, scopeId?: string): MaybePromise<SymbolLookupResult | null | undefined>;
    getSymbolAtPosition(filePath: string, offset: number): MaybePromise<SymbolLocation | null | undefined>;
}

/**
 * Symbol occurrence tracking.
 *
 * Provides the ability to find all occurrences (definitions and references)
 * of a symbol across the project without coupling to validation, dependency
 * analysis, or other semantic operations.
 */
export interface OccurrenceTracker {
    getSymbolOccurrences(symbolName: string, symbolId?: string | null): MaybePromise<Array<SymbolOccurrence>>;
    getAdditionalSymbolEdits?(symbolId: string, newName: string): MaybePromise<WorkspaceEdit | null>;
}

/**
 * File-level symbol operations.
 *
 * Provides the ability to query symbols defined in specific files
 * without coupling to cross-file dependency analysis or validation.
 */
export interface FileSymbolProvider {
    getFileSymbols(filePath: string): MaybePromise<Array<FileSymbol>>;
}

/**
 * Symbol dependency analysis.
 *
 * Provides the ability to track which symbols depend on other symbols,
 * essential for hot reload and impact analysis without coupling to
 * occurrence tracking or validation operations.
 */
export interface DependencyAnalyzer {
    getDependents(symbolIds: Array<string>): MaybePromise<Array<DependentSymbol>>;
}

/**
 * Language keyword information.
 *
 * Provides access to reserved keywords for the language without
 * coupling to symbol resolution or other semantic operations.
 */
export interface KeywordProvider {
    getReservedKeywords(): MaybePromise<Array<string>>;
}

/**
 * Semantic adapter surface used by naming-convention codemods to enumerate
 * renameable identifiers and resources.
 */
export interface NamingConventionTargetProvider {
    listNamingConventionTargets(
        filePaths?: Array<string>,
        categories?: ReadonlyArray<NamingCategory>
    ): MaybePromise<Array<NamingConventionTarget>>;
}

/**
 * Describes caller-scoped identifiers that a referenced macro expansion reads
 * from a specific consumer file.
 *
 * Naming-convention codemods use this to avoid renaming locals or parameters
 * that a bare macro invocation expects to find unchanged at expansion time.
 */
export interface MacroExpansionDependency {
    path: string;
    macroName: string;
    referencedNames: Array<string>;
}

/**
 * Semantic adapter surface for macro-expansion-aware rename planning.
 *
 * Provides macro-to-consumer dependency data so local renames can skip
 * identifiers that would break preprocessor-expanded code even when the raw
 * source still parses successfully.
 */
export interface MacroExpansionDependencyProvider {
    listMacroExpansionDependencies(filePaths?: Array<string>): MaybePromise<Array<MacroExpansionDependency>>;
}

/**
 * Workspace edit validation.
 *
 * Provides semantic validation of workspace edits to detect conflicts
 * and issues before applying changes, without coupling to symbol queries
 * or dependency analysis.
 */
export interface EditValidator {
    validateEdits(workspace: WorkspaceEdit): MaybePromise<SemanticValidationResult>;
}

/**
 * Allows semantic adapters to observe progressively merged workspace edits while
 * a batch rename plan is being assembled.
 *
 * Implementations can use this to stage metadata rewrites or other derived state
 * so subsequent rename plans see the already-planned batch changes rather than a
 * stale on-disk snapshot.
 */
export interface BatchWorkspaceOverlay {
    clearWorkspaceOverlay(): MaybePromise<void>;
    stageWorkspaceEdit(workspace: WorkspaceEdit): MaybePromise<void>;
}

/**
 * Complete semantic analyzer interface.
 *
 * Combines all role-focused interfaces for consumers that need full
 * semantic analysis capabilities. All methods are required when implementing
 * this interface. For partial implementations, use PartialSemanticAnalyzer.
 *
 * Consumers should prefer depending on the minimal interface they need
 * (SymbolResolver, OccurrenceTracker, etc.) rather than this composite
 * interface when possible.
 */
export interface SemanticAnalyzer
    extends SymbolResolver,
        OccurrenceTracker,
        FileSymbolProvider,
        DependencyAnalyzer,
        KeywordProvider,
        EditValidator {}

/**
 * Partial semantic analyzer for dependency injection.
 *
 * Allows RefactorEngine and other consumers to accept semantic analyzers
 * that only implement a subset of capabilities. This maintains flexibility
 * while enforcing ISP: consumers must check capability availability at runtime
 * (e.g., typeof semantic?.getSymbolOccurrences === "function") but the type
 * system correctly represents that methods may be absent.
 *
 * Prefer depending on specific role interfaces (SymbolResolver, OccurrenceTracker)
 * when the required capabilities are known at design time.
 */
export type PartialSemanticAnalyzer = Partial<SymbolResolver> &
    Partial<OccurrenceTracker> &
    Partial<FileSymbolProvider> &
    Partial<DependencyAnalyzer> &
    Partial<KeywordProvider> &
    Partial<EditValidator> &
    Partial<BatchWorkspaceOverlay> &
    Partial<NamingConventionTargetProvider> &
    Partial<MacroExpansionDependencyProvider>;

export interface TranspilerBridge {
    transpileScript(request: { sourceText: string; symbolId: string }): MaybePromise<Record<string, unknown>>;
}

export interface RenameRequest {
    symbolId: string;
    newName: string;
}

export interface ExecuteRenameRequest extends RenameRequest {
    readFile: WorkspaceReadFile;
    writeFile: WorkspaceWriteFile;
    includeResultContent?: boolean;
    renameFile?: (oldPath: string, newPath: string) => MaybePromise<void>;
    deleteFile?: (path: string) => MaybePromise<void>;
    prepareHotReload?: boolean;
}

export interface ExecuteBatchRenameRequest {
    renames: Array<RenameRequest>;
    readFile: WorkspaceReadFile;
    writeFile: WorkspaceWriteFile;
    includeResultContent?: boolean;
    renameFile?: (oldPath: string, newPath: string) => MaybePromise<void>;
    deleteFile?: (path: string) => MaybePromise<void>;
    prepareHotReload?: boolean;
}

/**
 * Parameters for running the globalvar-to-global codemod across multiple files.
 */
export interface ExecuteGlobalvarToGlobalCodemodRequest {
    /** All GML file paths in the project (used in phase 1 to collect globalvar names). */
    filePaths: Array<string>;
    readFile: WorkspaceReadFile;
    writeFile?: WorkspaceWriteFile;
    options?: GlobalvarToGlobalCodemodOptions;
    dryRun?: boolean;
}

/**
 * Summary for a single file processed by the globalvar-to-global codemod.
 */
export interface GlobalvarToGlobalFileSummary {
    path: string;
    /** Number of source edits applied (declaration removals + reference replacements). */
    appliedEditCount: number;
    /** Globalvar names that were migrated in this file. */
    migratedNames: Array<string>;
}

/**
 * Result payload returned after executing the globalvar-to-global codemod transaction.
 */
export interface ExecuteGlobalvarToGlobalCodemodResult {
    workspace: WorkspaceEdit;
    applied: Map<string, string>;
    changedFiles: Array<GlobalvarToGlobalFileSummary>;
}

/**
 * Parameters for running the loop-length hoisting codemod across multiple files.
 */
export interface ExecuteLoopLengthHoistingCodemodRequest {
    filePaths: Array<string>;
    readFile: WorkspaceReadFile;
    writeFile?: WorkspaceWriteFile;
    options?: LoopLengthHoistingCodemodOptions;
    dryRun?: boolean;
}

/**
 * Summary of loop-length hoisting codemod execution for a single file.
 */
export interface LoopLengthHoistingFileSummary {
    path: string;
    appliedEditCount: number;
    diagnosticOffsets: Array<number>;
}

/**
 * Result payload returned after executing a loop-length hoisting codemod transaction.
 */
export interface ExecuteLoopLengthHoistingCodemodResult {
    workspace: WorkspaceEdit;
    applied: Map<string, string>;
    changedFiles: Array<LoopLengthHoistingFileSummary>;
}

/**
 * Normalized naming-convention target emitted by semantic adapters.
 */
export interface NamingConventionTarget {
    name: string;
    category: NamingCategory;
    path: string;
    scopeId: string | null;
    symbolId: string | null;
    occurrences: Array<SymbolOccurrence>;
}

/**
 * A single naming-policy violation detected during codemod planning.
 */
export interface NamingConventionViolation {
    category: NamingCategory;
    currentName: string;
    suggestedName: string | null;
    path: string;
    symbolId: string | null;
    message: string;
}

/**
 * Naming-convention planning result, including collected edits and any blocking errors.
 */
export interface NamingConventionCodemodPlan {
    workspace: WorkspaceEdit;
    violations: Array<NamingConventionViolation>;
    warnings: Array<string>;
    errors: Array<string>;
    topLevelRenamePlan: BatchRenamePlanSummary | null;
    topLevelRenameRequests: Array<RenameRequest>;
    localRenameCount: number;
}

/**
 * Summary emitted for each configured codemod run.
 */
export interface ConfiguredCodemodSummary {
    id: RefactorCodemodId;
    changed: boolean;
    changedFiles: Array<string>;
    warnings: Array<string>;
    errors: Array<string>;
}

export interface CodemodExecutionTelemetry {
    queueCount: number;
    requestedCodemodCount: number;
    durationMs: number;
    overlayEntryCount: number;
    overlayBytes: number;
    overlayHighWaterBytes: number;
    overlaySpillWrites: number;
    overlaySpilledEntries: number;
    overlayCacheHits: number;
    overlayCacheMisses: number;
    appliedFileCount: number;
    workspaceEdit?: {
        textEditCount: number;
        fileRenameCount: number;
        metadataEditCount: number;
        touchedFileCount: number;
        totalTextBytes: number;
        highWaterTextBytes: number;
    };
}

/**
 * Aggregate result for a configured codemod execution request.
 */
export interface ConfiguredCodemodRunResult {
    dryRun: boolean;
    summaries: Array<ConfiguredCodemodSummary>;
    appliedFiles: Map<string, string>;
    telemetry?: CodemodExecutionTelemetry;
}

/**
 * Parameters for executing codemods selected from `gmloop.json`.
 */
export interface ConfiguredCodemodRunRequest {
    projectRoot: string;
    targetPaths: Array<string>;
    gmlFilePaths: Array<string>;
    config: RefactorProjectConfig;
    readFile: WorkspaceReadFile;
    writeFile?: WorkspaceWriteFile;
    renameFile?: (oldPath: string, newPath: string) => MaybePromise<void>;
    deleteFile?: (path: string) => MaybePromise<void>;
    dryRun?: boolean;
    onlyCodemods?: Array<RefactorCodemodId>;
    /**
     * Upper bound for in-memory dry-run overlay bytes before entries spill.
     *
     * A value of 0 disables spill and retains all overlay content in memory.
     */
    dryRunOverlaySpillThresholdBytes?: number;
    /**
     * Maximum read-through cache entries for the default temp-file overlay backend.
     */
    dryRunOverlayReadCacheMaxEntries?: number;
    /**
     * Optional backend used for dry-run overlay spilling.
     *
     * When omitted, the engine uses the default temp-file backend. This hook
     * keeps codemod execution backend-agnostic while preserving current defaults.
     */
    dryRunOverlayStorageBackend?: StorageBackend;
    onTelemetry?: (telemetry: CodemodExecutionTelemetry) => void;
    onAfterCodemod?: (
        summary: ConfiguredCodemodSummary,
        context: {
            readFile: WorkspaceReadFile;
        }
    ) => MaybePromise<void>;
}

/**
 * Public metadata describing a codemod registered with the refactor workspace.
 */
export interface RegisteredCodemod {
    id: RefactorCodemodId;
    description: string;
}

/**
 * Effective registration state for a codemod after config normalization and CLI filtering.
 */
export interface RegisteredCodemodSelection {
    id: RefactorCodemodId;
    description: string;
    configured: boolean;
    selected: boolean;
    effectiveConfig: RefactorCodemodConfigMap[RefactorCodemodId] | null;
}

export interface PrepareRenamePlanOptions {
    validateHotReload?: boolean;
    hotReloadOptions?: HotReloadValidationOptions;
}

export interface PrepareBatchRenamePlanOptions extends PrepareRenamePlanOptions {
    includeImpactAnalyses?: boolean;
    /**
     * Optional precomputed batch validation for the same rename set.
     *
     * Callers that already validated the batch can pass the result to avoid
     * repeating identical validation work before planning.
     */
    batchValidation?: BatchRenameValidation;
}

export interface HotReloadValidationOptions {
    checkTranspiler?: boolean;
    readFile?: WorkspaceReadFile;
}

export interface ValidationSummary {
    valid: boolean;
    errors: Array<string>;
    warnings: Array<string>;
    symbolName?: string;
    occurrenceCount?: number;
    hotReload?: HotReloadSafetySummary;
}

export interface RenamePlanSummary {
    workspace: WorkspaceEdit;
    validation: ValidationSummary;
    hotReload: ValidationSummary | null;
    analysis: RenameImpactAnalysis;
}

export interface BatchRenamePlanSummary {
    workspace: WorkspaceEdit;
    validation: ValidationSummary;
    hotReload: ValidationSummary | null;
    batchValidation: BatchRenameValidation;
    impactAnalyses: Map<string, RenameImpactAnalysis>;
    cascadeResult: HotReloadCascadeResult | null;
}

export interface RenameImpactSummary {
    symbolId: string;
    oldName: string;
    newName: string;
    affectedFiles: Array<string>;
    totalOccurrences: number;
    definitionCount: number;
    referenceCount: number;
    hotReloadRequired: boolean;
    dependentSymbols: Array<string>;
}

export interface RenameImpactAnalysis {
    valid: boolean;
    summary: RenameImpactSummary;
    conflicts: Array<ConflictEntry>;
    warnings: Array<ConflictEntry>;
}

export interface HotReloadUpdate {
    symbolId: string;
    action: "recompile" | "notify";
    filePath: string;
    affectedRanges: Array<Range>;
}

export interface ExecuteRenameResult {
    workspace: WorkspaceEdit;
    applied: Map<string, string>;
    hotReloadUpdates: Array<HotReloadUpdate>;
    fileRenames: Array<FileRename>;
}

export interface TranspilerPatch {
    symbolId: string;
    patch: Record<string, unknown>;
    filePath: string;
}

export interface CascadeEntry {
    symbolId: string;
    distance: number;
    reason: string;
    filePath?: string;
}

export interface HotReloadCascadeMetadata {
    totalSymbols: number;
    maxDistance: number;
    hasCircular: boolean;
}

export interface HotReloadCascadeResult {
    cascade: Array<CascadeEntry>;
    order: Array<string>;
    circular: Array<Array<string>>;
    metadata: HotReloadCascadeMetadata;
}

export interface HotReloadSafetySummary {
    safe: boolean;
    reason: string;
    requiresRestart: boolean;
    canAutoFix: boolean;
    suggestions: Array<string>;
}

export interface ValidateRenameRequestOptions {
    includeHotReload?: boolean;
}

export interface BatchRenameValidation {
    valid: boolean;
    errors: Array<string>;
    warnings: Array<string>;
    renameValidations: Map<string, ValidationSummary>;
    conflictingSets: Array<Array<string>>;
}

export interface ConflictEntry {
    type: ConflictTypeValue;
    message: string;
    severity?: string;
    path?: string;
}

export type WorkspaceReadFile = (path: string) => MaybePromise<string>;
export type WorkspaceWriteFile = (path: string, content: string) => MaybePromise<void>;

export interface RefactorProjectAnalysisProvider {
    isIdentifierOccupied(
        identifierName: string,
        context: {
            semantic: PartialSemanticAnalyzer | null;
            prepareRenamePlan: (
                request: { symbolId: string; newName: string },
                options: { validateHotReload: boolean }
            ) => Promise<RenamePlanSummary>;
        }
    ): Promise<boolean>;
    listIdentifierOccurrences(
        identifierName: string,
        context: {
            semantic: PartialSemanticAnalyzer | null;
            prepareRenamePlan: (
                request: { symbolId: string; newName: string },
                options: { validateHotReload: boolean }
            ) => Promise<RenamePlanSummary>;
        }
    ): Promise<Set<string>>;
    planFeatherRenames(
        requests: ReadonlyArray<{ identifierName: string; preferredReplacementName: string }>,
        filePath: string | null,
        projectRoot: string,
        context: {
            semantic: PartialSemanticAnalyzer | null;
            prepareRenamePlan: (
                request: { symbolId: string; newName: string },
                options: { validateHotReload: boolean }
            ) => Promise<RenamePlanSummary>;
        }
    ): Promise<
        Array<{
            identifierName: string;
            mode: "local-fallback" | "project-aware";
            preferredReplacementName: string;
            replacementName: string | null;
            skipReason?: string;
        }>
    >;
    assessGlobalVarRewrite(
        filePath: string | null,
        hasInitializer: boolean
    ): {
        allowRewrite: boolean;
        initializerMode: "existing" | "undefined";
        mode: "project-aware";
    };
    resolveLoopHoistIdentifier(preferredName: string): {
        identifierName: string;
        mode: "project-aware";
    };
}

export interface RefactorEngineDependencies {
    parser: ParserBridge | null;
    semantic: PartialSemanticAnalyzer | null;
    formatter: TranspilerBridge | null;
    projectAnalysisProvider: RefactorProjectAnalysisProvider | null;
}

/**
 * Minimal engine surface used by codemod orchestration modules.
 *
 * This boundary keeps codemod planning/execution decoupled from the concrete
 * `RefactorEngine` implementation and prevents registry ↔ engine import cycles.
 */
export interface CodemodEngine {
    readonly semantic: PartialSemanticAnalyzer | null;
    executeGlobalvarToGlobalCodemod(
        request: ExecuteGlobalvarToGlobalCodemodRequest
    ): Promise<ExecuteGlobalvarToGlobalCodemodResult>;
    executeLoopLengthHoistingCodemod(
        request: ExecuteLoopLengthHoistingCodemodRequest
    ): Promise<ExecuteLoopLengthHoistingCodemodResult>;
    validateRenameRequest(
        request: RenameRequest,
        options?: ValidateRenameRequestOptions
    ): Promise<
        ValidationSummary & {
            symbolName?: string;
            occurrenceCount?: number;
            hotReload?: HotReloadSafetySummary;
        }
    >;
    prepareBatchRenamePlan(
        request: Array<RenameRequest>,
        options?: PrepareBatchRenamePlanOptions
    ): Promise<BatchRenamePlanSummary>;
    executeBatchRename(request: ExecuteBatchRenameRequest): Promise<ExecuteRenameResult>;
    applyWorkspaceEdit(workspace: WorkspaceEdit, options: ApplyWorkspaceEditOptions): Promise<Map<string, string>>;
    clearQueryCaches(): void;
}

export interface ApplyWorkspaceEditOptions {
    dryRun?: boolean;
    includeResultContent?: boolean;
    readFile: WorkspaceReadFile;
    writeFile?: WorkspaceWriteFile;
    renameFile?: (oldPath: string, newPath: string) => MaybePromise<void>;
    deleteFile?: (path: string) => MaybePromise<void>;
}

export interface RenameImpactNode {
    symbolId: string;
    symbolName: string;
    distance: number;
    isDirectlyAffected: boolean;
    dependents: Array<string>;
    dependsOn: Array<string>;
    filePath?: string;
    estimatedReloadTime?: number;
}

export interface RenameImpactGraph {
    nodes: Map<string, RenameImpactNode>;
    rootSymbol: string;
    totalAffectedSymbols: number;
    maxDepth: number;
    criticalPath: Array<string>;
    estimatedTotalReloadTime: number;
}
