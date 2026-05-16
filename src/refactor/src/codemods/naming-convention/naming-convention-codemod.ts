import { Core } from "@gmloop/core";

import { evaluateNamingConvention, resolveNamingConventionRules } from "../../naming-convention-policy.js";
import { DEFAULT_RESERVED_KEYWORDS } from "../../rename/index.js";
import {
    detectCircularRenames,
    detectCrossRenameNameConfusion,
    detectDuplicateTargetNames
} from "../../rename/rename-validation.js";
import type {
    ApplyWorkspaceEditOptions,
    BatchRenamePlanSummary,
    BatchRenameValidation,
    CodemodRenameOperations,
    CodemodSemanticProvider,
    CodemodWorkspaceEditor,
    MacroExpansionDependency,
    NamingCategory,
    NamingConventionCodemodPlan,
    NamingConventionTarget,
    NamingConventionViolation,
    PartialSemanticAnalyzer,
    RefactorProjectConfig,
    RenameRequest,
    ValidationSummary
} from "../../types.js";
import { type WorkspaceEdit, WorkspaceEdit as WorkspaceEditClass } from "../../workspace-edit.js";
import { createPathSelectionMatcher, resolveProjectPath } from "./path-selection.js";

const RESERVED_LOCAL_RENAME_CATEGORIES = new Set([
    "globalVariable",
    "instanceVariable",
    "localVariable",
    "loopIndexVariable",
    "staticVariable"
]);

const RESERVED_LOCAL_IDENTIFIER_TYPES = new Set(["property", "symbol", "variable"]);
const DEFINITELY_LOCAL_NAMING_CATEGORIES = new Set<NamingCategory>([
    "localVariable",
    "argument",
    "catchArgument",
    "loopIndexVariable",
    "staticVariable"
]);

let cachedReservedLocalIdentifierNames: ReadonlySet<string> | null = null;

function getReservedLocalIdentifierNames(): ReadonlySet<string> {
    if (cachedReservedLocalIdentifierNames !== null) {
        return cachedReservedLocalIdentifierNames;
    }

    const reservedNames = new Set(Array.from(DEFAULT_RESERVED_KEYWORDS, (keyword) => keyword.toLowerCase()));
    const identifierEntries = Core.normalizeIdentifierMetadataEntries(Core.getIdentifierMetadata());

    for (const { name, type } of identifierEntries) {
        if (!RESERVED_LOCAL_IDENTIFIER_TYPES.has(type.toLowerCase())) {
            continue;
        }

        reservedNames.add(name.toLowerCase());
    }

    cachedReservedLocalIdentifierNames = reservedNames;
    return cachedReservedLocalIdentifierNames;
}

function appendWorkspaceEdits(destination: WorkspaceEdit, source: WorkspaceEdit): void {
    for (const edit of source.edits) {
        destination.addEdit(edit.path, edit.start, edit.end, edit.newText);
    }

    for (const metadataEdit of source.metadataEdits) {
        destination.addMetadataEdit(metadataEdit.path, metadataEdit.content);
    }

    for (const fileRename of source.fileRenames) {
        destination.addFileRename(fileRename.oldPath, fileRename.newPath);
    }
}

function decrementScopedNameCount(names: Map<string, number>, normalizedName: string): void {
    const currentCount = names.get(normalizedName) ?? 0;
    if (currentCount <= 1) {
        names.delete(normalizedName);
        return;
    }

    names.set(normalizedName, currentCount - 1);
}

/**
 * Increment a numeric counter stored in a Map by 1, defaulting missing entries to 0.
 * A lightweight local alternative to `Core.incrementMapValue` that skips the generic
 * helper's type-validation and coercion overhead for typed `Map<string, number>` stores.
 */
function incrementScopedCount(store: Map<string, number>, key: string): void {
    store.set(key, (store.get(key) ?? 0) + 1);
}

/**
 * Build the declaration identity key used to deduplicate local declaration
 * rows that refer to the same declaration tuple.
 *
 * @param target - Local naming target identity.
 * @returns Stable `<category>:<name>` key for same-scope declaration tracking.
 */
function getLocalDeclarationKey(target: { category: NamingCategory; name: string }): string {
    return `${target.category}:${target.name}`;
}

type ScopeDataCollectionResult = {
    localScopeNames: Map<string, Map<string, number>>;
    duplicateScopedDeclarations: Map<string, Set<string>>;
};

function createEmptyScopeDataCollectionResult(): ScopeDataCollectionResult {
    return {
        localScopeNames: new Map<string, Map<string, number>>(),
        duplicateScopedDeclarations: new Map<string, Set<string>>()
    };
}

