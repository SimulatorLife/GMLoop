import * as Backends from "./backends/index.js";
import * as CodemodRegistry from "./codemod-registry.js";
import * as Codemods from "./codemods/index.js";
import * as HotReload from "./hot-reload.js";
import * as NamingConventionPolicy from "./naming-convention-policy.js";
import * as OccurrenceAnalysis from "./occurrence-analysis.js";
import * as ProjectAnalysisProvider from "./project-analysis-provider.js";
import * as ProjectConfig from "./project-config.js";
import * as ProjectResources from "./project-resources/index.js";
import * as RefactorEngineAPI from "./refactor-engine.js";
import * as Validation from "./rename/rename-validation.js";
import * as RenamePreview from "./rename-preview.js";
import { RenameValidationCache } from "./rename-validation-cache.js";
import { SemanticQueryCache } from "./semantic-cache.js";
import {
    ConflictType,
    isConflictType,
    isOccurrenceKind,
    isSymbolKind,
    OccurrenceKind,
    parseConflictType,
    parseOccurrenceKind,
    parseSymbolKind,
    requireConflictType,
    requireOccurrenceKind,
    requireSymbolKind,
    SymbolKind
} from "./types.js";
import { WorkspaceEdit } from "./workspace-edit.js";

export const Refactor = Object.freeze({
    ...RefactorEngineAPI,
    ...ProjectAnalysisProvider,
    ...ProjectConfig,
    ...ProjectResources,
    ...NamingConventionPolicy,
    ...CodemodRegistry,
    ...Codemods,
    ...Backends,
    WorkspaceEdit,
    SemanticQueryCache,
    RenameValidationCache,
    ...OccurrenceAnalysis,
    ...RenamePreview,
    ...Validation,
    ...HotReload,
    ConflictType,
    isConflictType,
    parseConflictType,
    requireConflictType,
    OccurrenceKind,
    isOccurrenceKind,
    parseOccurrenceKind,
    requireOccurrenceKind,
    SymbolKind,
    isSymbolKind,
    parseSymbolKind,
    requireSymbolKind
});

