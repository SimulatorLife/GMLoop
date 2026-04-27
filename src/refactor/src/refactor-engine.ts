/**
 * Refactor engine for GML-native codemod transactions and semantic-safe code transformations.
 * Coordinates rename operations, batch renames, hot reload validation, and
 * workspace edits (via a Collection API) across the project while preventing
 * scope capture and shadowing.
 */

import path from "node:path";

import { Core } from "@gmloop/core";

import { createTempFileStorageBackend, type StorageBackend } from "./backends/index.js";
import { executeRegisteredCodemods } from "./codemod-registry.js";
import { applyGlobalvarToGlobalCodemod, collectGlobalvarDeclaredNames } from "./codemods/globalvar-to-global/index.js";
import { applyLoopLengthHoistingCodemod } from "./codemods/loop-length-hoisting/index.js";
import { planNamingConventionCodemod } from "./codemods/naming-convention/index.js";
import * as HotReload from "./hot-reload.js";
import { DEFAULT_PROJECT_ANALYSIS_PROVIDER } from "./project-analysis-provider.js";
import { assertRenameRequest, assertValidIdentifierName, extractSymbolName } from "./rename/index.js";
import {
    detectCircularRenames,
    detectCrossRenameNameConfusion,
    detectDuplicateSourceSymbolIds,
    detectDuplicateTargetNames,
    detectRenameConflicts,
    validateCrossFileConsistency
} from "./rename/rename-validation.js";
import { RenameValidationCache } from "./rename-validation-cache.js";
import { SemanticQueryCache } from "./semantic-cache.js";
import * as SymbolQueries from "./symbol-queries.js";
import {
    type ApplyWorkspaceEditOptions,
    type BatchRenamePlanSummary,
    type BatchRenameValidation,
    type CodemodExecutionTelemetry,
    type ConfiguredCodemodRunRequest,
    type ConfiguredCodemodRunResult,
    type ConflictEntry,
    ConflictType,
    type ExecuteBatchRenameRequest,
    type ExecuteGlobalvarToGlobalCodemodRequest,
    type ExecuteGlobalvarToGlobalCodemodResult,
    type ExecuteLoopLengthHoistingCodemodRequest,
    type ExecuteLoopLengthHoistingCodemodResult,
    type ExecuteRenameRequest,
    type ExecuteRenameResult,
    type HotReloadCascadeResult,
    type HotReloadSafetySummary,
    type HotReloadUpdate,
    type HotReloadValidationOptions,
    type NamingConventionCodemodPlan,
    OccurrenceKind,
    type ParserBridge,
    type PartialSemanticAnalyzer,
    type PrepareBatchRenamePlanOptions,
    type PrepareRenamePlanOptions,
    type RefactorEngineDependencies,
    type RefactorProjectAnalysisProvider,
    type RenameImpactAnalysis,
    type RenameImpactGraph,
    type RenamePlanSummary,
    type RenameRequest,
    type SymbolLocation,
    type SymbolOccurrence,
    type TranspilerBridge,
    type TranspilerPatch,
    type ValidateRenameRequestOptions,
    type ValidationSummary,
    type WorkspaceReadFile
} from "./types.js";
import {
    getWorkspaceArrays,
    getWorkspaceEditRevision,
    type GroupedTextEdits,
    isWorkspaceEditLike,
    mergeWorkspaceEditInto,
    type TextEdit,
    validateFileRenameOperations,
    WorkspaceEdit
} from "./workspace-edit.js";

const RENAME_VALIDATION_CACHE_MAX_SIZE = 4096;
const APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT = 8;
const CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES = 256;
const validatedWorkspaceRevisions = new WeakMap<object, number>();

function hasCurrentValidatedWorkspaceRevision(workspace: object): boolean {
    const currentRevision = getWorkspaceEditRevision(workspace);
    if (currentRevision === null) {
        return false;
    }

    return validatedWorkspaceRevisions.get(workspace) === currentRevision;
}

function rememberValidatedWorkspaceRevision(workspace: object): void {
    const currentRevision = getWorkspaceEditRevision(workspace);
    if (currentRevision === null) {
        return;
    }

    validatedWorkspaceRevisions.set(workspace, currentRevision);
}

function deduplicateSymbolOccurrences(occurrences: Array<SymbolOccurrence>): Array<SymbolOccurrence> {
    if (occurrences.length <= 1) {
        return [...occurrences];
    }

    if (occurrences.length <= 8) {
        const deduplicated: Array<SymbolOccurrence> = [];

        for (const occurrence of occurrences) {
            const existingIndex = deduplicated.findIndex(
                (candidate) => candidate.path === occurrence.path && candidate.start === occurrence.start
            );

            if (existingIndex === -1) {
                deduplicated.push(occurrence);
                continue;
            }

            // Replace the entire entry when the incoming occurrence covers a wider span so
            // that all fields (including `kind`) come from the dominant occurrence rather
            // than forming a hybrid with stale metadata from the first entry seen.
            if (occurrence.end > deduplicated[existingIndex].end) {
                deduplicated[existingIndex] = occurrence;
            }
        }

        return deduplicated;
    }

    const deduplicatedByStart = new Map<string, SymbolOccurrence>();

    for (const occurrence of occurrences) {
        // Use a template literal instead of array+join to avoid the intermediate
        // array allocation on every iteration of the deduplication hot loop.
        const key = `${occurrence.path ?? ""}:${occurrence.start}`;
        const existing = deduplicatedByStart.get(key);

        if (!existing || occurrence.end > existing.end) {
            deduplicatedByStart.set(key, occurrence);
        }
    }

    return [...deduplicatedByStart.values()];
}

function semanticSupportsBatchWorkspaceOverlay(
    semantic: PartialSemanticAnalyzer | null
): semantic is PartialSemanticAnalyzer &
    Required<Pick<NonNullable<PartialSemanticAnalyzer>, "clearWorkspaceOverlay" | "stageWorkspaceEdit">> {
    return Core.hasMethods(semantic, ["clearWorkspaceOverlay", "stageWorkspaceEdit"]);
}

function dropRedundantTextEditsForMetadataRewrites(workspace: WorkspaceEdit): WorkspaceEdit {
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);
    if (metadataEdits.length === 0) {
        return workspace;
    }

    const metadataPaths = new Set(metadataEdits.map((metadataEdit) => metadataEdit.path));
    const hasRedundantTextEdits = workspace.edits.some((edit) => metadataPaths.has(edit.path));
    if (!hasRedundantTextEdits) {
        return workspace;
    }

    const normalizedWorkspace = new WorkspaceEdit();

    for (const edit of workspace.edits) {
        if (metadataPaths.has(edit.path)) {
            continue;
        }

        normalizedWorkspace.addEdit(edit.path, edit.start, edit.end, edit.newText);
    }

    for (const metadataEdit of metadataEdits) {
        normalizedWorkspace.addMetadataEdit(metadataEdit.path, metadataEdit.content);
    }

    for (const fileRename of fileRenames) {
        normalizedWorkspace.addFileRename(fileRename.oldPath, fileRename.newPath);
    }

    return normalizedWorkspace;
}

function applyGroupedTextEditsToContent(
    originalContent: string,
    edits: ReadonlyArray<Pick<TextEdit, "end" | "newText" | "start">>
): string {
    if (edits.length === 0) {
        return originalContent;
    }

    // `edits` arrives pre-sorted in descending start order from `WorkspaceEdit.groupByFile()`.
    // Iterating in reverse gives ascending order so we can build the result string left-to-right
    // with a single accumulator, avoiding the intermediate fragment array allocation and
    // `Array.prototype.join` call that the previous approach required.  Benchmarks show this
    // is ~6-7× faster than the pre-allocated-array approach for files with many edits.
    let result = "";
    let cursor = 0;

    for (let i = edits.length - 1; i >= 0; i--) {
        const edit = edits[i];
        result += originalContent.slice(cursor, edit.start);
        result += edit.newText;
        cursor = edit.end;
    }

    result += originalContent.slice(cursor);
    return result;
}

/**
 * RefactorEngine coordinates semantic-safe edits across the project.
 * It consumes parser spans and semantic bindings to plan WorkspaceEdits
 * that avoid scope capture or shadowing.
 */
export class RefactorEngine {
    public readonly parser: ParserBridge | null;
    public readonly semantic: PartialSemanticAnalyzer | null;
    public readonly formatter: TranspilerBridge | null;
    private readonly projectAnalysisProvider: RefactorProjectAnalysisProvider;
    private readonly renameValidationCache: RenameValidationCache;
    private readonly semanticCache: SemanticQueryCache;

    constructor({
        parser = null,
        semantic = null,
        formatter = null,
        projectAnalysisProvider = null
    }: Partial<RefactorEngineDependencies> = {}) {
        this.parser = parser ?? null;
        this.semantic = semantic ?? null;
        this.formatter = formatter ?? null;
        this.projectAnalysisProvider = projectAnalysisProvider ?? DEFAULT_PROJECT_ANALYSIS_PROVIDER;
        this.renameValidationCache = new RenameValidationCache({
            maxSize: RENAME_VALIDATION_CACHE_MAX_SIZE
        });
        this.semanticCache = new SemanticQueryCache(semantic, {
            // Batch codemods can validate and then plan several thousand symbol
            // queries in one run. Keep enough room for those session-local
            // results so the planning phase can reuse the validation lookups.
            maxSize: 8192,
            ttlMs: 300_000,
            maxOccurrenceCacheEntries: 4000
        });
    }

    clearQueryCaches(): void {
        this.renameValidationCache.invalidateAll();
        this.semanticCache.invalidateAll();
    }

    /**
     * Find the symbol at a specific location in a file.
     * Useful for triggering refactorings from editor positions.
     */
    findSymbolAtLocation(filePath: string, offset: number): Promise<SymbolLocation | null> {
        return SymbolQueries.findSymbolAtLocation(filePath, offset, this.semantic, this.parser);
    }

    /**
     * Validate symbol exists in the semantic index.
     */
    validateSymbolExists(symbolId: string): Promise<boolean> {
        if (this.semantic === null) {
            return SymbolQueries.validateSymbolExists(symbolId, this.semantic);
        }

        return this.semanticCache.hasSymbol(symbolId);
    }

    /**
     * Gather all occurrences of a symbol from the semantic analyzer.
     *
     * On the first call the raw semantic result is deduplicated and the clean
     * array is stored back in the cache via {@link SemanticQueryCache.primeOccurrenceCache}.
     * On every subsequent cache hit {@link SemanticQueryCache.isOccurrencePrimed} returns
     * `true`, so the deduplication step is skipped entirely — avoiding redundant
     * O(n) iteration over an already-clean occurrence array in batch-rename scenarios
     * where the same symbol is queried multiple times.
     */
    gatherSymbolOccurrences(symbolName: string, symbolId: string | null = null): Promise<Array<SymbolOccurrence>> {
        return this.semanticCache.getSymbolOccurrences(symbolName, symbolId).then((occurrences) => {
            // Skip deduplication when the cache entry is already known to be clean.
            if (this.semanticCache.isOccurrencePrimed(symbolName, symbolId)) {
                return occurrences;
            }

            const deduplicated = deduplicateSymbolOccurrences(occurrences);
            // Replace the raw occurrence cache entry with the deduped+range-merged
            // result so that every subsequent cache hit for the same symbol skips
            // the deduplication work entirely.  The prime is a no-op when the entry
            // exceeds maxOccurrenceCacheEntries or when caching is disabled.
            this.semanticCache.primeOccurrenceCache(symbolName, symbolId, deduplicated);
            return deduplicated;
        });
    }

    /**
     * Query the semantic analyzer for symbols defined in a specific file.
     * This is useful for hot reload coordination to determine which symbols
     * need recompilation when a file changes.
     */
    getFileSymbols(filePath: string): Promise<Array<{ id: string }>> {
        Core.assertNonEmptyString(filePath, {
            errorMessage: "getFileSymbols requires a valid file path string"
        });
        return this.semanticCache.getFileSymbols(filePath);
    }