function requestedCategoriesMayContainLocalTargets(requestedCategories: ReadonlyArray<NamingCategory>): boolean {
    for (const category of requestedCategories) {
        if (DEFINITELY_LOCAL_NAMING_CATEGORIES.has(category)) {
            return true;
        }
    }

    return false;
}

function collectSelectedTargets(parameters: {
    queriedTargets: ReadonlyArray<NamingConventionTarget>;
    queryPaths: ReadonlyArray<string>;
    isSelectedTargetPath: (targetPath: string) => boolean;
    trackLocalTargets: boolean;
}): {
    selectedTargets: ReadonlyArray<NamingConventionTarget>;
    hasLocalNamingTargets: boolean;
} {
    const { queriedTargets, queryPaths, isSelectedTargetPath, trackLocalTargets } = parameters;
    if (queryPaths.length > 0) {
        if (!trackLocalTargets) {
            return {
                selectedTargets: queriedTargets,
                hasLocalNamingTargets: false
            };
        }

        return {
            selectedTargets: queriedTargets,
            hasLocalNamingTargets: queriedTargets.some((target) => target.symbolId === null)
        };
    }

    const selectedTargets: Array<NamingConventionTarget> = [];
    let hasLocalNamingTargets = false;

    for (const target of queriedTargets) {
        if (!isSelectedTargetPath(target.path)) {
            continue;
        }

        selectedTargets.push(target);
        if (!trackLocalTargets || hasLocalNamingTargets || target.symbolId !== null) {
            continue;
        }

        hasLocalNamingTargets = true;
    }

    return {
        selectedTargets,
        hasLocalNamingTargets
    };
}

function hasDuplicateScopedDeclaration(
    duplicateScopedDeclarations: Map<string, Set<string>>,
    scopeKey: string,
    declarationKey: string
): boolean {
    const scopedDeclarations = duplicateScopedDeclarations.get(scopeKey);
    if (scopedDeclarations === undefined) {
        return false;
    }

    return scopedDeclarations.has(declarationKey);
}

function addDuplicateScopedDeclaration(
    duplicateScopedDeclarations: Map<string, Set<string>>,
    scopeKey: string,
    declarationKey: string
): void {
    const scopedDeclarations = duplicateScopedDeclarations.get(scopeKey) ?? new Set<string>();
    scopedDeclarations.add(declarationKey);
    duplicateScopedDeclarations.set(scopeKey, scopedDeclarations);
}

/**
 * Collect all scope-level data needed for naming-convention rename planning in a
 * minimal number of passes over `selectedTargets`.
 *
 * The previous implementation required two full iterations:
 *   1. `collectScopeKeysRequiringNameConflictChecks` — identify scopes with ≥2 unique declarations
 *   2. `collectLocalScopeNames` — count declaration occurrences and (for conflicting scopes only)
 *      build the per-scope name presence maps
 *
 * This replacement performs both jobs in a **single first pass**, then conditionally executes a
 * second pass that visits only the targets belonging to the (usually empty) set of conflicting
 * scopes.  For the common case — where every scope contains exactly one declaration key — the
 * conditional block is skipped entirely, halving the number of full target iterations.
 *
 * The common first-pass path tracks a single declaration key per scope and only
 * promotes to a `Set` when a scope actually has multiple declarations.
 *
 * @param selectedTargets - Candidate naming targets returned by semantic.
 * @returns Collected scope data used by the codemod planner.
 */