export * as Backends from "./backends/index.js";
export {
    executeRegisteredCodemods,
    listConfiguredCodemods,
    listRegisteredCodemods,
    listSemanticProjectIndexDependentCodemodIds
} from "./codemod-registry.js";
export * as Codemods from "./codemods/index.js";
export type {
    LoopLengthHoistFunctionSuffixes,
    LoopLengthHoistingCodemodOptions,
    LoopLengthHoistingCodemodResult,
    LoopLengthHoistingEdit
} from "./codemods/loop-length-hoisting/index.js";
export { applyLoopLengthHoistingCodemod } from "./codemods/loop-length-hoisting/index.js";
export { executeNamingConventionCodemod, planNamingConventionCodemod } from "./codemods/naming-convention/index.js";
export {
    checkHotReloadSafety,
    computeHotReloadCascade,
    computeRenameImpactGraph,
    generateTranspilerPatches,
    prepareHotReloadUpdates
} from "./hot-reload.js";
export {
    evaluateNamingConvention,
    formatNamingCaseStyle,
    NAMING_CASE_STYLES,
    NAMING_CATEGORY_PARENTS,
    normalizeNamingConventionPolicy,
    resolveNamingConventionRules
} from "./naming-convention-policy.js";
export type { OccurrenceClassification } from "./occurrence-analysis.js";
export {
    classifyOccurrences,
    countAffectedFiles,
    filterOccurrencesByKind,
    findOccurrencesInFile,
    groupOccurrencesByFile
} from "./occurrence-analysis.js";
export { DEFAULT_PROJECT_ANALYSIS_PROVIDER } from "./project-analysis-provider.js";
export { normalizeRefactorProjectConfig } from "./project-config.js";
export type {
    AddProjectResourceRequest,
    ProjectResourceKindValue,
    ProjectResourceMutationResult,
    RemoveProjectResourceRequest
} from "./project-resources/index.js";
export * as ProjectResources from "./project-resources/index.js";
export { addProjectResource, removeProjectResource } from "./project-resources/index.js";
export {
    isProjectResourceKind,
    parseProjectResourceKind,
    ProjectResourceKind,
    requireProjectResourceKind
} from "./project-resources/index.js";
export { RefactorEngine } from "./refactor-engine.js";
export type {
    CrossRenameConfusion,
    DuplicateSymbolIdEntry,
    DuplicateTargetNameEntry
} from "./rename/rename-validation.js";
export {
    batchValidateScopeConflicts,
    detectCircularRenames,
    detectCrossRenameNameConfusion,
    detectDuplicateSourceSymbolIds,
    detectDuplicateTargetNames,
    detectRenameConflicts,
    validateCrossFileConsistency,
    validateRenameStructure
} from "./rename/rename-validation.js";
export type { FilePreview, RenamePreview } from "./rename-preview.js";
export {
    formatBatchRenamePlanReport,
    formatOccurrencePreview,
    formatRenamePlanReport,
    generateRenamePreview
} from "./rename-preview.js";
export type {
    CachedValidationResult,
    RenameValidationCacheConfig,
    ValidationCacheStats
} from "./rename-validation-cache.js";
export { RenameValidationCache } from "./rename-validation-cache.js";
export type { CacheStats, SemanticCacheConfig } from "./semantic-cache.js";
export { SemanticQueryCache } from "./semantic-cache.js";
export type {
    ApplyWorkspaceEditOptions,
    AstNode,
    BatchRenamePlanSummary,
    BatchRenameValidation,
    CascadeEntry,
    CodemodCacheController,
    CodemodEngine,
    CodemodExecutionTelemetry,
    CodemodRenameOperations,
    CodemodSemanticProvider,
    CodemodTransformExecutor,
    CodemodWorkspaceEditor,
    ConfiguredCodemodRunRequest,
    ConfiguredCodemodRunResult,
    ConfiguredCodemodSummary,
    ConflictEntry,
    ConflictTypeValue,
    DependencyAnalyzer,
    DependentSymbol,
    EditValidator,
    ExecuteBatchRenameRequest,
    ExecuteGlobalvarToGlobalCodemodRequest,
    ExecuteGlobalvarToGlobalCodemodResult,
    ExecuteLoopLengthHoistingCodemodRequest,
    ExecuteLoopLengthHoistingCodemodResult,
    ExecuteRenameRequest,
    ExecuteRenameResult,
    FileSymbol,
    FileSymbolProvider,
    GlobalvarToGlobalFileSummary,
    HotReloadCascadeMetadata,
    HotReloadCascadeResult,
    HotReloadSafetySummary,
    HotReloadUpdate,
    HotReloadValidationOptions,
    KeywordProvider,
    LoopLengthHoistingFileSummary,
    MacroExpansionDependency,
    MacroExpansionDependencyProvider,
    MaybePromise,
    NamingCaseStyle,
    NamingCategory,
    NamingConventionCodemodPlan,
    NamingConventionPolicy,
    NamingConventionTarget,
    NamingConventionTargetProvider,
    NamingConventionViolation,
    NamingRuleConfig,
    OccurrenceKindValue,
    OccurrenceTracker,
    ParserBridge,
    PartialSemanticAnalyzer,
    PrepareBatchRenamePlanOptions,
    PrepareRenamePlanOptions,
    Range,
    RefactorCodemodConfigEntry,
    RefactorCodemodConfigMap,
    RefactorCodemodId,
    RefactorEngineDependencies,
    RefactorHotReloadCoordinator,
    RefactorProjectAnalysisProvider,
    RefactorProjectConfig,
    RegisteredCodemod,
    RegisteredCodemodSelection,
    RenameImpactAnalysis,
    RenameImpactGraph,
    RenameImpactNode,
    RenameImpactSummary,
    RenamePlanSummary,
    RenameRequest,
    ResolvedNamingConventionRules,
    ResolvedNamingRule,
    SemanticAnalyzer,
    SemanticValidationResult,
    SymbolKindValue,
    SymbolLocation,
    SymbolLookupResult,
    SymbolOccurrence,
    SymbolResolver,
    TranspilerBridge,
    TranspilerPatch,
    ValidateRenameRequestOptions,
    ValidationSummary,
    WorkspaceReadFile,
    WorkspaceWriteFile
} from "./types.js";
export { isSymbolKind, parseSymbolKind, requireSymbolKind, SymbolKind } from "./types.js";
export { ConflictType, isConflictType, parseConflictType, requireConflictType } from "./types.js";
export { isOccurrenceKind, OccurrenceKind, parseOccurrenceKind, requireOccurrenceKind } from "./types.js";
export type { WorkspaceRevisionProvider } from "./workspace-edit.js";
export { WORKSPACE_EDIT_REVISION_TOKEN, WorkspaceEdit } from "./workspace-edit.js";
