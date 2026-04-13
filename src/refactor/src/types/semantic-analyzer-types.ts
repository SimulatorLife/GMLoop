import type { MaybePromise, NamingCategory, OccurrenceKindValue, Range } from "../types.js";
import type { WorkspaceEdit } from "../workspace-edit.js";
import type { NamingConventionTarget } from "./refactor-engine-types.js";

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