    /**
     * Query the semantic analyzer for symbols that depend on the given symbols.
     * This is essential for hot reload to determine which symbols need recompilation
     * when dependencies change.
     */
    getSymbolDependents(symbolIds: Array<string>): Promise<Array<{ symbolId: string; filePath: string }>> {
        Core.assertArray(symbolIds, {
            errorMessage: "getSymbolDependents requires an array of symbol IDs"
        });
        return this.semanticCache.getDependents(symbolIds);
    }

    /**
     * Check if an identifier name is already occupied in the project.
     * This is used by @gmloop/lint and @gmloop/refactor to
     * determine if a proposed variable name or identifier is safe to use.
     */
    async isIdentifierOccupied(identifierName: string): Promise<boolean> {
        return await this.projectAnalysisProvider.isIdentifierOccupied(identifierName, {
            semantic: this.semantic,
            prepareRenamePlan: async (request, options) => await this.prepareRenamePlan(request, options)
        });
    }

    /**
     * List all files where an identifier occurs.
     * This is used by @gmloop/lint and @gmloop/refactor to
     * determine if a rename or refactor would affect multiple files.
     */
    async listIdentifierOccurrences(identifierName: string): Promise<Set<string>> {
        return await this.projectAnalysisProvider.listIdentifierOccurrences(identifierName, {
            semantic: this.semantic,
            prepareRenamePlan: async (request, options) => await this.prepareRenamePlan(request, options)
        });
    }

    /**
     * Validate a rename request before planning edits.
     * Unlike planRename, this method returns validation results without throwing errors,
     * making it suitable for providing user feedback in IDE integrations and CLI tools.
     *
     * @param {Object} request - Rename request to validate
     * @param {string} request.symbolId - Symbol to rename (e.g., "gml/script/scr_foo")
     * @param {string} request.newName - Proposed new name for the symbol
     * @returns {Promise<{valid: boolean, errors: Array<string>, warnings: Array<string>, symbolName?: string, occurrenceCount?: number}>}
     *
     * @example
     * const validation = await engine.validateRenameRequest({
     *     symbolId: "gml/script/scr_player",
     *     newName: "scr_hero"
     * });
     *
     * if (!validation.valid) {
     *     console.error("Rename validation failed:", validation.errors);
     * } else if (validation.warnings.length > 0) {
     *     console.warn("Rename warnings:", validation.warnings);
     * }
     */
    async validateRenameRequest(
        request: RenameRequest,
        options?: ValidateRenameRequestOptions
    ): Promise<
        ValidationSummary & {
            symbolName?: string;
            occurrenceCount?: number;
            hotReload?: HotReloadSafetySummary;
        }
    > {
        const includeHotReload = options?.includeHotReload ?? false;
        if (includeHotReload) {
            return await this.computeRenameValidation(request, { includeHotReload: true });
        }

        if (!request || typeof request.symbolId !== "string" || typeof request.newName !== "string") {
            return await this.computeRenameValidation(request, options);
        }

        return await this.renameValidationCache.getOrCompute(request.symbolId, request.newName, async () => {
            return await this.computeRenameValidation(request, options);
        });
    }

    private async computeRenameValidation(
        request: RenameRequest,
        options?: ValidateRenameRequestOptions
    ): Promise<
        ValidationSummary & {
            symbolName?: string;
            occurrenceCount?: number;
            hotReload?: HotReloadSafetySummary;
        }
    > {
        const { symbolId, newName } = request ?? {};
        const opts = options ?? {};
        const errors: Array<string> = [];
        const warnings: Array<string> = [];
        let hotReload: HotReloadSafetySummary | undefined;

        // Validate request structure
        if (!symbolId || !newName) {
            errors.push("Both symbolId and newName are required");
            return { valid: false, errors, warnings };
        }

        if (typeof symbolId !== "string") {
            errors.push(`symbolId must be a string, received ${typeof symbolId}`);
            return { valid: false, errors, warnings };
        }

        if (typeof newName !== "string") {
            errors.push(`newName must be a string, received ${typeof newName}`);
            return { valid: false, errors, warnings };
        }

        // Validate identifier syntax
        let normalizedNewName: string;
        try {
            normalizedNewName = assertValidIdentifierName(newName);
        } catch (error) {
            errors.push(Core.getErrorMessage(error));
            return { valid: false, errors, warnings };
        }

        // Check if symbol exists in semantic index
        if (this.semantic) {
            const exists = await this.validateSymbolExists(symbolId);
            if (!exists) {
                errors.push(`Symbol '${symbolId}' not found in semantic index. Ensure the project has been analyzed.`);
                return { valid: false, errors, warnings };
            }
        } else {
            warnings.push("No semantic analyzer available - cannot verify symbol existence");
        }

        // Extract the symbol's base name from its fully-qualified ID.
        // Symbol IDs follow the pattern "gml/{kind}/{name}" where {name} is the
        // last path component (e.g., "gml/script/scr_foo" → "scr_foo").
        // This name is used to search for all occurrences in the codebase.
        const symbolName = extractSymbolName(symbolId);

        if (symbolName === normalizedNewName) {
            errors.push(`The new name '${normalizedNewName}' matches the existing identifier`);
            return { valid: false, errors, warnings };
        }

        // Gather occurrences to check for conflicts
        const occurrences = await this.gatherSymbolOccurrences(symbolName, symbolId);

        if (occurrences.length === 0) {
            warnings.push(`No occurrences found for symbol '${symbolName}' - rename will have no effect`);
        }

        // Check for conflicts
        const conflicts = await detectRenameConflicts(
            symbolName,
            normalizedNewName,
            occurrences,
            this.semantic,
            this.semantic
        );

        for (const conflict of conflicts) {
            if (conflict.type === ConflictType.RESERVED || conflict.type === ConflictType.SHADOW) {
                errors.push(conflict.message);
            } else {
                warnings.push(conflict.message);
            }
        }

        // Route through the semantic cache so repeated getFileSymbols lookups
        // for the same file across multiple symbol validations in a batch are
        // served from memory rather than re-queried from the semantic bridge.
        const crossFileConflicts = await validateCrossFileConsistency(
            symbolId,
            normalizedNewName,
            occurrences,
            this.semanticCache
        );

        for (const conflict of crossFileConflicts) {
            if (conflict.severity === "warning") {
                warnings.push(conflict.message);
            } else {
                errors.push(conflict.message);
            }
        }

        if (opts.includeHotReload && errors.length === 0) {
            hotReload = await this.checkHotReloadSafety(request);

            if (!hotReload.safe) {
                const hotReloadMessage = hotReload.requiresRestart
                    ? `Hot reload unavailable: ${hotReload.reason}`
                    : `Hot reload limitations detected: ${hotReload.reason}`;
                warnings.push(hotReloadMessage);
            }
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            symbolName,
            occurrenceCount: occurrences.length,
            hotReload
        };
    }

    /**
     * Validate a batch of rename requests before planning edits.
     * Provides comprehensive validation feedback for multiple rename operations,
     * checking for conflicts between renames and ensuring batch consistency.
     *
     * @param {Array<{symbolId: string, newName: string}>} renames - Rename requests to validate
     * @param {Object} [options] - Validation options
     * @param {boolean} [options.includeHotReload=false] - Whether to check hot reload safety for each rename
     * @returns {Promise<{
     *   valid: boolean,
     *   errors: Array<string>,
     *   warnings: Array<string>,
     *   renameValidations: Map<string, ValidationSummary>,
     *   conflictingSets: Array<Array<string>>
     * }>} Aggregated validation results
     *
     * @example
     * const validation = await engine.validateBatchRenameRequest([
     *     { symbolId: "gml/script/scr_a", newName: "scr_x" },
     *     { symbolId: "gml/script/scr_b", newName: "scr_y" }
     * ]);
     *
     * if (!validation.valid) {
     *     console.error("Batch rename has errors:", validation.errors);
     *     for (const [symbolId, result] of validation.renameValidations) {
     *         if (!result.valid) {
     *             console.error(`  ${symbolId}:`, result.errors);
     *         }
     *     }
     * }
     */
    async validateBatchRenameRequest(
        renames: Array<RenameRequest>,
        options?: ValidateRenameRequestOptions
    ): Promise<BatchRenameValidation> {
        const errors: Array<string> = [];
        const warnings: Array<string> = [];
        const renameValidations = new Map<string, ValidationSummary>();
        const conflictingSets: Array<Array<string>> = [];

        // Validate input structure
        if (!Array.isArray(renames)) {
            errors.push("Batch rename requires an array of rename requests");
            return {
                valid: false,
                errors,
                warnings,
                renameValidations,
                conflictingSets
            };
        }

        if (renames.length === 0) {
            errors.push("Batch rename requires at least one rename request");
            return {
                valid: false,
                errors,
                warnings,
                renameValidations,
                conflictingSets
            };
        }

        // Validate each rename request individually
        await Core.runSequentially(renames, async (rename) => {
            if (!rename || typeof rename !== "object") {
                errors.push("Each rename must be a valid request object");
                return;
            }

            const { symbolId } = rename;
            if (!symbolId || typeof symbolId !== "string") {
                errors.push("Each rename must have a valid symbolId string property");
                return;
            }

            // Validate individual rename request
            const validation = await this.validateRenameRequest(rename, options);
            renameValidations.set(symbolId, validation);

            if (!validation.valid) {
                errors.push(`Rename validation failed for '${symbolId}': ${validation.errors.join(", ")}`);
            }

            if (validation.warnings.length > 0) {
                warnings.push(...validation.warnings.map((w) => `${symbolId}: ${w}`));
            }
        });

        // Detect duplicate symbol IDs in the batch. Renaming the same symbol more
        // than once creates ambiguous intent and would generate conflicting edits.
        for (const { symbolId, count } of detectDuplicateSourceSymbolIds(renames)) {
            errors.push(`Duplicate rename request for symbolId '${symbolId}' (${count} entries)`);
            conflictingSets.push(Array.from({ length: count }, () => symbolId));
        }

        // Detect duplicate target names across the batch. If multiple renames attempt
        // to use the same new name (e.g., renaming both `foo` and `bar` to `baz`),
        // we'd create ambiguous references. The check runs before applying any edits
        // so we can reject the entire batch early.
        for (const { newName, symbolIds } of detectDuplicateTargetNames(renames)) {
            errors.push(`Multiple symbols cannot be renamed to '${newName}': ${symbolIds.join(", ")}`);
            conflictingSets.push([...symbolIds]);
        }

        // Detect circular rename chains - filter out invalid renames first
        const validRenames = renames.filter(
            (rename) =>
                rename &&
                typeof rename === "object" &&
                rename.symbolId &&
                typeof rename.symbolId === "string" &&
                rename.newName &&
                typeof rename.newName === "string"
        );

        const circularChain = detectCircularRenames(validRenames);
        if (circularChain.length > 0) {
            const chain = circularChain.map((id) => extractSymbolName(id)).join(" → ");
            errors.push(`Circular rename chain detected: ${chain}. Cannot rename symbols in a cycle.`);
            conflictingSets.push(circularChain);
        }

        // Detect cross-rename name confusion: cases like renaming `foo→bar` and
        // `bar→baz` together, where the intermediate state would have two symbols
        // named `bar`. Not a cycle but still a temporal naming conflict.
        for (const { symbolId, newName } of detectCrossRenameNameConfusion(validRenames)) {
            warnings.push(
                `Rename introduces potential confusion: '${symbolId}' renamed to '${newName}' which was an original symbol name in this batch`
            );
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings,
            renameValidations,
            conflictingSets
        };
    }