function collectScopeDataFromTargets(
    selectedTargets: ReadonlyArray<LocalNamingConventionTarget>
): ScopeDataCollectionResult {
    const declarationsByScope = new Map<string, string | Set<string>>();
    const scopeKeysRequiringNameConflictChecks = new Set<string>();
    const duplicateScopedDeclarations = new Map<string, Set<string>>();

    // Single first pass: compute scope keys and declaration keys while identifying
    // both duplicate declaration rows and scopes that host multiple unique declarations.
    // The common case has one declaration per scope, so this avoids building a
    // scoped-declaration identity string and counter entry for every target.
    for (const target of selectedTargets) {
        if (target.symbolId !== null) {
            continue;
        }

        const scopeKey = `${target.path}:${target.scopeId ?? "root"}`;
        const declarationKey = getLocalDeclarationKey(target);

        // Determine whether this scope hosts multiple distinct declaration keys.
        const declarations = declarationsByScope.get(scopeKey);
        if (declarations === undefined) {
            declarationsByScope.set(scopeKey, declarationKey);
            continue;
        }

        if (typeof declarations === "string") {
            if (declarations === declarationKey) {
                addDuplicateScopedDeclaration(duplicateScopedDeclarations, scopeKey, declarationKey);
                continue;
            }

            declarationsByScope.set(scopeKey, new Set([declarations, declarationKey]));
            scopeKeysRequiringNameConflictChecks.add(scopeKey);
            continue;
        }

        if (declarations.has(declarationKey)) {
            addDuplicateScopedDeclaration(duplicateScopedDeclarations, scopeKey, declarationKey);
        } else {
            declarations.add(declarationKey);
        }
    }

    // Second pass: build the per-scope name presence maps — but ONLY when at least one scope
    // has multiple declarations.  In the common case this block is never entered, saving the
    // cost of a full second scan over `selectedTargets`.
    const localScopeNames = new Map<string, Map<string, number>>();
    const localScopeDeclarations = new Map<string, Set<string>>();

    if (scopeKeysRequiringNameConflictChecks.size > 0) {
        for (const target of selectedTargets) {
            if (target.symbolId !== null) {
                continue;
            }

            const scopeKey = `${target.path}:${target.scopeId ?? "root"}`;
            if (!scopeKeysRequiringNameConflictChecks.has(scopeKey)) {
                continue;
            }

            const declarationKey = getLocalDeclarationKey(target);
            const names = localScopeNames.get(scopeKey) ?? new Map<string, number>();
            const declarations = localScopeDeclarations.get(scopeKey) ?? new Set<string>();
            if (declarations.has(declarationKey)) {
                continue;
            }

            declarations.add(declarationKey);
            incrementScopedCount(names, target.name.toLowerCase());
            localScopeNames.set(scopeKey, names);
            localScopeDeclarations.set(scopeKey, declarations);
        }
    }

    return {
        localScopeNames,
        duplicateScopedDeclarations
    };
}

/**
 * Plan and optionally apply one local naming-convention rename candidate.
 *
 * The helper enforces same-scope collision safety, reserved identifier checks,
 * and macro-dependency guards before applying text edits. It caches the
 * decision per declaration key so duplicate target rows stay consistent.
 *
 * @param parameters - Local rename planning context.
 * @returns `1` when this invocation applied a new local rename decision; `0`
 * when the target was skipped or reused an existing decision.
 */
