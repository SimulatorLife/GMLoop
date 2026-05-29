import type { StorageBackend } from "../backends/storage-backend.js";
import type {
    ConflictTypeValue,
    GlobalvarToGlobalCodemodOptions,
    MaybePromise,
    NamingCategory,
    Range,
    RefactorCodemodConfigMap,
    RefactorCodemodId,
    RefactorProjectConfig
} from "../types.js";
import type { FileRename, WorkspaceEdit } from "../workspace-edit.js";
import type { ParserBridge, PartialSemanticAnalyzer, SymbolOccurrence } from "./semantic-analyzer-types.js";

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

/**
 * Hot reload coordination entry points consumed by {@link RefactorEngine}.
 *
 * This seam allows tests (and advanced embedders) to inject deterministic
 * collaborators without subclassing the engine to override hot-reload methods.
 */
export interface RefactorHotReloadCoordinator {
    checkHotReloadSafety(
        request: RenameRequest,
        semantic: PartialSemanticAnalyzer | null
    ): Promise<HotReloadSafetySummary>;
    computeHotReloadCascade(
        changedSymbolIds: Array<string>,
        semantic: PartialSemanticAnalyzer | null
    ): Promise<HotReloadCascadeResult>;
    computeRenameImpactGraph(symbolId: string, semantic: PartialSemanticAnalyzer | null): Promise<RenameImpactGraph>;
}

export interface RefactorEngineDependencies {
    parser: ParserBridge | null;
    semantic: PartialSemanticAnalyzer | null;
    formatter: TranspilerBridge | null;
    projectAnalysisProvider: RefactorProjectAnalysisProvider | null;
    hotReloadCoordinator: RefactorHotReloadCoordinator | null;
}

/**
 * Semantic analysis access.
 *
 * Provides read-only access to the semantic analyzer instance without
 * coupling to codemod execution, rename, or workspace edit operations.
 */
export interface CodemodSemanticProvider {
    readonly semantic: PartialSemanticAnalyzer | null;
}

/**
 * File-level codemod transform execution.
 *
 * Provides the ability to run file-transforming codemods (globalvar-to-global)
 * without coupling to rename or workspace edit operations.
 */
export interface CodemodTransformExecutor {
    executeGlobalvarToGlobalCodemod(
        request: ExecuteGlobalvarToGlobalCodemodRequest
    ): Promise<ExecuteGlobalvarToGlobalCodemodResult>;
}

/**
 * Rename validation and planning.
 *
 * Provides rename lifecycle operations (validate, plan, execute) without
 * coupling to codemod transform execution or workspace edit application.
 */
export interface CodemodRenameOperations {
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
}

/**
 * Workspace edit application.
 *
 * Provides the ability to apply workspace edits without coupling to
 * rename validation or codemod transform operations.
 */
export interface CodemodWorkspaceEditor {
    applyWorkspaceEdit(workspace: WorkspaceEdit, options: ApplyWorkspaceEditOptions): Promise<Map<string, string>>;
}

/**
 * Cache management.
 *
 * Provides query cache invalidation without coupling to other engine
 * operations.
 */
export interface CodemodCacheController {
    clearQueryCaches(): void;
}

/**
 * Complete codemod engine interface.
 *
 * Combines all role-focused interfaces for consumers that need full
 * codemod capabilities. This boundary keeps codemod planning/execution
 * decoupled from the concrete `RefactorEngine` implementation and
 * prevents registry ↔ engine import cycles.
 *
 * Consumers should prefer depending on the minimal interface they need
 * (CodemodSemanticProvider, CodemodTransformExecutor, CodemodRenameOperations,
 * CodemodWorkspaceEditor, CodemodCacheController) rather than this composite
 * interface when possible.
 */
export interface CodemodEngine
    extends
        CodemodSemanticProvider,
        CodemodTransformExecutor,
        CodemodRenameOperations,
        CodemodWorkspaceEditor,
        CodemodCacheController {}

export interface ApplyWorkspaceEditOptions {
    dryRun?: boolean;
    includeResultContent?: boolean;
    readFile: WorkspaceReadFile;
    /**
     * Optional source-text cache keyed by absolute or project-relative file path.
     * When provided, `applyWorkspaceEdit` reuses these in-memory snapshots
     * instead of re-reading files that were already loaded during codemod planning.
     */
    sourceTextByPath?: ReadonlyMap<string, string>;
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