    /**
     * Plan a rename refactoring for a symbol.
     * @param {Object} request - Rename request
     * @param {string} request.symbolId - Symbol to rename (e.g., "gml/script/scr_foo")
     * @param {string} request.newName - New name for the symbol
     * @returns {Promise<WorkspaceEdit>} Workspace edit with all necessary changes
     */
    async planRename(request: RenameRequest): Promise<WorkspaceEdit> {
        assertRenameRequest(request, "planRename");
        const { symbolId, newName } = request;

        const normalizedNewName = assertValidIdentifierName(newName);
        const cachedValidation = this.renameValidationCache.peek(symbolId, newName);
        const hasReusableValidation = cachedValidation?.valid === true;

        // Confirm the symbol exists in the semantic index before proceeding. This
        // prevents wasted work gathering occurrences for non-existent symbols and
        // provides a clear error message when the user mistypes a symbol name.
        if (!hasReusableValidation) {
            const exists = await this.validateSymbolExists(symbolId);
            if (!exists) {
                throw new Error(
                    `Symbol '${symbolId}' not found in semantic index. ` +
                        `Ensure the project has been analyzed before attempting renames.`
                );
            }
        }

        // Extract the symbol's base name from its fully-qualified ID by taking the
        // last path component. For example, "gml/script/scr_foo" becomes "scr_foo",
        // which we use to search for all occurrences in the codebase.
        const symbolName = cachedValidation?.symbolName ?? extractSymbolName(symbolId);

        if (symbolName === normalizedNewName) {
            throw new Error(`The new name '${normalizedNewName}' matches the existing identifier`);
        }

        // Collect all occurrences (definitions and references) of the symbol across
        // the workspace. This includes every location where the symbol appears, so
        // the rename operation can update all references simultaneously.
        const occurrences = await this.gatherSymbolOccurrences(symbolName, symbolId);

        // Detect potential conflicts (shadowing, reserved keywords, etc.) before
        // applying edits. If conflicts exist, we abort the rename to prevent
        // introducing scope errors or breaking existing code.
        if (!hasReusableValidation) {
            const conflicts = await detectRenameConflicts(
                symbolName,
                normalizedNewName,
                occurrences,
                this.semantic,
                this.semantic
            );

            if (conflicts.length > 0) {
                const messages = conflicts.map((c) => c.message).join("; ");
                throw new Error(`Cannot rename '${symbolName}' to '${normalizedNewName}': ${messages}`);
            }
        }

        // Populate a workspace with text edits for all occurrence spans, then
        // merge any extra structural edits (file renames, metadata rewrites) that
        // the semantic provider supplies for this symbol rename.
        const workspace = new WorkspaceEdit();
        populateWorkspaceWithOccurrenceEdits(workspace, occurrences, normalizedNewName);
        await mergeAdditionalSymbolEditsFromSemantic(workspace, this.semantic, symbolId, normalizedNewName);

        return dropRedundantTextEditsForMetadataRewrites(workspace);
    }

    /**
     * Validate a planned rename before applying it.
     * This performs a dry-run to detect conflicts.
     * @param {WorkspaceEdit} workspace - The planned edits
     * @returns {Promise<{valid: boolean, errors: Array<string>, warnings: Array<string>}>}
     */
    async validateRename(workspace: WorkspaceEdit): Promise<ValidationSummary> {
        const errors: Array<string> = [];
        const warnings: Array<string> = [];

        if (!workspace || !isWorkspaceEditLike(workspace)) {
            errors.push("Invalid workspace edit");
            return { valid: false, errors, warnings };
        }

        const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);
        const hasTextEdits = workspace.edits.length > 0;
        const hasMetadataEdits = metadataEdits.length > 0;
        const hasFileRenames = fileRenames.length > 0;

        if (!hasTextEdits && !hasMetadataEdits && !hasFileRenames) {
            errors.push("Workspace edit contains no changes");
            return { valid: false, errors, warnings };
        }

        // Organize edits by file path so we can validate that edits within the same
        // file don't overlap or conflict. Overlapping edits would produce ambiguous
        // results (which edit wins?) and likely indicate a logic error in the rename.
        const grouped: GroupedTextEdits = workspace.groupByFile();

        // Examine each file's edit list for overlapping ranges. Since edits are
        // sorted in descending order by start position, we can detect overlaps by
        // checking whether the next edit's end position exceeds the current edit's
        // start position. Overlaps indicate that two edits target overlapping or
        // adjacent text spans, which would corrupt the output if applied naively.
        for (const [filePath, edits] of grouped.entries()) {
            for (let i = 0; i < edits.length - 1; i++) {
                const current = edits[i];
                const next = edits[i + 1];

                if (next.end > current.start) {
                    errors.push(`Overlapping edits detected in ${filePath} at positions ${current.start}-${next.end}`);
                }
            }

            // Warn when a single file receives an unusually large number of edits,
            // which could indicate that the rename is broader than intended (e.g.,
            // renaming a common identifier like "i" across an entire project).
            if (edits.length > 50) {
                warnings.push(
                    `Large number of edits (${edits.length}) planned for ${filePath}. ` +
                        `Consider reviewing the scope of this refactoring.`
                );
            }
        }

        const metadataPaths = new Set<string>();
        for (const metadataEdit of metadataEdits) {
            if (!Core.isNonEmptyString(metadataEdit.path)) {
                errors.push("Metadata edit path must be a non-empty string");
                continue;
            }

            if (metadataPaths.has(metadataEdit.path)) {
                errors.push(`Duplicate metadata edit detected for ${metadataEdit.path}`);
                continue;
            }

            metadataPaths.add(metadataEdit.path);

            if (typeof metadataEdit.content !== "string") {
                errors.push(`Metadata edit content for ${metadataEdit.path} must be a string`);
            }
        }

        for (const metadataPath of metadataPaths) {
            if (grouped.has(metadataPath)) {
                errors.push(`Cannot combine text and metadata edits for ${metadataPath}`);
            }
        }

        errors.push(...validateFileRenameOperations(fileRenames));

        // If semantic analyzer is available, perform deeper validation
        const semantic = this.semantic;
        if (Core.hasMethods(semantic, "validateEdits")) {
            try {
                const semanticValidation = (await semantic.validateEdits(workspace)) ?? {};
                errors.push(...(semanticValidation.errors || []));
                warnings.push(...(semanticValidation.warnings || []));
            } catch (error) {
                warnings.push(
                    `Semantic validation failed: ${Core.getErrorMessage(error)}. Proceeding with basic validation only.`
                );
            }
        }

        const validationSummary = {
            valid: errors.length === 0,
            errors,
            warnings
        };

        if (validationSummary.valid) {
            rememberValidatedWorkspaceRevision(workspace);
        }