function processLocalNamingConventionRename(parameters: {
    target: LocalNamingConventionTarget;
    suggestedName: string;
    workspace: WorkspaceEdit;
    warnings: Array<string>;
    localScopeNames: Map<string, Map<string, number>>;
    localDeclarationRenameDecisions: LocalDeclarationRenameDecisionByScope;
    macroDependencyNamesByFile: MacroDependencyNamesByFile | null;
    duplicateScopedDeclarations: Map<string, Set<string>>;
    hasDuplicateScopedDeclarations: boolean;
}): number {
    const { target, suggestedName } = parameters;
    const needsScopeKey = parameters.hasDuplicateScopedDeclarations || parameters.localScopeNames.size > 0;
    const scopeKey = needsScopeKey ? `${target.path}:${target.scopeId ?? "root"}` : null;
    const declarationKey = parameters.hasDuplicateScopedDeclarations ? getLocalDeclarationKey(target) : null;
    const hasDuplicateDeclaration =
        scopeKey !== null &&
        declarationKey !== null &&
        hasDuplicateScopedDeclaration(parameters.duplicateScopedDeclarations, scopeKey, declarationKey);
    const scopeDecisions = scopeKey === null ? undefined : parameters.localDeclarationRenameDecisions.get(scopeKey);
    if (scopeKey !== null && declarationKey !== null && hasDuplicateDeclaration) {
        const plannedDecision = scopeDecisions?.get(declarationKey);
        if (plannedDecision) {
            if (!plannedDecision.shouldApply) {
                return 0;
            }

            for (const occurrence of target.occurrences) {
                parameters.workspace.addEdit(
                    occurrence.path,
                    occurrence.start,
                    occurrence.end,
                    plannedDecision.suggestedName
                );
            }
            return 0;
        }
    }

    let normalizedSuggestedName: string | null = null;
    let normalizedIdentifierName: string | null = null;
    const existingNames = scopeKey === null ? undefined : parameters.localScopeNames.get(scopeKey);

    if (existingNames !== undefined) {
        normalizedSuggestedName = suggestedName.toLowerCase();
        normalizedIdentifierName = target.name.toLowerCase();
        const existingSuggestedNameCount = existingNames.get(normalizedSuggestedName) ?? 0;
        const isCaseOnlyRename = normalizedSuggestedName === normalizedIdentifierName;
        const hasSameScopeNameConflict = isCaseOnlyRename
            ? existingSuggestedNameCount > 1
            : existingSuggestedNameCount > 0;

        if (suggestedName !== target.name && hasSameScopeNameConflict) {
            parameters.warnings.push(
                `Skipping local rename '${target.name}' -> '${suggestedName}' in ${target.path} because the target name already exists in the same scope.`
            );
            if (scopeKey !== null && declarationKey !== null) {
                const ensuredScopeDecisions = ensureScopeRenameDecisions(
                    parameters.localDeclarationRenameDecisions,
                    scopeKey
                );
                ensuredScopeDecisions.set(declarationKey, {
                    shouldApply: false,
                    suggestedName
                });
            }
            return 0;
        }
    }

    if (
        RESERVED_LOCAL_RENAME_CATEGORIES.has(target.category) &&
        getReservedLocalIdentifierNames().has(normalizedSuggestedName ?? suggestedName.toLowerCase())
    ) {
        parameters.warnings.push(
            `Skipping local rename '${target.name}' -> '${suggestedName}' in ${target.path} because '${suggestedName}' is a reserved GameMaker identifier.`
        );
        if (scopeKey !== null && declarationKey !== null) {
            const ensuredScopeDecisions = ensureScopeRenameDecisions(
                parameters.localDeclarationRenameDecisions,
                scopeKey
            );
            ensuredScopeDecisions.set(declarationKey, {
                shouldApply: false,
                suggestedName
            });
        }
        return 0;
    }

    const dependentMacroNames =
        parameters.macroDependencyNamesByFile === null
            ? []
            : findDependentMacroNames(
                  parameters.macroDependencyNamesByFile,
                  target.path,
                  normalizedIdentifierName ?? target.name.toLowerCase()
              );
    if (dependentMacroNames.length > 0) {
        parameters.warnings.push(
            `Skipping local rename '${target.name}' -> '${suggestedName}' in ${target.path} because macro expansion${dependentMacroNames.length === 1 ? "" : "s"} ${dependentMacroNames.map((macroName) => `'${macroName}'`).join(", ")} ${dependentMacroNames.length === 1 ? "depends" : "depend"} on '${target.name}'.`
        );
        if (scopeKey !== null && declarationKey !== null) {
            const ensuredScopeDecisions = ensureScopeRenameDecisions(
                parameters.localDeclarationRenameDecisions,
                scopeKey
            );
            ensuredScopeDecisions.set(declarationKey, {
                shouldApply: false,
                suggestedName
            });
        }
        return 0;
    }

    for (const occurrence of target.occurrences) {
        parameters.workspace.addEdit(occurrence.path, occurrence.start, occurrence.end, suggestedName);
    }

    if (scopeKey !== null && declarationKey !== null && hasDuplicateDeclaration) {
        const ensuredScopeDecisions = ensureScopeRenameDecisions(parameters.localDeclarationRenameDecisions, scopeKey);
        ensuredScopeDecisions.set(declarationKey, {
            shouldApply: true,
            suggestedName
        });
    }
    if (existingNames !== undefined) {
        normalizedSuggestedName ??= suggestedName.toLowerCase();
        normalizedIdentifierName ??= target.name.toLowerCase();
        decrementScopedNameCount(existingNames, normalizedIdentifierName);
        incrementScopedCount(existingNames, normalizedSuggestedName);
        parameters.localScopeNames.set(scopeKey, existingNames);
    }
    return 1;
}

type TopLevelRenameSelection = {
    executableRenames: Array<RenameRequest>;
    reusableBatchValidation: BatchRenameValidation | null;
    warnings: Array<string>;
};

type MacroDependencyNamesByFile = Map<string, Map<string, Set<string>>>;
type LocalDeclarationRenameDecision = {
    shouldApply: boolean;
    suggestedName: string;
};
type LocalDeclarationRenameDecisionByScope = Map<string, Map<string, LocalDeclarationRenameDecision>>;
type LocalNamingConventionTarget = {
    category: NamingCategory;
    name: string;
    path: string;
    scopeId: string | null;
    symbolId: string | null;
    occurrences: Array<{ path: string; start: number; end: number }>;
};

function ensureScopeRenameDecisions(
    decisionsByScope: LocalDeclarationRenameDecisionByScope,
    scopeKey: string
): Map<string, LocalDeclarationRenameDecision> {
    const existingDecisions = decisionsByScope.get(scopeKey);
    if (existingDecisions !== undefined) {
        return existingDecisions;
    }

    const createdDecisions = new Map<string, LocalDeclarationRenameDecision>();
    decisionsByScope.set(scopeKey, createdDecisions);
    return createdDecisions;
}

function formatTopLevelRenameSkipWarning(rename: RenameRequest, reason: string): string {
    return `Skipping top-level rename '${rename.symbolId}' -> '${rename.newName}': ${reason}`;
}

async function selectExecutableTopLevelRenames(
    engine: CodemodRenameOperations,
    renames: ReadonlyArray<RenameRequest>
): Promise<TopLevelRenameSelection> {
    const warnings: Array<string> = [];
    const individuallySafeRenames: Array<RenameRequest> = [];
    const renameValidations = new Map<string, ValidationSummary>();
    const renameValidationResults = await Core.runInParallelWithLimit(
        renames,
        async (rename) => ({
            rename,
            validation: await engine.validateRenameRequest(rename)
        }),
        8
    );

    for (const { rename, validation } of renameValidationResults) {
        renameValidations.set(rename.symbolId, validation);
        warnings.push(...validation.warnings.map((warning) => `${rename.symbolId}: ${warning}`));

        if (!validation.valid) {
            warnings.push(formatTopLevelRenameSkipWarning(rename, validation.errors.join("; ")));
            continue;
        }

        individuallySafeRenames.push(rename);
    }

    const blockedSymbolIds = new Set<string>();
    for (const duplicateTarget of detectDuplicateTargetNames(individuallySafeRenames)) {
        for (const symbolId of duplicateTarget.symbolIds) {
            blockedSymbolIds.add(symbolId);
            warnings.push(
                formatTopLevelRenameSkipWarning(
                    individuallySafeRenames.find((rename) => rename.symbolId === symbolId) ?? {
                        symbolId,
                        newName: duplicateTarget.newName
                    },
                    `another naming-convention rename in the same run also targets '${duplicateTarget.newName}'`
                )
            );
        }
    }

    const circularRenameChain = detectCircularRenames(individuallySafeRenames);
    if (circularRenameChain.length > 0) {
        const cycleSymbolIds = new Set(circularRenameChain);
        const cyclePreview = circularRenameChain.join(" -> ");
        for (const rename of individuallySafeRenames) {
            if (cycleSymbolIds.has(rename.symbolId)) {
                blockedSymbolIds.add(rename.symbolId);
                warnings.push(
                    formatTopLevelRenameSkipWarning(
                        rename,
                        `the rename participates in a circular naming-convention batch (${cyclePreview})`
                    )
                );
            }
        }
    }

    const executableRenames = individuallySafeRenames.filter((rename) => !blockedSymbolIds.has(rename.symbolId));

    return {
        executableRenames,
        reusableBatchValidation:
            blockedSymbolIds.size === 0 && individuallySafeRenames.length === renames.length
                ? {
                      valid: true,
                      errors: [],
                      warnings: detectCrossRenameNameConfusion(executableRenames).map(
                          ({ symbolId, newName }) =>
                              `Rename introduces potential confusion: '${symbolId}' renamed to '${newName}' which was an original symbol name in this batch`
                      ),
                      renameValidations,
                      conflictingSets: []
                  }
                : null,
        warnings
    };
}

function collectBatchPlanWarnings(plan: BatchRenamePlanSummary): Array<string> {
    return [...plan.batchValidation.warnings, ...plan.validation.warnings, ...(plan.hotReload?.warnings ?? [])];
}

function collectBatchPlanErrors(plan: BatchRenamePlanSummary): Array<string> {
    return [...plan.batchValidation.errors, ...plan.validation.errors, ...(plan.hotReload?.errors ?? [])];
}

function collectMacroDependencyNamesByFile(
    dependencies: ReadonlyArray<MacroExpansionDependency> | undefined
): MacroDependencyNamesByFile {
    const dependencyNamesByFile: MacroDependencyNamesByFile = new Map();

    for (const dependency of dependencies ?? []) {
        const dependencyNames = dependencyNamesByFile.get(dependency.path) ?? new Map<string, Set<string>>();
        const normalizedReferencedNames = dependencyNames.get(dependency.macroName) ?? new Set<string>();

        for (const referencedName of dependency.referencedNames) {
            normalizedReferencedNames.add(referencedName.toLowerCase());
        }

        dependencyNames.set(dependency.macroName, normalizedReferencedNames);
        dependencyNamesByFile.set(dependency.path, dependencyNames);
    }

    return dependencyNamesByFile;
}