        return validationSummary;
    }

    /**
     * Apply workspace edits to files.
     * This method executes the planned changes, applying edits to source files.
     * @param {WorkspaceEdit} workspace - The edits to apply
     * @param {Object} options - Application options
     * @param {boolean} options.dryRun - If true, return modified content without writing files
     * @param {Function} options.readFile - Function to read file content (path) => string
     * @param {Function} options.writeFile - Function to write file content (path, content) => void
     * @returns {Promise<Map<string, string>>} Map of file paths to their new content
     */
    async applyWorkspaceEdit(
        workspace: WorkspaceEdit,
        options?: ApplyWorkspaceEditOptions
    ): Promise<Map<string, string>> {
        const opts: ApplyWorkspaceEditOptions = options ?? ({} as ApplyWorkspaceEditOptions);
        const { dryRun = false, includeResultContent = true, readFile, sourceTextByPath, writeFile } = opts;

        if (!workspace || !isWorkspaceEditLike(workspace)) {
            throw new TypeError("applyWorkspaceEdit requires a WorkspaceEdit");
        }

        Core.assertFunction(readFile, "readFile", {
            errorMessage: "applyWorkspaceEdit requires a readFile function"
        });

        if (!dryRun) {
            Core.assertFunction(writeFile, "writeFile", {
                errorMessage: "applyWorkspaceEdit (when not in dry-run mode) requires a writeFile function"
            });
        }

        // Verify the workspace edit is structurally sound and free of conflicts
        // before modifying any files. This prevents partial application of invalid
        // edits that could leave the codebase in an inconsistent state.
        if (!hasCurrentValidatedWorkspaceRevision(workspace)) {
            const validation = await this.validateRename(workspace);
            throwIfValidationFailed(validation, "Cannot apply workspace edit");
        }

        // Organize edits by file so we can process each file independently. This
        // allows us to load, edit, and save one file at a time, reducing memory
        // usage and preserving existing sequential read/write semantics.
        const grouped = workspace.groupByFile();
        const results = new Map<string, string>();

        const textEditResults = await Core.runInParallelWithLimit(
            grouped,
            async ([filePath, edits]) => {
                const originalContent = sourceTextByPath?.get(filePath) ?? (await readFile(filePath));
                const newContent = applyGroupedTextEditsToContent(originalContent, edits);

                // Write the modified content to disk unless we're in dry-run mode, which
                // lets callers preview changes before committing them.
                if (!dryRun && writeFile !== undefined) {
                    await writeFile(filePath, newContent);
                }

                return [filePath, includeResultContent ? newContent : ""] as const;
            },
            APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT
        );

        for (const [filePath, newContent] of textEditResults) {
            results.set(filePath, newContent);
        }

        const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);
        const metadataResults = await Core.runInParallelWithLimit(
            metadataEdits,
            async (metadataEdit) => {
                if (!dryRun && writeFile !== undefined) {
                    await writeFile(metadataEdit.path, metadataEdit.content);
                }

                return [metadataEdit.path, includeResultContent ? metadataEdit.content : ""] as const;
            },
            APPLY_WORKSPACE_EDIT_IO_CONCURRENCY_LIMIT
        );

        for (const [filePath, content] of metadataResults) {
            results.set(filePath, content);
        }

        // Process file renames last to ensure we don't move files before we're done
        // with their text edits. This stabilizes path references during the build phase.
        if (!dryRun && fileRenames.length > 0) {
            const { renameFile } = opts;
            if (typeof renameFile !== "function") {
                throw new TypeError("applyWorkspaceEdit requires a renameFile implementation to process file renames");
            }

            await Core.runSequentially(fileRenames, async (fileRename) => {
                await renameFile(fileRename.oldPath, fileRename.newPath);
            });
        }
        return results;
    }

    /**
     * Plan multiple rename operations that should be applied together.
     * This is useful for refactoring related symbols atomically.
     * @param {Array<{symbolId: string, newName: string}>} renames - Array of rename operations
     * @returns {Promise<WorkspaceEdit>} Combined workspace edit for all renames
     */
    private async planValidatedBatchRename(renames: Array<RenameRequest>): Promise<{
        validation: ValidationSummary;
        workspace: WorkspaceEdit;
    }> {
        Core.assertArray(renames, {
            errorMessage: "planBatchRename requires an array of renames"
        });

        if (renames.length === 0) {
            throw new Error("planBatchRename requires at least one rename");
        }

        // Validate that every individual rename request is structurally valid and
        // that the batch contains no duplicate source or target names. These checks
        // are delegated to focused helpers so the orchestration sequence stays
        // readable at a single abstraction level.
        assertBatchHasUniqueSymbolIds(renames);
        assertBatchHasUniqueTargetNames(renames);

        // Detect circular rename chains where symbol names form a cycle, such as
        // renaming A→B and B→A simultaneously. These chains create conflicts because
        // after applying the first rename, the second rename's source symbol no longer
        // exists by its original name, causing the batch operation to fail or produce
        // incorrect results. We detect cycles by building a directed graph of renames
        // and checking for strongly connected components.
        const circularChain = detectCircularRenames(renames);
        if (circularChain.length > 0) {
            const chain = circularChain.map((id) => extractSymbolName(id)).join(" → ");
            throw new Error(
                `Circular rename chain detected: ${chain}. ` +
                    `Cannot rename symbols in a cycle as it would create conflicts.`
            );
        }

        // Plan each rename independently and merge immediately to avoid retaining
        // every intermediate workspace in memory for large rename batches.
        const merged = new WorkspaceEdit();
        const metadataEditsByPath = new Map<string, string>();
        const semantic = this.semantic;
        const supportsBatchWorkspaceOverlay = semanticSupportsBatchWorkspaceOverlay(semantic);

        if (supportsBatchWorkspaceOverlay) {
            await semantic.clearWorkspaceOverlay();
        }

        try {
            await Core.runSequentially(renames, async (rename) => {
                const workspace = await this.planRename(rename);
                accumulateRenameWorkspace(merged, workspace, metadataEditsByPath);

                if (supportsBatchWorkspaceOverlay) {
                    await (semantic as any).stageWorkspaceEdit(workspace);
                    // Metadata overlays affect subsequent metadata planning, but
                    // they do not mutate the semantic source index itself. Keep
                    // the semantic query cache warm so large batch codemods can
                    // reuse symbol existence and occurrence lookups.
                }
            });
        } finally {
            if (supportsBatchWorkspaceOverlay) {
                await semantic.clearWorkspaceOverlay();
            }
        }

        // Metadata edits are keyed by file path so that later renames win over
        // earlier ones when multiple renames touch the same metadata file. Flush
        // the deduplicated map into the final workspace only after all individual
        // renames have been planned.
        flushDedupedMetadataEdits(merged, metadataEditsByPath);

        // Validate the merged result for overlapping edits
        const validation = await this.validateRename(merged);
        throwIfValidationFailed(validation, "Batch rename validation failed");

        return {
            validation,
            workspace: merged
        };
    }

    async planBatchRename(renames: Array<RenameRequest>): Promise<WorkspaceEdit> {
        const preparedBatchRename = await this.planValidatedBatchRename(renames);
        return preparedBatchRename.workspace;
    }

    /**
     * Execute a rename refactoring with optional hot reload integration.
     * This is a high-level method that combines planning, validation, application, and hot reload preparation.
     * @param {Object} request - Rename request
     * @param {string} request.symbolId - Symbol to rename
     * @param {string} request.newName - New name for the symbol
     * @param {Function} request.readFile - Function to read file content
     * @param {Function} request.writeFile - Function to write file content
     * @param {boolean} request.prepareHotReload - Whether to prepare hot reload updates
     * @returns {Promise<{workspace: WorkspaceEdit, applied: Map<string, string>, hotReloadUpdates: Array}>}
     */
    async executeRename(request: ExecuteRenameRequest): Promise<ExecuteRenameResult> {
        const {
            symbolId,
            newName,
            readFile,
            writeFile,
            includeResultContent = true,
            prepareHotReload = false
        } = request ?? ({} as ExecuteRenameRequest);

        assertRenameRequest({ symbolId, newName }, "executeRename");
        Core.assertFunction(readFile, "readFile", {
            errorMessage: "executeRename requires a readFile function"
        });
        Core.assertFunction(writeFile, "writeFile", {
            errorMessage: "executeRename requires a writeFile function"
        });

        // Plan the rename
        const workspace = await this.planRename({ symbolId, newName });

        // Validate the planned edits before touching the filesystem. This ensures
        // overlapping or otherwise invalid edits are caught early, preventing
        // partial writes that could leave the workspace in an inconsistent state.
        const validation = await this.validateRename(workspace);
        throwIfValidationFailed(validation, "Rename validation failed");

        // Apply the edits
        const applied = await this.applyWorkspaceEdit(workspace, {
            readFile,
            writeFile,
            includeResultContent,
            renameFile: request.renameFile,
            deleteFile: request.deleteFile,
            dryRun: false
        });
        this.renameValidationCache.invalidateAll();

        // Prepare hot reload updates if requested
        let hotReloadUpdates: Array<HotReloadUpdate> = [];
        if (prepareHotReload) {
            hotReloadUpdates = await this.prepareHotReloadUpdates(workspace);
        }

        return {
            workspace,
            applied,
            hotReloadUpdates,
            fileRenames: [...workspace.fileRenames]
        };
    }

    /**
     * Execute multiple renames atomically with optional hot reload integration.
     * @param {Object} request - Batch rename request
     * @param {Array<{symbolId: string, newName: string}>} request.renames - Rename operations
     * @param {Function} request.readFile - Function to read file content
     * @param {Function} request.writeFile - Function to write file content
     * @param {boolean} request.prepareHotReload - Whether to prepare hot reload updates
     * @returns {Promise<{workspace: WorkspaceEdit, applied: Map<string, string>, hotReloadUpdates: Array}>}
     */
    async executeBatchRename(request: ExecuteBatchRenameRequest): Promise<ExecuteRenameResult> {
        const {
            renames,
            readFile,
            writeFile,
            includeResultContent = true,
            prepareHotReload = false
        } = request ?? ({} as ExecuteBatchRenameRequest);

        Core.assertArray(renames, {
            errorMessage: "executeBatchRename requires renames array"
        });
        Core.assertFunction(readFile, "readFile", {
            errorMessage: "executeBatchRename requires a readFile function"
        });
        Core.assertFunction(writeFile, "writeFile", {
            errorMessage: "executeBatchRename requires a writeFile function"
        });

        // Plan the batch rename
        const workspace = await this.planBatchRename(renames);

        // Apply the edits
        const applied = await this.applyWorkspaceEdit(workspace, {
            readFile,
            writeFile,
            includeResultContent,
            renameFile: request.renameFile,
            deleteFile: request.deleteFile,
            dryRun: false
        });
        this.renameValidationCache.invalidateAll();

        // Prepare hot reload updates if requested
        let hotReloadUpdates: Array<HotReloadUpdate> = [];
        if (prepareHotReload) {
            hotReloadUpdates = await this.prepareHotReloadUpdates(workspace);
        }

        return {
            workspace,
            applied,
            hotReloadUpdates,
            fileRenames: [...workspace.fileRenames]
        };
    }

    /**
     * Execute the globalvar-to-global codemod across all provided files.
     *
     * The engine runs a **two-phase** strategy:
     *
     * Phase 1 (collection): scan every file to identify all `globalvar`-declared
     * names across the project.  A single name may appear in a declaration in one
     * file and as bare references in many others.
     *
     * Phase 2 (rewrite): for each file that either declares or references a
     * collected globalvar name, emit edits to remove declarations and replace bare
     * references with `global.<name>`.  All edits are accumulated into a single
     * `WorkspaceEdit` and applied atomically via `applyWorkspaceEdit`.
     */
    async executeGlobalvarToGlobalCodemod(
        request: ExecuteGlobalvarToGlobalCodemodRequest
    ): Promise<ExecuteGlobalvarToGlobalCodemodResult> {
        const { filePaths, readFile, writeFile, options, dryRun = false } = request ?? {};

        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            throw new TypeError("executeGlobalvarToGlobalCodemod requires a non-empty filePaths array");
        }

        Core.assertFunction(readFile, "readFile", {
            errorMessage: "executeGlobalvarToGlobalCodemod requires a readFile function"
        });

        const uniqueFilePaths = Core.uniqueArray(filePaths);

        // ── Phase 1: collect all globalvar names declared across the project ──
        // Read every file once and accumulate declared names into a shared set.
        // Uses the lightweight `collectGlobalvarDeclaredNames` helper which only
        // parses and scans for declarations, skipping all edit-generation work.
        const projectGlobalvarNames = new Set<string>();
        const fileContents = new Map<string, string>();

        await Core.runSequentially(uniqueFilePaths, async (filePath) => {
            Core.assertNonEmptyString(filePath, {
                errorMessage: "executeGlobalvarToGlobalCodemod file paths must be non-empty strings"
            });

            const sourceText = await readFile(filePath);
            fileContents.set(filePath, sourceText);

            // collectGlobalvarDeclaredNames already performs the fast-path keyword
            // check internally, so no duplicate guard is needed here.
            for (const name of collectGlobalvarDeclaredNames(sourceText)) {
                projectGlobalvarNames.add(name);
            }
        });

        if (projectGlobalvarNames.size === 0) {
            return {
                workspace: new WorkspaceEdit(),
                applied: new Map(),
                changedFiles: []
            };
        }

        // ── Phase 2: rewrite files that reference collected globalvar names ──
        const workspace = new WorkspaceEdit();
        const changedFiles: ExecuteGlobalvarToGlobalCodemodResult["changedFiles"] = [];

        await Core.runSequentially(uniqueFilePaths, async (filePath) => {
            const sourceText = fileContents.get(filePath) ?? (await readFile(filePath));
            const result = applyGlobalvarToGlobalCodemod(sourceText, projectGlobalvarNames, options);

            if (!result.changed) {
                return;
            }

            workspace.addEdit(filePath, 0, sourceText.length, result.outputText);
            changedFiles.push({
                path: filePath,
                appliedEditCount: result.appliedEdits.length,
                migratedNames: [...result.migratedNames]
            });
        });

        if (workspace.edits.length === 0) {
            return {
                workspace,
                applied: new Map(),
                changedFiles
            };
        }

        if (!dryRun) {
            Core.assertFunction(writeFile, "writeFile", {
                errorMessage: "executeGlobalvarToGlobalCodemod requires a writeFile function in write mode"
            });
        }

        const applied = await this.applyWorkspaceEdit(workspace, {
            readFile,
            sourceTextByPath: fileContents,
            writeFile,
            includeResultContent: dryRun,
            dryRun
        });

        return { workspace, applied, changedFiles };
    }

    /**
     * Execute the loop-length hoisting codemod across the provided files.
     *
     * The engine parses each file exactly once, collects all codemod rewrites into a
     * single workspace transaction, and applies them atomically via applyWorkspaceEdit.
     */
    async executeLoopLengthHoistingCodemod(
        request: ExecuteLoopLengthHoistingCodemodRequest
    ): Promise<ExecuteLoopLengthHoistingCodemodResult> {
        const { filePaths, readFile, writeFile, options, dryRun = false } = request ?? {};

        if (!Array.isArray(filePaths) || filePaths.length === 0) {
            throw new TypeError("executeLoopLengthHoistingCodemod requires a non-empty filePaths array");
        }

        Core.assertFunction(readFile, "readFile", {
            errorMessage: "executeLoopLengthHoistingCodemod requires a readFile function"
        });
        const uniqueFilePaths = Core.uniqueArray(filePaths);

        const workspace = new WorkspaceEdit();
        const sourceTextByPath = new Map<string, string>();
        const changedFiles: ExecuteLoopLengthHoistingCodemodResult["changedFiles"] = [];

        await Core.runSequentially(uniqueFilePaths, async (filePath) => {
            Core.assertNonEmptyString(filePath, {
                errorMessage: "executeLoopLengthHoistingCodemod file paths must be non-empty strings"
            });

            const sourceText = await readFile(filePath);
            sourceTextByPath.set(filePath, sourceText);
            const result = applyLoopLengthHoistingCodemod(sourceText, options);

            if (!result.changed) {
                return;
            }

            workspace.addEdit(filePath, 0, sourceText.length, result.outputText);
            changedFiles.push({
                path: filePath,
                appliedEditCount: result.appliedEdits.length,
                diagnosticOffsets: [...result.diagnosticOffsets]
            });
        });

        if (workspace.edits.length === 0) {
            return {
                workspace,
                applied: new Map(),
                changedFiles
            };
        }

        if (!dryRun) {
            Core.assertFunction(writeFile, "writeFile", {
                errorMessage: "executeLoopLengthHoistingCodemod requires a writeFile function"
            });
        }

        const applied = await this.applyWorkspaceEdit(workspace, {
            readFile,
            sourceTextByPath,
            writeFile,
            includeResultContent: dryRun,
            dryRun
        });

        return { workspace, applied, changedFiles };
    }

    /**
     * Plan naming-policy-driven edits for the selected project paths.
     */
    async planNamingConventionCodemod(parameters: {
        projectRoot: string;
        config: ConfiguredCodemodRunRequest["config"];
        targetPaths: Array<string>;
    }): Promise<NamingConventionCodemodPlan> {
        return await planNamingConventionCodemod(this, parameters);
    }

    /**
     * Execute codemods selected from normalized project configuration.
     *
     * Codemods run in a stable order and share an in-memory overlay so later
     * codemods observe edits produced by earlier ones during the same run.
     */
    async executeConfiguredCodemods(request: ConfiguredCodemodRunRequest): Promise<ConfiguredCodemodRunResult> {
        const {
            projectRoot,
            config,
            readFile,
            writeFile,
            dryRun = true,
            onlyCodemods = [],
            onTelemetry,
            dryRunOverlaySpillThresholdBytes = 4 * 1024 * 1024,
            dryRunOverlayReadCacheMaxEntries = 32,
            dryRunOverlayStorageBackend
        } = request;
        const targetPaths = Core.uniqueArray(request.targetPaths) as Array<string>;
        const gmlFilePaths = Core.uniqueArray(request.gmlFilePaths) as Array<string>;

        Core.assertNonEmptyString(projectRoot, {
            errorMessage: "executeConfiguredCodemods requires a projectRoot"
        });
        Core.assertFunction(readFile, "readFile", {
            errorMessage: "executeConfiguredCodemods requires a readFile function"
        });
        if (!dryRun) {
            Core.assertFunction(writeFile, "writeFile", {
                errorMessage: "executeConfiguredCodemods requires a writeFile function when dryRun is false"
            });
        }

        const requestedCodemods = new Set(onlyCodemods);
        const configuredCodemods = config.codemods ?? {};
        const useInMemoryOverlay = dryRun;
        const overlay = new Map<string, string>();
        const overlayByteSizeByPath = new Map<string, number>();
        const overlaySpillIndex = new Set<string>();
        const readThroughCache = new Map<string, string>();
        const appliedFiles = new Map<string, string>();
        let overlayBytes = 0;
        let overlayHighWaterBytes = 0;
        const startTime = process.hrtime.bigint();
        const spillThresholdBytes =
            typeof dryRunOverlaySpillThresholdBytes === "number" && Number.isFinite(dryRunOverlaySpillThresholdBytes)
                ? Math.max(0, Math.floor(dryRunOverlaySpillThresholdBytes))
                : 4 * 1024 * 1024;
        const spillBackend: StorageBackend | null =
            useInMemoryOverlay && spillThresholdBytes > 0
                ? (dryRunOverlayStorageBackend ??
                  createTempFileStorageBackend({ readCacheMaxEntries: dryRunOverlayReadCacheMaxEntries }))
                : null;

        const cacheReadThroughContent = (filePath: string, content: string): void => {
            // Maintain insertion order directly in the Map so we can evict the
            // oldest key without paying Array#shift()'s O(n) copy cost whenever
            // the read-through cache exceeds its entry limit.
            if (readThroughCache.has(filePath)) {
                readThroughCache.delete(filePath);
            }

            readThroughCache.set(filePath, content);

            while (readThroughCache.size > CODEMOD_READ_THROUGH_CACHE_MAX_ENTRIES) {
                const oldestEntry = readThroughCache.keys().next();
                if (oldestEntry.done) {
                    break;
                }

                readThroughCache.delete(oldestEntry.value);
            }
        };

        const spillEntryToBackend = async (filePath: string): Promise<void> => {
            if (!spillBackend) {
                return;
            }

            const inMemoryContent = overlay.get(filePath);
            if (inMemoryContent === undefined) {
                return;
            }

            await spillBackend.writeEntry(filePath, inMemoryContent);
            overlaySpillIndex.add(filePath);
            overlay.delete(filePath);
            const contentSize = overlayByteSizeByPath.get(filePath) ?? Buffer.byteLength(inMemoryContent, "utf8");
            overlayByteSizeByPath.delete(filePath);
            overlayBytes -= contentSize;
        };

        const enforceOverlayLimit = async (): Promise<void> => {
            if (!spillBackend || spillThresholdBytes <= 0) {
                return;
            }

            if (overlayBytes <= spillThresholdBytes) {
                return;
            }

            const pathsToSpill: Array<string> = [];
            let projectedBytes = overlayBytes;

            for (const [filePath, inMemoryContent] of overlay.entries()) {
                if (projectedBytes <= spillThresholdBytes) {
                    break;
                }

                pathsToSpill.push(filePath);
                const contentSize = overlayByteSizeByPath.get(filePath) ?? Buffer.byteLength(inMemoryContent, "utf8");
                projectedBytes -= contentSize;
            }

            await Core.runSequentially(pathsToSpill, spillEntryToBackend);
        };

        const recordOverlayValue = async (filePath: string, content: string): Promise<void> => {
            const previousContent = overlay.get(filePath);
            if (previousContent !== undefined) {
                const previousSize = overlayByteSizeByPath.get(filePath) ?? Buffer.byteLength(previousContent, "utf8");
                overlayByteSizeByPath.delete(filePath);
                overlayBytes -= previousSize;
            } else if (overlaySpillIndex.has(filePath) && spillBackend) {
                overlaySpillIndex.delete(filePath);
                await spillBackend.deleteEntry(filePath);
            }

            overlay.set(filePath, content);
            const contentSize = Buffer.byteLength(content, "utf8");
            overlayByteSizeByPath.set(filePath, contentSize);
            overlayBytes += contentSize;
            overlayHighWaterBytes = Math.max(overlayHighWaterBytes, overlayBytes);

            await enforceOverlayLimit();
        };

        const readThroughOverlay = async (filePath: string): Promise<string> => {
            if (useInMemoryOverlay && overlay.has(filePath)) {
                return overlay.get(filePath) ?? "";
            }

            if (useInMemoryOverlay && overlaySpillIndex.has(filePath) && spillBackend) {
                const spilledContent = await spillBackend.readEntry(filePath);
                if (typeof spilledContent === "string") {
                    cacheReadThroughContent(filePath, spilledContent);
                    return spilledContent;
                }

                overlaySpillIndex.delete(filePath);
            }

            const cachedContent = readThroughCache.get(filePath);
            if (cachedContent !== undefined) {
                return cachedContent;
            }

            const content = await readFile(filePath);
            cacheReadThroughContent(filePath, content);
            return content;
        };

        const writeWithOverlay = async (filePath: string, content: string): Promise<void> => {
            if (useInMemoryOverlay) {
                await recordOverlayValue(filePath, content);
                appliedFiles.set(filePath, content);
            } else {
                appliedFiles.set(filePath, "");
            }
            cacheReadThroughContent(filePath, content);

            if (!dryRun && writeFile) {
                await writeFile(filePath, content);
            }
        };

        try {
            const result = await executeRegisteredCodemods(this, {
                ...request,
                targetPaths,
                gmlFilePaths,
                config: {
                    ...request.config,
                    codemods: configuredCodemods
                },
                readFile: readThroughOverlay,
                writeFile: dryRun ? undefined : writeWithOverlay,
                dryRun,
                onlyCodemods: [...requestedCodemods]
            });

            await Core.runSequentially(result.appliedFiles.entries(), async ([filePath, content]) => {
                if (useInMemoryOverlay) {
                    await recordOverlayValue(filePath, content);
                    appliedFiles.set(filePath, content);
                } else {
                    appliedFiles.set(filePath, "");
                }
            });

            const backendStats = spillBackend?.getStats() ?? {
                writes: 0,
                reads: 0,
                cacheHits: 0,
                cacheMisses: 0,
                spilledEntries: 0
            };

            const telemetry: CodemodExecutionTelemetry = {
                queueCount: result.summaries.length,
                requestedCodemodCount: requestedCodemods.size,
                durationMs: Number(process.hrtime.bigint() - startTime) / 1_000_000,
                overlayEntryCount: overlay.size + overlaySpillIndex.size,
                overlayBytes,
                overlayHighWaterBytes,
                overlaySpillWrites: backendStats.writes,
                overlaySpilledEntries: backendStats.spilledEntries,
                overlayCacheHits: backendStats.cacheHits,
                overlayCacheMisses: backendStats.cacheMisses,
                appliedFileCount: appliedFiles.size
            };
            onTelemetry?.(telemetry);

            return {
                dryRun,
                summaries: result.summaries,
                appliedFiles,
                telemetry
            };
        } finally {
            await spillBackend?.dispose();
        }
    }

    /**
     * Prepare a rename plan with validation and optional hot reload checks.
     * Bundles the planning, validation, and impact analysis phases so callers
     * can present a complete preview before writing any files.
     *
     * @param {Object} request - Rename request forwarded to {@link planRename}.
     * @param {string} request.symbolId - Symbol identifier to rename.
     * @param {string} request.newName - Proposed new identifier name.
     * @param {Object} [options] - Additional validation controls.
     * @param {boolean} [options.validateHotReload=false] - Whether to perform hot reload compatibility checks.
     * @param {Object} [options.hotReloadOptions] - Options forwarded to {@link validateHotReloadCompatibility}.
     * @returns {Promise<{workspace: WorkspaceEdit, validation: {valid: boolean, errors: Array<string>, warnings: Array<string>}, hotReload: {valid: boolean, errors: Array<string>, warnings: Array<string>} | null, analysis: {valid: boolean, summary: Object, conflicts: Array, warnings: Array}}>} Aggregated rename plan data.
     */
    async prepareRenamePlan(request: RenameRequest, options?: PrepareRenamePlanOptions): Promise<RenamePlanSummary> {
        const opts = options ?? {};
        const { validateHotReload = false, hotReloadOptions: rawHotOptions } = opts;
        const hotReloadOptions: HotReloadValidationOptions = rawHotOptions ?? {};

        // Plan the rename to capture all edits up front.
        const workspace = await this.planRename(request);

        // Run structural validation so callers can surface blocking issues
        // without attempting to apply the edits.
        const validation = await this.validateRename(workspace);

        // Only perform the more expensive hot reload compatibility checks when
        // explicitly requested. This keeps the helper lightweight for callers
        // that only need static validation feedback.
        let hotReloadValidation: ValidationSummary | null = null;
        if (validateHotReload) {
            const safety = await this.checkHotReloadSafety(request);
            const compatibility = await this.validateHotReloadCompatibility(workspace, hotReloadOptions);

            const errors = [...compatibility.errors];
            const warnings = [...compatibility.warnings];

            if (!safety.safe) {
                const safetyMessage = safety.requiresRestart
                    ? `Hot reload requires restart: ${safety.reason}`
                    : `Hot reload limitations: ${safety.reason}`;

                warnings.push(safetyMessage);

                if (safety.requiresRestart) {
                    errors.push(safetyMessage);
                }
            }

            hotReloadValidation = {
                valid: compatibility.valid && safety.safe,
                errors,
                warnings,
                hotReload: safety
            };
        }

        // Provide an impact analysis snapshot so UIs can preview how many files
        // will change and whether dependent symbols need attention.
        const analysis = await this.analyzeRenameImpact(request);

        return {
            workspace,
            validation,
            hotReload: hotReloadValidation,
            analysis
        };
    }

    /**
     * Prepare a comprehensive batch rename plan with validation, impact analysis,
     * and hot reload metadata for multiple coordinated symbol renames.
     *
     * This method extends {@link prepareBatchRename} by bundling all validation,
     * impact analysis, and hot reload cascade computation into a single call,
     * providing a complete preview of the batch operation before any files are modified.
     *
     * Unlike {@link planBatchRename}, this method does not throw errors for invalid
     * renames; instead, it returns a comprehensive summary that includes all validation
     * errors, warnings, and partial results to help callers understand what would happen.
     *
     * @param {Array<{symbolId: string, newName: string}>} renames - Rename operations to plan
     * @param {Object} [options] - Additional validation controls
     * @param {boolean} [options.validateHotReload=false] - Whether to perform hot reload compatibility checks
     * @param {Object} [options.hotReloadOptions] - Options forwarded to {@link validateHotReloadCompatibility}
     * @returns {Promise<{
     *   workspace: WorkspaceEdit,
     *   validation: ValidationSummary,
     *   hotReload: ValidationSummary | null,
     *   batchValidation: BatchRenameValidation,
     *   impactAnalyses: Map<string, RenameImpactAnalysis>,
     *   cascadeResult: HotReloadCascadeResult | null
     * }>} Comprehensive batch rename plan
     *
     * @example
     * const plan = await engine.prepareBatchRenamePlan([
     *     { symbolId: "gml/script/scr_enemy_old", newName: "scr_enemy_new" },
     *     { symbolId: "gml/script/scr_helper_old", newName: "scr_helper_new" }
     * ], { validateHotReload: true });
     *
     * // Check batch-level conflicts
     * if (!plan.batchValidation.valid) {
     *     console.error("Batch validation failed:", plan.batchValidation.errors);
     *     for (const set of plan.batchValidation.conflictingSets) {
     *         console.error("Conflicting symbols:", set);
     *     }
     *     return;
     * }
     *
     * // Review hot reload cascade to see all affected symbols
     * if (plan.cascadeResult) {
     *     console.log(`Total symbols to reload: ${plan.cascadeResult.metadata.totalSymbols}`);
     *     console.log(`Max dependency distance: ${plan.cascadeResult.metadata.maxDistance}`);
     *     if (plan.cascadeResult.metadata.hasCircular) {
     *         console.warn("Circular dependencies detected:");
     *         for (const cycle of plan.cascadeResult.circular) {
     *             console.warn("  Cycle:", cycle.join(" → "));
     *         }
     *     }
     * }
     *
     * // Review per-rename impact
     * for (const [symbolId, analysis] of plan.impactAnalyses) {
     *     console.log(`${symbolId}:`);
     *     console.log(`  Files affected: ${analysis.summary.affectedFiles.length}`);
     *     console.log(`  Occurrences: ${analysis.summary.totalOccurrences}`);
     *     if (analysis.conflicts.length > 0) {
     *         console.warn("  Conflicts:", analysis.conflicts);
     *     }
     * }
     */
    async prepareBatchRenamePlan(
        renames: Array<RenameRequest>,
        options?: PrepareBatchRenamePlanOptions
    ): Promise<BatchRenamePlanSummary> {
        const opts = options ?? {};
        const {
            validateHotReload = false,
            hotReloadOptions: rawHotOptions,
            includeImpactAnalyses = true,
            batchValidation: providedBatchValidation
        } = opts;
        const hotReloadOptions: HotReloadValidationOptions = rawHotOptions ?? {};

        // Validate the batch structure and individual renames up front, detecting
        // conflicts like duplicate target names or circular rename chains before
        // planning any workspace edits. This prevents wasted work when the batch
        // is malformed.
        const batchValidation =
            providedBatchValidation ??
            (await this.validateBatchRenameRequest(renames, {
                includeHotReload: validateHotReload
            }));

        // Try to plan the batch rename to capture all edits across all symbols in a
        // single merged workspace edit. If planning fails (e.g., due to conflicts),
        // we'll still return validation results to show the caller what went wrong.
        let workspace: WorkspaceEdit;
        let validation: ValidationSummary;
        let hotReloadValidation: ValidationSummary | null = null;
        let planningSucceeded = false;

        try {
            const preparedBatchRename = await this.planValidatedBatchRename(renames);
            workspace = preparedBatchRename.workspace;
            validation = preparedBatchRename.validation;
            planningSucceeded = true;

            // Perform hot reload compatibility checks if requested
            if (validateHotReload) {
                const compatibility = await this.validateHotReloadCompatibility(workspace, hotReloadOptions);
                hotReloadValidation = {
                    valid: compatibility.valid,
                    errors: [...compatibility.errors],
                    warnings: [...compatibility.warnings]
                };
            }
        } catch (error) {
            // Planning failed, create an empty workspace and record the error
            workspace = new WorkspaceEdit();
            validation = {
                valid: false,
                errors: [`Planning failed: ${Core.getErrorMessage(error)}`],
                warnings: []
            };

            // Initialize hot reload validation with the error if requested
            if (validateHotReload) {
                hotReloadValidation = {
                    valid: false,
                    errors: [`Cannot validate hot reload: ${Core.getErrorMessage(error)}`],
                    warnings: []
                };
            }
        }

        // Analyze the impact of each individual rename so callers can show
        // per-symbol statistics (files affected, occurrence counts, conflicts).
        const impactAnalyses = new Map<string, RenameImpactAnalysis>();
        if (includeImpactAnalyses) {
            await Core.runSequentially(renames, async (rename) => {
                try {
                    const analysis = await this.analyzeRenameImpact(rename);
                    impactAnalyses.set(rename.symbolId, analysis);
                } catch (error) {
                    // If analysis fails for one rename, record a minimal error result
                    // so the caller still receives feedback about what went wrong.
                    impactAnalyses.set(rename.symbolId, {
                        valid: false,
                        summary: {
                            symbolId: rename.symbolId,
                            oldName: extractSymbolName(rename.symbolId),
                            newName: rename.newName,
                            affectedFiles: [],
                            totalOccurrences: 0,
                            definitionCount: 0,
                            referenceCount: 0,
                            hotReloadRequired: false,
                            dependentSymbols: []
                        },
                        conflicts: [
                            {
                                type: ConflictType.ANALYSIS_ERROR,
                                message: `Failed to analyze ${rename.symbolId}: ${Core.getErrorMessage(error)}`
                            }
                        ],
                        warnings: []
                    });
                }
            });
        }

        // Compute the full hot reload dependency cascade for all changed symbols
        // to determine which other symbols need reloading and in what order.
        // Only compute if hot reload validation was requested and planning succeeded.
        let cascadeResult: HotReloadCascadeResult | null = null;
        if (validateHotReload && planningSucceeded) {
            const changedSymbolIds = renames.map((r) => r.symbolId);
            try {
                cascadeResult = await this.computeHotReloadCascade(changedSymbolIds);
            } catch (error) {
                // If cascade computation fails, add a warning to the hot reload
                // validation instead of failing the entire batch plan.
                if (hotReloadValidation) {
                    hotReloadValidation.warnings.push(
                        `Failed to compute hot reload cascade: ${Core.getErrorMessage(error)}`
                    );
                }
            }
        }

        return {
            workspace,
            validation,
            hotReload: hotReloadValidation,
            batchValidation,
            impactAnalyses,
            cascadeResult
        };
    }

    /**
     * Validate that workspace edits won't break hot reload functionality.
     * Checks for issues that could prevent patches from being applied correctly.
     * @param {WorkspaceEdit} workspace - The workspace edit to validate
     * @param {Object} options - Validation options
     * @param {boolean} options.checkTranspiler - Whether to validate transpiler compatibility
     * @param {Function} [options.readFile] - Optional reader for file contents when validating transpiler output
     * @returns {Promise<{valid: boolean, errors: Array<string>, warnings: Array<string>}>}
     */
    async validateHotReloadCompatibility(
        workspace: WorkspaceEdit,
        options?: HotReloadValidationOptions
    ): Promise<ValidationSummary> {
        const opts = options ?? {};
        const { checkTranspiler = false, readFile } = opts;
        const errors: Array<string> = [];
        const warnings: Array<string> = [];

        if (!workspace || !isWorkspaceEditLike(workspace)) {
            errors.push("Invalid workspace edit");
            return { valid: false, errors, warnings };
        }

        const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);
        const hasTextEdits = workspace.edits.length > 0;
        const hasMetadataEdits = metadataEdits.length > 0;
        const hasFileRenames = fileRenames.length > 0;

        if (!hasTextEdits && !hasMetadataEdits && !hasFileRenames) {
            warnings.push("Workspace edit contains no changes - hot reload not needed");
            return { valid: true, errors, warnings };
        }

        if (!hasTextEdits && hasMetadataEdits) {
            warnings.push("Workspace edit contains metadata-only changes - hot reload patching not required");
            return { valid: true, errors, warnings };
        }

        // Group edits by file
        const grouped = workspace.groupByFile();

        // Check each file for hot reload compatibility. Hot reload allows updating
        // running code without restarting the entire application, but only when the
        // changes don't break assumptions that the runtime depends on (e.g., function
        // signatures, global state structure). We iterate through each modified file
        // and validate that the proposed edits can be safely applied at runtime. If
        // any file contains unsafe changes (e.g., renaming a constructor, changing
        // event handlers), we flag it so the user knows a full restart is required
        // instead of attempting a hot reload that would corrupt the running state.
        for (const [filePath, edits] of grouped.entries()) {
            // Validate file is a GML script (hot reloadable)
            if (!filePath.endsWith(".gml")) {
                warnings.push(`File ${filePath} is not a GML script - hot reload may not apply`);
            }

            // Examine each edit to detect whether it introduces language constructs
            // that GameMaker's runtime can't hot-reload safely. Global variables,
            // macros, and enums affect compile-time state or global scope, so
            // modifying them typically requires restarting the game to ensure the
            // runtime re-initializes these declarations with updated values.
            for (const edit of edits) {
                if (edit.newText.includes("globalvar")) {
                    warnings.push(`Edit in ${filePath} introduces 'globalvar' - may require full reload`);
                }

                if (edit.newText.includes("#macro")) {
                    warnings.push(`Edit in ${filePath} introduces '#macro' - may require full reload`);
                }

                if (edit.newText.includes("enum ")) {
                    warnings.push(`Edit in ${filePath} introduces 'enum' - may require full reload`);
                }
            }

            // Measure the total size of the replacement text across all edits to
            // identify large-scale changes. Edits that introduce thousands of
            // characters likely represent substantial rewrites (e.g., refactoring an
            // entire function body), which may confuse GameMaker's hot-reload engine
            // and benefit from a full restart to ensure clean initialization.
            const totalCharsChanged = edits.reduce((sum, e) => sum + e.newText.length, 0);
            if (totalCharsChanged > 5000) {
                warnings.push(`Large edit in ${filePath} (${totalCharsChanged} characters) - consider full reload`);
            }
        }

        // If transpiler check is requested, validate transpilation will work
        if (checkTranspiler && Core.hasMethods(this.formatter, "transpileScript")) {
            const transpilerValidation = await this.validateTranspilerCompatibility(workspace, readFile);
            errors.push(...transpilerValidation.errors);
            warnings.push(...transpilerValidation.warnings);
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate that modified symbols can be successfully transpiled.
     * This ensures hot reload patches can be generated without errors.
     * @internal
     */
    private async validateTranspilerCompatibility(
        workspace: WorkspaceEdit,
        readFile?: WorkspaceReadFile
    ): Promise<{
        errors: Array<string>;
        warnings: Array<string>;
    }> {
        const errors: Array<string> = [];
        const warnings: Array<string> = [];

        if (!Core.hasMethods(this.formatter, "transpileScript")) {
            warnings.push("No transpiler available - cannot validate transpilation compatibility");
            return { errors, warnings };
        }

        const grouped = workspace.groupByFile();
        let validatedFiles = 0;
        let validatedSymbols = 0;

        await Core.runSequentially(grouped.entries(), async ([filePath, edits]) => {
            // Only validate GML files that can be transpiled
            if (!filePath.endsWith(".gml")) {
                return;
            }

            // Get symbols defined in this file
            let symbolsInFile: Array<{ id: string }> = [];
            if (Core.hasMethods(this.semantic, "getFileSymbols")) {
                try {
                    symbolsInFile = await this.semantic.getFileSymbols(filePath);
                } catch (error) {
                    warnings.push(`Could not query symbols for ${filePath}: ${Core.getErrorMessage(error)}`);
                    return;
                }
            }

            // If we don't have symbol information, create a generic symbol ID from the file path
            if (symbolsInFile.length === 0) {
                const fileName =
                    filePath
                        .split("/")
                        .pop()
                        ?.replace(/\.gml$/, "") ?? "unknown";
                symbolsInFile = [{ id: `gml/script/${fileName}` }];
            }

            // Apply edits to reconstruct the modified file content
            let modifiedContent: string;
            try {
                const originalContent = readFile ? await readFile(filePath) : "";
                modifiedContent = this.applyEditsToContent(originalContent, edits);
            } catch (error) {
                errors.push(`Failed to apply edits to ${filePath}: ${Core.getErrorMessage(error)}`);
                return;
            }

            // Validate each symbol can be transpiled with the modified content
            await Core.runSequentially(symbolsInFile, async (symbol) => {
                try {
                    await this.formatter.transpileScript({
                        sourceText: modifiedContent,
                        symbolId: symbol.id
                    });
                    validatedSymbols++;
                } catch (error) {
                    const errorMessage = Core.getErrorMessage(error);
                    errors.push(`Transpilation failed for ${symbol.id} in ${filePath}: ${errorMessage}`);
                }
            });

            validatedFiles++;
        });

        // Add informational message about transpiler validation status
        if (validatedFiles > 0 && errors.length === 0) {
            warnings.push(
                `Transpiler compatibility validated for ${validatedSymbols} symbol(s) in ${validatedFiles} file(s)`
            );
        } else if (validatedFiles === 0) {
            warnings.push("No GML files found for transpiler compatibility validation");
        }

        return { errors, warnings };
    }

    /**
     * Apply a series of text edits to source content.
     * Edits must be sorted in descending order by start position.
     * @internal
     */
    private applyEditsToContent(
        originalContent: string,
        edits: Array<Pick<TextEdit, "start" | "end" | "newText">>
    ): string {
        let content = originalContent;

        // Edits are already sorted descending by groupByFile()
        for (const edit of edits) {
            const before = content.slice(0, Math.max(0, edit.start));
            const after = content.slice(Math.max(0, edit.end));
            content = before + edit.newText + after;
        }

        return content;
    }

    /**
     * Prepare integration data for hot reload after a refactor.
     * Analyzes changed files to determine which symbols need recompilation.
     * @param {WorkspaceEdit} workspace - Applied edits
     * @returns {Promise<Array<{symbolId: string, action: string, filePath: string, affectedRanges: Array<{start: number, end: number}>}>>}
     */
    /**
     * Prepare hot reload updates from a workspace edit.
     */
    async prepareHotReloadUpdates(workspace: WorkspaceEdit): Promise<Array<HotReloadUpdate>> {
        return await HotReload.prepareHotReloadUpdates(workspace, this.semantic);
    }

    /**
     * Analyze the impact of a planned rename without applying it.
     * Provides detailed information about what will be changed.
     * @param {Object} request - Analysis request
     * @param {string} request.symbolId - Symbol to analyze
     * @param {string} request.newName - Proposed new name
     * @returns {Promise<{valid: boolean, summary: Object, conflicts: Array, warnings: Array}>}
     */
    async analyzeRenameImpact(request: RenameRequest): Promise<RenameImpactAnalysis> {
        assertRenameRequest(request, "analyzeRenameImpact");
        const { symbolId, newName } = request;

        const normalizedNewName = assertValidIdentifierName(newName);

        const oldName = extractSymbolName(symbolId);
        const summary = {
            symbolId,
            oldName,
            newName: normalizedNewName,
            affectedFiles: new Set<string>(),
            totalOccurrences: 0,
            definitionCount: 0,
            referenceCount: 0,
            hotReloadRequired: false,
            dependentSymbols: new Set<string>()
        };

        const serializeSummary = () => ({
            symbolId: summary.symbolId,
            oldName: summary.oldName,
            newName: summary.newName,
            affectedFiles: Array.from(summary.affectedFiles),
            totalOccurrences: summary.totalOccurrences,
            definitionCount: summary.definitionCount,
            referenceCount: summary.referenceCount,
            hotReloadRequired: summary.hotReloadRequired,
            dependentSymbols: Array.from(summary.dependentSymbols)
        });

        const conflicts: Array<ConflictEntry> = [];
        const warnings: Array<ConflictEntry> = [];
        let totalOccurrences = 0;
        let hotReloadRequired = false;

        try {
            // Validate symbol exists
            const exists = await this.validateSymbolExists(symbolId);
            if (!exists) {
                conflicts.push({
                    type: ConflictType.MISSING_SYMBOL,
                    message: `Symbol '${symbolId}' not found in semantic index`,
                    severity: "error"
                });
                return {
                    valid: false,
                    summary: serializeSummary(),
                    conflicts,
                    warnings
                };
            }

            // Gather occurrences
            const occurrences = await this.gatherSymbolOccurrences(summary.oldName, symbolId);
            totalOccurrences = occurrences.length;

            // Record which files will be modified by this rename so the user can
            // review the scope before applying changes. We also categorize each
            // occurrence as either a definition (where the symbol is declared) or a
            // reference (where it's used), giving insight into the symbol's role.
            for (const occ of occurrences) {
                summary.affectedFiles.add(occ.path);
                if (occ.kind === OccurrenceKind.DEFINITION) {
                    summary.definitionCount++;
                } else {
                    summary.referenceCount++;
                }
            }

            // Test for potential rename conflicts (shadowing, reserved keywords) that
            // would break the code if applied. We collect all conflicts across all
            // renames in the batch so the user can see the complete picture before
            // deciding whether to proceed or adjust the new names.
            const detectedConflicts = await detectRenameConflicts(
                summary.oldName,
                normalizedNewName,
                occurrences,
                this.semantic,
                this.semantic
            );
            conflicts.push(...detectedConflicts);

            // Determine whether the GameMaker runtime can hot-reload these changes
            // without a full restart. If occurrences exist, we assume hot reload is
            // needed and query the semantic analyzer to identify dependent symbols
            // that also need reloading to maintain consistency.
            if (totalOccurrences > 0) {
                hotReloadRequired = true;

                if (Core.hasMethods(this.semantic, "getDependents")) {
                    const dependents = (await this.semantic.getDependents([symbolId])) ?? [];
                    for (const dep of dependents) {
                        summary.dependentSymbols.add(dep.symbolId);
                    }
                }
            }

            // Alert the user when a rename affects many occurrences or has widespread
            // dependencies. Large-scale renames increase the risk of unintended
            // side effects (e.g., renaming a common utility function breaks dozens of
            // call sites), so these warnings encourage the user to review the scope.
            if (totalOccurrences > 50) {
                warnings.push({
                    type: ConflictType.LARGE_RENAME,
                    message: `This rename will affect ${totalOccurrences} occurrences across ${summary.affectedFiles.size} files`,
                    severity: "warning"
                });
            }

            if (summary.dependentSymbols.size > 10) {
                warnings.push({
                    type: ConflictType.MANY_DEPENDENTS,
                    message: `${summary.dependentSymbols.size} other symbols depend on this symbol`,
                    severity: "info"
                });
            }
        } catch (error) {
            conflicts.push({
                type: ConflictType.ANALYSIS_ERROR,
                message: `Failed to analyze impact: ${Core.getErrorMessage(error)}`,
                severity: "error"
            });
        }

        summary.totalOccurrences = totalOccurrences;
        summary.hotReloadRequired = hotReloadRequired;

        const serializedSummary = serializeSummary();

        return {
            valid: conflicts.length === 0,
            summary: serializedSummary,
            conflicts,
            warnings
        };
    }

    /**
     * Compute the full dependency cascade for hot reload operations.
     * Takes a set of changed symbols and computes all transitive dependents
     * that need to be reloaded, ordered for safe application.
     */
    async computeHotReloadCascade(changedSymbolIds: Array<string>): Promise<HotReloadCascadeResult> {
        return await HotReload.computeHotReloadCascade(changedSymbolIds, this.semantic);
    }

    /**
     * Check whether a rename operation is safe for hot reload.
     */
    async checkHotReloadSafety(request: RenameRequest): Promise<HotReloadSafetySummary> {
        return await HotReload.checkHotReloadSafety(request, this.semantic);
    }

    /**
     * Compute a detailed dependency impact graph for a rename operation.
     * This provides visualization-ready data showing how a rename will propagate
     * through the dependency graph, essential for hot reload planning and
     * understanding the full scope of changes.
     *
     * @param symbolId - The symbol being renamed
     * @returns Impact graph with nodes, edges, critical path, and timing estimates
     *
     * @example
     * const graph = await engine.computeRenameImpactGraph("gml/script/scr_base");
     * console.log(`Rename will affect ${graph.totalAffectedSymbols} symbols`);
     * console.log(`Critical path depth: ${graph.maxDepth}`);
     * console.log(`Critical path: ${graph.criticalPath.join(" → ")}`);
     * console.log(`Estimated reload time: ${graph.estimatedTotalReloadTime}ms`);
     *
     * // Visualize the dependency graph
     * for (const [id, node] of graph.nodes) {
     *     console.log(`${node.symbolName} (distance: ${node.distance})`);
     *     if (node.dependents.length > 0) {
     *         console.log(`  Dependents: ${node.dependents.join(", ")}`);
     *     }
     * }
     */
    async computeRenameImpactGraph(symbolId: string): Promise<RenameImpactGraph> {
        return await HotReload.computeRenameImpactGraph(symbolId, this.semantic);
    }

    /**
     * Verify semantic integrity after applying edits.
     * This validates that renamed symbols still resolve correctly and no accidental
     * shadowing or scope capture occurred. Essential for ensuring hot reload safety.
     *
     * Usage pattern:
     * 1. Plan rename with planRename()
     * 2. Apply edits with applyWorkspaceEdit()
     * 3. Verify integrity with verifyPostEditIntegrity()
     * 4. If validation fails, the caller can revert or report errors
     *
     * @param {Object} request - Verification request
     * @param {string} request.symbolId - The symbol that was renamed
     * @param {string} request.oldName - Original symbol name
     * @param {string} request.newName - New symbol name
     * @param {WorkspaceEdit} request.workspace - The applied workspace edit
     * @param {Function} request.readFile - Function to read file contents after edits
     * @returns {Promise<{valid: boolean, errors: Array<string>, warnings: Array<string>}>}
     */
    async verifyPostEditIntegrity(request: {
        symbolId: string;
        oldName: string;
        newName: string;
        workspace: WorkspaceEdit;
        readFile: WorkspaceReadFile;
    }): Promise<ValidationSummary> {
        const { symbolId, oldName, newName, workspace, readFile } = request;
        const errors: Array<string> = [];
        const warnings: Array<string> = [];

        // Validate inputs - check both existence and type
        if (!Core.isNonEmptyTrimmedString(symbolId)) {
            errors.push("Invalid symbolId");
            return { valid: false, errors, warnings };
        }

        if (!Core.isNonEmptyTrimmedString(oldName)) {
            errors.push("Invalid oldName");
            return { valid: false, errors, warnings };
        }

        if (!Core.isNonEmptyTrimmedString(newName)) {
            errors.push("Invalid newName");
            return { valid: false, errors, warnings };
        }

        if (!workspace || !isWorkspaceEditLike(workspace)) {
            errors.push("Invalid workspace edit");
            return { valid: false, errors, warnings };
        }

        if (!readFile || typeof readFile !== "function") {
            errors.push("Invalid readFile function");
            return { valid: false, errors, warnings };
        }

        // Group edits by file to process each affected file once
        const grouped = workspace.groupByFile();
        const affectedFiles = Array.from(grouped.keys());

        // Perform basic file content checks regardless of semantic analyzer availability
        // These catch obvious issues like lingering old names or missing new names

        // Verify the old name no longer exists in edited files
        await Core.runSequentially(affectedFiles, async (filePath) => {
            let content: string;
            try {
                content = await readFile(filePath);
            } catch (error) {
                errors.push(`Failed to read ${filePath} for post-edit validation: ${Core.getErrorMessage(error)}`);
                return;
            }

            // Simple heuristic: check if the old name still appears as an identifier
            // This is a basic check - full validation would require re-parsing
            const identifierPattern = new RegExp(String.raw`\b${Core.escapeRegExp(oldName)}\b`, "g");
            const oldNameMatches = content.match(identifierPattern);

            if (oldNameMatches && oldNameMatches.length > 0) {
                // Check if these are in comments by examining each line
                let allInComments = true;
                const lines = content.split("\n");
                for (const line of lines) {
                    if (line.includes(oldName)) {
                        const trimmed = line.trim();
                        // Check if line is a comment or if oldName appears after //
                        const commentIndex = line.indexOf("//");
                        const oldNameIndex = line.indexOf(oldName);
                        const isInLineComment = commentIndex !== -1 && commentIndex < oldNameIndex;
                        const isCommentLine = trimmed.startsWith("//");
                        const isInBlockComment = line.includes("/*") || line.includes("*/");

                        if (!isCommentLine && !isInLineComment && !isInBlockComment) {
                            allInComments = false;
                            break;
                        }
                    }
                }

                if (allInComments) {
                    warnings.push(
                        `Old name '${oldName}' still appears in comments in ${filePath} - may need manual update`
                    );
                } else {
                    errors.push(
                        `Old name '${oldName}' still exists in ${filePath} after rename - edits may be incomplete`
                    );
                }
            }

            // Verify the new name appears in the file
            const newIdentifierPattern = new RegExp(String.raw`\b${Core.escapeRegExp(newName)}\b`, "g");
            const newNameMatches = content.match(newIdentifierPattern);

            if (!newNameMatches || newNameMatches.length === 0) {
                warnings.push(`New name '${newName}' does not appear in ${filePath} - verify edits were applied`);
            }
        });

        // Use semantic analyzer to check for new conflicts or shadowing
        if (Core.hasMethods(this.semantic, "getSymbolOccurrences")) {
            try {
                // Query occurrences of the new name to detect any potential conflicts
                const newOccurrences = await this.semantic.getSymbolOccurrences(newName, null);

                // Look for occurrences outside our edited files - these could be conflicts
                const unexpectedOccurrences = newOccurrences.filter((occ) => !affectedFiles.includes(occ.path));

                if (unexpectedOccurrences.length > 0) {
                    const conflictPaths = Core.uniqueArray(unexpectedOccurrences.map((o) => o.path)) as Array<string>;
                    warnings.push(
                        `New name '${newName}' already exists in ${conflictPaths.length} other file(s): ${conflictPaths.join(", ")} - verify no shadowing occurred`
                    );
                }
            } catch (error) {
                warnings.push(`Could not verify occurrences of new name: ${Core.getErrorMessage(error)}`);
            }
        }

        // Use semantic analyzer to check for reserved keyword violations
        if (Core.hasMethods(this.semantic, "getReservedKeywords")) {
            try {
                const keywords = await this.semantic.getReservedKeywords();
                if (keywords.includes(newName.toLowerCase())) {
                    errors.push(`New name '${newName}' conflicts with reserved keyword`);
                }
            } catch (error) {
                warnings.push(`Could not verify reserved keywords: ${Core.getErrorMessage(error)}`);
            }
        }

        // If parser is available, we could re-parse files and verify binding integrity
        // This is more expensive but provides the strongest guarantee
        if (Core.hasMethods(this.parser, "parse")) {
            await Core.runSequentially(affectedFiles, async (filePath) => {
                try {
                    // Attempt to parse the file to ensure syntax is still valid
                    await this.parser.parse(filePath);
                } catch (parseError) {
                    errors.push(
                        `Parse error in ${filePath} after rename: ${Core.getErrorMessage(parseError)} - edits may have broken syntax`
                    );
                }
            });
        }

        // Warn if no semantic analyzer for deeper validation
        if (!this.semantic) {
            warnings.push("No semantic analyzer available - skipping deep semantic validation");
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Integrate refactor results with the transpiler for hot reload.
     * Takes hot reload updates and generates transpiled patches.
     */
    async generateTranspilerPatches(
        hotReloadUpdates: Array<HotReloadUpdate>,
        readFile: WorkspaceReadFile
    ): Promise<Array<TranspilerPatch>> {
        return await HotReload.generateTranspilerPatches(hotReloadUpdates, readFile, this.formatter);
    }

    /**
     * Detect conflicts for a proposed rename operation.
     * This method provides low-level conflict detection without throwing errors,
     * making it ideal for IDE integrations that need to show inline warnings
     * or CLI tools that want to preview potential issues before planning edits.
     */
    async detectRenameConflicts(request: {
        oldName: string;
        newName: string;
        occurrences: Array<SymbolOccurrence>;
    }): Promise<Array<ConflictEntry>> {
        const { oldName, newName, occurrences } = request ?? {};

        Core.assertNonEmptyString(oldName, {
            errorMessage: "detectRenameConflicts requires oldName as a non-empty string"
        });
        Core.assertNonEmptyString(newName, {
            errorMessage: "detectRenameConflicts requires newName as a non-empty string"
        });
        Core.assertArray(occurrences, {
            errorMessage: "detectRenameConflicts requires occurrences as an array"
        });

        // Pass semantic analyzer twice: once as SymbolResolver for scope lookups,
        // once as KeywordProvider for reserved keyword checks. The SemanticAnalyzer
        // interface supports both roles through optional method implementations.
        return await detectRenameConflicts(oldName, newName, occurrences, this.semantic, this.semantic);
    }

    /**
     * Plan renames for Feather quick fixes.
     * Checks if the replacement name is safe and if edits are contained within the file.
     */
    async planFeatherRenames(
        requests: ReadonlyArray<{ identifierName: string; preferredReplacementName: string }>,
        filePath: string | null,
        projectRoot: string
    ): Promise<
        Array<{
            identifierName: string;
            mode: "local-fallback" | "project-aware";
            preferredReplacementName: string;
            replacementName: string | null;
            skipReason?: string;
        }>
    > {
        return await this.projectAnalysisProvider.planFeatherRenames(requests, filePath, projectRoot, {
            semantic: this.semantic,
            prepareRenamePlan: async (request, options) => await this.prepareRenamePlan(request, options)
        });
    }

    /**
     * Assess whether a global variable rewrite is safe/allowed.
     */
    assessGlobalVarRewrite(
        filePath: string | null,
        hasInitializer: boolean
    ): {
        allowRewrite: boolean;
        initializerMode: "existing" | "undefined";
        mode: "project-aware";
    } {
        return this.projectAnalysisProvider.assessGlobalVarRewrite(filePath, hasInitializer);
    }

    /**
     * Resolve identifier for loop hoisting.
     */
    resolveLoopHoistIdentifier(preferredName: string): {
        identifierName: string;
        mode: "project-aware";
    } {
        return this.projectAnalysisProvider.resolveLoopHoistIdentifier(preferredName);
    }

    /**
     * Invalidate semantic cache for a specific file.
     * Call this when a file changes during hot reload to ensure fresh semantic data.
     */
    invalidateSemanticCacheForFile(filePath: string): void {
        this.semanticCache.invalidateFile(filePath);
    }

    /**
     * Invalidate all semantic cache entries.
     * Call this when starting a new refactoring session or after major changes.
     */
    invalidateAllSemanticCache(): void {
        this.semanticCache.invalidateAll();
    }

    /**
     * Get semantic cache statistics for monitoring performance.
     */
    getSemanticCacheStats() {
        return this.semanticCache.getStats();
    }
}

/**
 * Assert that every rename request in the batch has a unique source symbol ID.
 * Validates each request's structure and identifier name while detecting
 * duplicates, so both concerns are handled in a single linear pass.
 *
 * @throws {Error} When any request fails structural validation or a symbol ID appears more than once.
 */
function assertBatchHasUniqueSymbolIds(renames: Array<RenameRequest>): void {
    const seenSymbolIds = new Set<string>();
    for (const rename of renames) {
        assertRenameRequest(rename, "Each rename in planBatchRename");
        if (seenSymbolIds.has(rename.symbolId)) {
            throw new Error(`Duplicate rename request for symbolId '${rename.symbolId}'`);
        }
        seenSymbolIds.add(rename.symbolId);
        assertValidIdentifierName(rename.newName);
    }
}

/**
 * Assert that no two renames in the batch target the same normalized name.
 * Renaming multiple symbols to the same name would cause them to collide after
 * the refactoring (e.g., renaming both `foo` and `bar` to `baz`), which would
 * produce a corrupted workspace edit.
 *
 * @throws {Error} When two or more renames share the same normalized target name.
 */
function assertBatchHasUniqueTargetNames(renames: Array<RenameRequest>): void {
    const seenTargetNames = new Set<string>();
    for (const rename of renames) {
        const normalizedNewName = assertValidIdentifierName(rename.newName);
        if (seenTargetNames.has(normalizedNewName)) {
            throw new Error(`Cannot rename multiple symbols to '${normalizedNewName}'`);
        }
        seenTargetNames.add(normalizedNewName);
    }
}

/**
 * Merge a single rename's workspace result into the running accumulator.
 * Text edits and file renames are applied directly to `merged`; metadata edits
 * are keyed by path in `metadataEditsByPath` so later renames win when multiple
 * renames touch the same metadata file.
 */
function accumulateRenameWorkspace(
    merged: WorkspaceEdit,
    workspace: WorkspaceEdit,
    metadataEditsByPath: Map<string, string>
): void {
    for (const edit of workspace.edits) {
        merged.addEdit(edit.path, edit.start, edit.end, edit.newText);
    }
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);
    for (const metadataEdit of metadataEdits) {
        metadataEditsByPath.set(metadataEdit.path, metadataEdit.content);
    }
    for (const fileRename of fileRenames) {
        merged.addFileRename(fileRename.oldPath, fileRename.newPath);
    }
}

/**
 * Flush the deduplicated metadata edits collected during batch rename planning
 * into the final merged workspace. Call this once after all individual renames
 * have been accumulated so that each metadata file receives at most one edit,
 * with later renames taking precedence over earlier ones.
 */
function flushDedupedMetadataEdits(merged: WorkspaceEdit, metadataEditsByPath: Map<string, string>): void {
    for (const [metadataPath, metadataContent] of metadataEditsByPath.entries()) {
        merged.addMetadataEdit(metadataPath, metadataContent);
    }
}

/**
 * Throw an error if validation failed.
 * Consolidates the pattern of checking validation.valid and formatting error messages.
 *
 * @param validation - The validation summary to check
 * @param context - Context string to include in the error message (e.g., "Cannot apply workspace edit")
 * @throws Error with formatted validation errors if validation failed
 */
function throwIfValidationFailed(validation: ValidationSummary, context: string): void {
    if (!validation.valid) {
        throw new Error(`${context}: ${validation.errors.join("; ")}`);
    }
}

/**
 * Populate a workspace with one text edit per occurrence of the renamed symbol.
 * Each edit replaces the old symbol name span with `newName` at its source location.
 *
 * Extracted from {@link RefactorEngine.planRename} so the orchestrator body
 * remains a readable sequence of delegation steps at a single abstraction level.
 */
function populateWorkspaceWithOccurrenceEdits(
    workspace: WorkspaceEdit,
    occurrences: ReadonlyArray<SymbolOccurrence>,
    newName: string
): void {
    for (const occurrence of occurrences) {
        workspace.addEdit(occurrence.path, occurrence.start, occurrence.end, newName);
    }
}

/**
 * Merge structural edits produced by the semantic analyzer for a symbol rename
 * into the given workspace.
 *
 * Only executes when the analyzer implements
 * {@link OccurrenceTracker.getAdditionalSymbolEdits}; otherwise this is a no-op.
 * Delegates the collection bookkeeping to {@link mergeWorkspaceEditInto} so
 * the caller does not need to iterate over individual edit arrays.
 */
async function mergeAdditionalSymbolEditsFromSemantic(
    workspace: WorkspaceEdit,
    semantic: PartialSemanticAnalyzer | null,
    symbolId: string,
    newName: string
): Promise<void> {
    if (!Core.hasMethods(semantic, "getAdditionalSymbolEdits")) {
        return;
    }

    const additionalEdits = await semantic.getAdditionalSymbolEdits(symbolId, newName);
    mergeWorkspaceEditInto(workspace, additionalEdits);
}

export function createRefactorEngine(dependencies: Partial<RefactorEngineDependencies> = {}): RefactorEngine {
    return new RefactorEngine(dependencies);
}