function findDependentMacroNames(
    dependenciesByFile: MacroDependencyNamesByFile,
    filePath: string,
    normalizedIdentifierName: string
): Array<string> {
    const dependenciesForFile = dependenciesByFile.get(filePath);
    if (!dependenciesForFile) {
        return [];
    }
    const dependentMacroNames: Array<string> = [];

    for (const [macroName, referencedNames] of dependenciesForFile) {
        if (referencedNames.has(normalizedIdentifierName)) {
            dependentMacroNames.push(macroName);
        }
    }

    return dependentMacroNames.toSorted();
}

/**
 * Build the expanded list of file paths to pass to `listNamingConventionTargets`.
 *
 * For each selected GML file the semantic analyzer is also given:
 * - The project-absolute form of the GML path, since indexers may store absolute paths.
 * - The companion `.yy` metadata file path (GameMaker resource descriptor), in both
 *   relative and absolute forms, because some semantic adapters key their symbol tables
 *   on the resource path rather than the GML source path.
 *
 * Passing all four variants ensures the analyzer can surface targets regardless of how
 * it has indexed the project.
 *
 * @param projectRoot - Absolute project root path used to resolve relative entries.
 * @param selectedFilePaths - Relative or absolute GML file paths that passed selection.
 * @returns Deduplicated list of paths to query.
 */
function buildNamingTargetQueryPaths(projectRoot: string, selectedFilePaths: Array<string>): Array<string> {
    const queryPaths = new Set<string>();

    for (const filePath of selectedFilePaths) {
        queryPaths.add(filePath);
        queryPaths.add(resolveProjectPath(projectRoot, filePath));

        // Companion .yy resource descriptor (sibling of every GML script file).
        const yyPath = filePath.replace(/\.gml$/i, ".yy");
        if (yyPath !== filePath) {
            queryPaths.add(yyPath);
            queryPaths.add(resolveProjectPath(projectRoot, yyPath));
        }
    }

    return [...queryPaths];
}

function includesWholeProjectSelection(projectRoot: string, targetPaths: ReadonlyArray<string>): boolean {
    if (targetPaths.length === 0) {
        return true;
    }

    const absoluteProjectRoot = resolveProjectPath(projectRoot, projectRoot);
    return targetPaths.every((targetPath) => resolveProjectPath(projectRoot, targetPath) === absoluteProjectRoot);
}

function getNamingTargetIdentity(target: NamingConventionTarget): string {
    const occurrenceIdentity = target.occurrences
        .map(
            (occurrence) =>
                `${occurrence.path}:${occurrence.start}:${occurrence.end}:${occurrence.kind}:${occurrence.scopeId ?? ""}`
        )
        .join(",");
    return `${target.path}:${target.category}:${target.name}:${target.scopeId ?? ""}:${target.symbolId ?? ""}:${occurrenceIdentity}`;
}

function deduplicateNamingTargets(targets: ReadonlyArray<NamingConventionTarget>): Array<NamingConventionTarget> {
    const seen = new Set<string>();
    const deduplicated: Array<NamingConventionTarget> = [];
    for (const target of targets) {
        const identity = getNamingTargetIdentity(target);
        if (seen.has(identity)) {
            continue;
        }
        seen.add(identity);
        deduplicated.push(target);
    }

    return deduplicated;
}

async function listNamingConventionTargetsResilient(parameters: {
    semantic: {
        listNamingConventionTargets: NonNullable<PartialSemanticAnalyzer["listNamingConventionTargets"]>;
    };
    queryPaths: Array<string>;
    requestedCategories: ReadonlyArray<NamingCategory>;
}): Promise<{ targets: Array<NamingConventionTarget>; warnings: Array<string> }> {
    const { semantic, queryPaths, requestedCategories } = parameters;
    const warnings: Array<string> = [];
    const listTargets = async (filePaths?: Array<string>): Promise<Array<NamingConventionTarget>> =>
        await semantic.listNamingConventionTargets.call(semantic, filePaths, requestedCategories);

    if (queryPaths.length === 0) {
        try {
            return {
                targets: await listTargets(),
                warnings
            };
        } catch (error) {
            warnings.push(
                `Skipping naming-convention target discovery because semantic analysis failed: ${Core.getErrorMessage(error)}`
            );
            return { targets: [], warnings };
        }
    }

    const listTargetsByPath = async (paths: Array<string>): Promise<Array<NamingConventionTarget>> => {
        try {
            return await listTargets(paths);
        } catch (error) {
            if (paths.length === 1) {
                warnings.push(`Skipping naming-convention analysis for ${paths[0]}: ${Core.getErrorMessage(error)}`);
                return [];
            }

            const midpoint = Math.floor(paths.length / 2);
            const leftTargets = await listTargetsByPath(paths.slice(0, midpoint));
            const rightTargets = await listTargetsByPath(paths.slice(midpoint));
            return [...leftTargets, ...rightTargets];
        }
    };

    try {
        return {
            targets: await listTargets(queryPaths),
            warnings
        };
    } catch (error) {
        warnings.push(
            `Naming-convention target discovery encountered recoverable analysis errors and retried per path: ${Core.getErrorMessage(error)}`
        );
        const recoveredTargets = await listTargetsByPath(queryPaths);
        return {
            targets: deduplicateNamingTargets(recoveredTargets),
            warnings
        };
    }
}

/**
 * Plan naming-policy-driven edits for the selected project paths.
 */
export async function planNamingConventionCodemod(
    engine: CodemodSemanticProvider & CodemodRenameOperations,
    parameters: {
        projectRoot: string;
        config: RefactorProjectConfig;
        targetPaths: Array<string>;
        gmlFilePaths?: Array<string>;
        includeTopLevelPlan?: boolean;
        includeViolations?: boolean;
    }
): Promise<NamingConventionCodemodPlan> {
    const policy = parameters.config.codemods?.namingConvention;
    if (!policy) {
        return {
            workspace: new WorkspaceEditClass(),
            violations: [],
            warnings: [
                "The namingConvention codemod is enabled but refactor.codemods.namingConvention is not configured."
            ],
            errors: [],
            topLevelRenamePlan: null,
            topLevelRenameRequests: [],
            localRenameCount: 0
        };
    }

    const semantic = engine.semantic;
    if (!semantic || typeof semantic.listNamingConventionTargets !== "function") {
        return {
            workspace: new WorkspaceEditClass(),
            violations: [],
            warnings: [],
            errors: ["Naming convention codemod requires semantic.listNamingConventionTargets support."],
            topLevelRenamePlan: null,
            topLevelRenameRequests: [],
            localRenameCount: 0
        };
    }

    const includeTopLevelPlan = parameters.includeTopLevelPlan !== false;
    const includeViolations = parameters.includeViolations !== false;
    const resolvedRules = resolveNamingConventionRules(policy);
    const requestedCategories = Object.keys(resolvedRules) as Array<NamingCategory>;
    const tracksLocalTargets = requestedCategoriesMayContainLocalTargets(requestedCategories);
    let workspace = new WorkspaceEditClass();
    const warnings: Array<string> = [];
    const errors: Array<string> = [];
    const violations: Array<NamingConventionViolation> = [];
    const localDeclarationRenameDecisions = new Map<string, Map<string, LocalDeclarationRenameDecision>>();
    const topLevelRenames: Array<{ symbolId: string; newName: string }> = [];
    const seenTopLevelRenames = new Set<string>();
    let localRenameCount = 0;
    const isSelectedTargetPath = createPathSelectionMatcher(parameters.projectRoot, parameters.targetPaths, []);
    const selectedWholeProject =
        includesWholeProjectSelection(parameters.projectRoot, parameters.targetPaths) && !tracksLocalTargets;
    const selectedFilePaths = [...(parameters.gmlFilePaths ?? [])];
    const queryPaths = selectedWholeProject
        ? []
        : buildNamingTargetQueryPaths(parameters.projectRoot, selectedFilePaths);
    const namingTargetProvider = {
        listNamingConventionTargets: semantic.listNamingConventionTargets.bind(semantic)
    };
    const queriedTargetsResult = await listNamingConventionTargetsResilient({
        semantic: namingTargetProvider,
        queryPaths,
        requestedCategories
    });
    warnings.push(...queriedTargetsResult.warnings);
    const queriedTargets = queriedTargetsResult.targets;
    const { selectedTargets, hasLocalNamingTargets } = collectSelectedTargets({
        queriedTargets,
        queryPaths,
        isSelectedTargetPath,
        trackLocalTargets: tracksLocalTargets
    });
    const macroDependencyNamesByFile =
        hasLocalNamingTargets && typeof semantic.listMacroExpansionDependencies === "function"
            ? collectMacroDependencyNamesByFile(await semantic.listMacroExpansionDependencies(selectedFilePaths))
            : null;

    // Skip local-scope collection entirely when the current run only contains
    // top-level symbols. This is the dominant `refactor codemod --write` path on
    // large projects and avoids an otherwise redundant full scan of selectedTargets.
    const { localScopeNames, duplicateScopedDeclarations } = hasLocalNamingTargets
        ? collectScopeDataFromTargets(selectedTargets)
        : createEmptyScopeDataCollectionResult();
    const hasDuplicateScopedDeclarations = duplicateScopedDeclarations.size > 0;

    for (const target of selectedTargets) {
        const evaluation = evaluateNamingConvention(target.name, target.category, policy, resolvedRules, {
            includeMessage: includeViolations
        });
        if (evaluation.compliant) {
            continue;
        }

        if (includeViolations && evaluation.message !== null) {
            violations.push({
                category: target.category,
                currentName: target.name,
                suggestedName: evaluation.suggestedName,
                path: target.path,
                symbolId: target.symbolId,
                message: evaluation.message
            });
        }

        if (evaluation.suggestedName === null || evaluation.suggestedName === target.name) {
            warnings.push(`No automatic rename generated for ${target.category} '${target.name}' in ${target.path}.`);
            continue;
        }

        if (target.symbolId !== null) {
            const key = `${target.symbolId}:${evaluation.suggestedName}`;
            if (!seenTopLevelRenames.has(key)) {
                seenTopLevelRenames.add(key);
                topLevelRenames.push({
                    symbolId: target.symbolId,
                    newName: evaluation.suggestedName
                });
            }
            continue;
        }

        localRenameCount += processLocalNamingConventionRename({
            target,
            suggestedName: evaluation.suggestedName,
            workspace,
            warnings,
            localScopeNames,
            localDeclarationRenameDecisions,
            macroDependencyNamesByFile,
            duplicateScopedDeclarations,
            hasDuplicateScopedDeclarations
        });
    }

    const topLevelRenameSelection = await selectExecutableTopLevelRenames(engine, topLevelRenames);
    warnings.push(...topLevelRenameSelection.warnings);

    let topLevelRenamePlan: NamingConventionCodemodPlan["topLevelRenamePlan"] = null;
    let executableTopLevelRenames = topLevelRenameSelection.executableRenames;
    if (includeTopLevelPlan && executableTopLevelRenames.length > 0) {
        try {
            const preparedTopLevelRenamePlan = await engine.prepareBatchRenamePlan(executableTopLevelRenames, {
                includeImpactAnalyses: false,
                batchValidation: topLevelRenameSelection.reusableBatchValidation
            });
            warnings.push(...collectBatchPlanWarnings(preparedTopLevelRenamePlan));

            const topLevelPlanErrors = collectBatchPlanErrors(preparedTopLevelRenamePlan);
            if (topLevelPlanErrors.length > 0) {
                warnings.push(
                    `Skipping ${executableTopLevelRenames.length} top-level naming rename(s) because batch planning failed: ${topLevelPlanErrors.join("; ")}`
                );
                executableTopLevelRenames = [];
            } else {
                topLevelRenamePlan = preparedTopLevelRenamePlan;
                const mergedWorkspace = preparedTopLevelRenamePlan.workspace;
                appendWorkspaceEdits(mergedWorkspace, workspace);
                workspace = mergedWorkspace;
            }
        } catch (error) {
            warnings.push(
                `Skipping ${executableTopLevelRenames.length} top-level naming rename(s) because batch planning failed: ${Core.getErrorMessage(error)}`
            );
            executableTopLevelRenames = [];
        }
    }

    return {
        workspace,
        violations,
        warnings,
        errors,
        topLevelRenamePlan,
        topLevelRenameRequests: executableTopLevelRenames,
        localRenameCount
    };
}

/**
 * Execute a naming-convention codemod plan when it contains no blocking errors.
 */
export async function executeNamingConventionCodemod(
    engine: CodemodSemanticProvider & CodemodRenameOperations & CodemodWorkspaceEditor,
    parameters: {
        projectRoot: string;
        config: RefactorProjectConfig;
        targetPaths: Array<string>;
        gmlFilePaths?: Array<string>;
        applyOptions: ApplyWorkspaceEditOptions;
    }
): Promise<{
    plan: NamingConventionCodemodPlan;
    applied: Map<string, string>;
}> {
    const plan = await planNamingConventionCodemod(engine, {
        projectRoot: parameters.projectRoot,
        config: parameters.config,
        targetPaths: parameters.targetPaths,
        gmlFilePaths: parameters.gmlFilePaths,
        includeViolations: false
    });

    if (plan.errors.length > 0) {
        return {
            plan,
            applied: new Map()
        };
    }

    if (
        plan.workspace.edits.length === 0 &&
        plan.workspace.metadataEdits.length === 0 &&
        plan.workspace.fileRenames.length === 0
    ) {
        return {
            plan,
            applied: new Map()
        };
    }

    const applied = await engine.applyWorkspaceEdit(plan.workspace, {
        ...parameters.applyOptions,
        includeResultContent: parameters.applyOptions.dryRun === true
    });
    return {
        plan,
        applied
    };
}
