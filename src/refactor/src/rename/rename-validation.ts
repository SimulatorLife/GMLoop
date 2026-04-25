/**
 * Validation module for refactoring operations.
 * Handles conflict detection, circular rename detection, and batch rename validation.
 */

import { Core } from "@gmloop/core";

import {
    type ConflictEntry,
    ConflictType,
    type FileSymbolProvider,
    type KeywordProvider,
    type RenameRequest,
    type SymbolOccurrence,
    type SymbolResolver
} from "../types.js";
import {
    assertValidIdentifierName,
    DEFAULT_RESERVED_KEYWORDS,
    extractSymbolName,
    parseSymbolIdParts,
    tryNormalizeIdentifierName
} from "./index.js";

type MaybePromise<T> = Promise<T> | T;

/**
 * Internal sentinel value to represent global (unscoped) symbol occurrences.
 * Used to group occurrences without a scopeId for batch validation.
 */
const GLOBAL_SCOPE_KEY = "__global__";

function isPromiseLike<T>(value: MaybePromise<T>): value is Promise<T> {
    return typeof (value as { then?: unknown })?.then === "function";
}

/**
 * Groups symbol occurrences by a derived key.
 * @param occurrences - Source occurrences to group
 * @param keySelector - Produces a stable grouping key for each occurrence
 * @returns Map of keys to grouped occurrences
 */
function groupOccurrencesByKey(
    occurrences: Array<SymbolOccurrence>,
    keySelector: (occurrence: SymbolOccurrence) => string | null
): Map<string, Array<SymbolOccurrence>> {
    const groups = new Map<string, Array<SymbolOccurrence>>();

    for (const occurrence of occurrences) {
        const key = keySelector(occurrence);
        if (!key) {
            continue;
        }

        const existingGroup = groups.get(key);
        if (existingGroup) {
            existingGroup.push(occurrence);
            continue;
        }

        groups.set(key, [occurrence]);
    }

    return groups;
}

/**
 * Groups occurrences by scope and collects file paths for each scope.
 * @param occurrences - Symbol occurrences to group
 * @returns Map of scope keys to sets of file paths
 */
function groupOccurrencesByScope(occurrences: Array<SymbolOccurrence>): Map<string, Set<string>> {
    const scopeToPaths = new Map<string, Set<string>>();

    for (const occurrence of occurrences) {
        const scopeKey = occurrence.scopeId ?? GLOBAL_SCOPE_KEY;
        const paths = scopeToPaths.get(scopeKey) ?? new Set<string>();
        if (occurrence.path) {
            paths.add(occurrence.path);
        }

        scopeToPaths.set(scopeKey, paths);
    }

    return scopeToPaths;
}

/**
 * Adds shadow conflict entries for a given scope and its paths.
 * @param conflicts - Array to append conflicts to
 * @param oldName - Original symbol name
 * @param newName - New symbol name
 * @param paths - File paths in the affected scope
 */
function addShadowConflicts(
    conflicts: Array<ConflictEntry>,
    oldName: string,
    newName: string,
    paths: Set<string>
): void {
    const message = `Renaming '${oldName}' to '${newName}' would shadow existing symbol in scope`;

    if (paths.size === 0) {
        conflicts.push({
            type: ConflictType.SHADOW,
            message
        });
        return;
    }

    for (const path of paths) {
        conflicts.push({
            type: ConflictType.SHADOW,
            message,
            path
        });
    }
}

function pushShadowConflictIfNeeded(
    conflicts: Array<ConflictEntry>,
    oldName: string,
    newName: string,
    paths: Set<string>,
    existing: { name: string } | null
): void {
    if (!existing || existing.name === oldName) {
        return;
    }

    addShadowConflicts(conflicts, oldName, newName, paths);
}

/**
 * Checks for shadowing conflicts across all scopes.
 * @param oldName - Original symbol name
 * @param normalizedNewName - Normalized new symbol name
 * @param occurrences - All symbol occurrences
 * @param resolver - Symbol resolver for scope-aware lookups
 * @returns Array of shadow conflicts found
 */
function checkShadowingConflicts(
    oldName: string,
    normalizedNewName: string,
    occurrences: Array<SymbolOccurrence>,
    resolver: Partial<SymbolResolver>
): MaybePromise<Array<ConflictEntry>> {
    const conflicts: Array<ConflictEntry> = [];
    const scopeToPaths = groupOccurrencesByScope(occurrences);
    const pendingLookups: Array<Promise<{ existing: { name: string } | null; paths: Set<string> }>> = [];

    for (const [scopeKey, paths] of scopeToPaths) {
        const existing = resolver.lookup(normalizedNewName, scopeKey === GLOBAL_SCOPE_KEY ? undefined : scopeKey);
        if (isPromiseLike(existing)) {
            pendingLookups.push(
                Promise.resolve(existing).then((resolvedExisting) => ({
                    existing: resolvedExisting,
                    paths
                }))
            );
            continue;
        }

        pushShadowConflictIfNeeded(conflicts, oldName, normalizedNewName, paths, existing);
    }

    if (pendingLookups.length === 0) {
        return conflicts;
    }

    return Promise.all(pendingLookups).then((lookupResults) => {
        for (const { existing, paths } of lookupResults) {
            pushShadowConflictIfNeeded(conflicts, oldName, normalizedNewName, paths, existing);
        }

        return conflicts;
    });
}

/**
 * Builds the complete set of reserved keywords by combining defaults with semantic keywords.
 * @param keywordProvider - Provider for semantic reserved keywords (null if not available)
 * @returns Set of all reserved keywords (lowercase)
 */
function buildReservedKeywordSet(
    keywordProvider: Partial<KeywordProvider> | null
): MaybePromise<ReadonlySet<string> | Set<string>> {
    if (!Core.hasMethods(keywordProvider, "getReservedKeywords")) {
        return DEFAULT_RESERVED_KEYWORDS;
    }

    const semanticReserved = keywordProvider.getReservedKeywords() ?? [];
    if (!isPromiseLike(semanticReserved)) {
        return new Set([...DEFAULT_RESERVED_KEYWORDS, ...semanticReserved.map((keyword) => keyword.toLowerCase())]);
    }

    return Promise.resolve(semanticReserved).then((resolvedKeywords) => {
        return new Set([
            ...DEFAULT_RESERVED_KEYWORDS,
            ...(resolvedKeywords ?? []).map((keyword) => keyword.toLowerCase())
        ]);
    });
}

/**
 * Detect conflicts that would arise from renaming a symbol.
 * Checks for reserved keywords and shadowing conflicts.
 *
 * @param oldName - Original symbol name
 * @param newName - Proposed new name
 * @param occurrences - All occurrences of the symbol
 * @param resolver - Symbol resolver for scope-aware checks (null if not available)
 * @param keywordProvider - Keyword provider for reserved keyword checks (null if not available)
 * @returns Array of detected conflicts
 */
export async function detectRenameConflicts(
    oldName: string,
    newName: string,
    occurrences: Array<SymbolOccurrence>,
    resolver: Partial<SymbolResolver> | null,
    keywordProvider: Partial<KeywordProvider> | null
): Promise<Array<ConflictEntry>> {
    const conflicts: Array<ConflictEntry> = [];

    let normalizedNewName: string;
    try {
        normalizedNewName = assertValidIdentifierName(newName);
    } catch (error) {
        conflicts.push({
            type: ConflictType.INVALID_IDENTIFIER,
            message: Core.getErrorMessage(error)
        });
        return conflicts;
    }

    // Check for shadowing conflicts if resolver supports scope-aware lookups
    if (Core.hasMethods(resolver, "lookup")) {
        const shadowConflicts = checkShadowingConflicts(oldName, normalizedNewName, occurrences, resolver);
        conflicts.push(...(isPromiseLike(shadowConflicts) ? await shadowConflicts : shadowConflicts));
    }

    // Check if new name conflicts with reserved keywords
    const reservedKeywords = buildReservedKeywordSet(keywordProvider);
    const resolvedReservedKeywords = isPromiseLike(reservedKeywords) ? await reservedKeywords : reservedKeywords;
    if (resolvedReservedKeywords.has(normalizedNewName.toLowerCase())) {
        conflicts.push({
            type: ConflictType.RESERVED,
            message: `'${normalizedNewName}' is a reserved keyword and cannot be used as an identifier`
        });
    }

    return conflicts;
}

/**
 * Detect circular rename chains in a batch of rename operations.
 * Returns the first detected cycle as an array of symbol IDs, or an empty array if no cycles exist.
 *
 * A circular chain occurs when renames form a cycle, such as:
 * - A→B, B→A (simple 2-cycle)
 * - A→B, B→C, C→A (3-cycle)
 *
 * These chains are problematic because after applying the first rename, subsequent
 * renames in the cycle reference symbols that no longer exist by their original names.
 *
 * @param renames - Rename operations to check
 * @returns First detected cycle as symbol IDs, or empty array if no cycles
 */
export function detectCircularRenames(renames: Array<RenameRequest>): Array<string> {
    // Build rename graph: source ID → target ID
    const graph = new Map<string, string>();
    for (const rename of renames) {
        const parsed = parseSymbolIdParts(rename.symbolId);
        const pathParts = parsed ? [...parsed.segments] : rename.symbolId.split("/");
        pathParts[pathParts.length - 1] = rename.newName;
        graph.set(rename.symbolId, pathParts.join("/"));
    }

    // For each source node, follow the chain until we hit a cycle or dead end
    const visited = new Set<string>();

    for (const start of graph.keys()) {
        if (visited.has(start)) continue;

        const path: Array<string> = [];
        const pathSet = new Set<string>();
        let current = start;

        // Walk the chain from this starting node
        while (graph.has(current)) {
            if (pathSet.has(current)) {
                // Found a cycle - extract it
                const cycleStart = path.indexOf(current);
                return [...path.slice(cycleStart), current];
            }

            path.push(current);
            pathSet.add(current);
            visited.add(current);
            // Safe to assert: graph.has(current) guarantees the value exists
            current = graph.get(current);
        }
    }

    return [];
}

/**
 * Validate rename request structure and basic semantic constraints before planning.
 * This is a pre-flight check that fails fast on invalid requests, avoiding expensive
 * occurrence gathering and conflict detection when the rename is structurally unsound.
 *
 * Unlike full rename validation, this does not gather occurrences or check for
 * shadowing conflicts. It only validates that:
 * - The request has required fields
 * - The identifier names are syntactically valid
 * - The symbol exists in the semantic index (if available)
 * - The new name differs from the old name
 *
 * @param symbolId - Symbol identifier to rename
 * @param newName - Proposed new name
 * @param resolver - Symbol resolver for existence checks (null if not available)
 * @returns Array of validation errors (empty if valid)
 *
 * @example
 * const errors = await validateRenameStructure(
 *   "gml/script/scr_player",
 *   "scr_hero",
 *   semantic
 * );
 * if (errors.length > 0) {
 *   console.error("Invalid rename:", errors);
 *   return;
 * }
 * // Proceed with full rename planning
 */
export async function validateRenameStructure(
    symbolId: string | undefined | null,
    newName: string | undefined | null,
    resolver: Partial<SymbolResolver> | null
): Promise<Array<string>> {
    try {
        Core.assertNonEmptyString(symbolId, {
            name: "symbolId",
            trim: true
        });
    } catch (error) {
        return [Core.getErrorMessage(error)];
    }

    try {
        Core.assertNonEmptyString(newName, {
            name: "newName",
            trim: true
        });
    } catch (error) {
        return [Core.getErrorMessage(error)];
    }

    try {
        assertValidIdentifierName(newName);
    } catch (error) {
        return [Core.getErrorMessage(error)];
    }

    // Extract symbol name from ID
    const symbolName = extractSymbolName(symbolId);

    if (symbolName === newName) {
        return [`The new name '${newName}' matches the existing identifier`];
    }

    if (Core.hasMethods(resolver, "hasSymbol")) {
        const exists = await resolver.hasSymbol(symbolId);
        if (!exists) {
            return [`Symbol '${symbolId}' not found in semantic index`];
        }
    }

    return [];
}

/**
 * Batch validate scope safety for multiple occurrences efficiently.
 * Groups occurrences by scope to minimize redundant lookups, essential for
 * hot reload scenarios where many symbols need validation quickly.
 *
 * @param occurrences - Symbol occurrences to validate
 * @param newName - Proposed new name to check for conflicts
 * @param resolver - Symbol resolver for scope-aware checks
 * @returns Map of scope IDs to conflict information
 *
 * @example
 * const conflicts = await batchValidateScopeConflicts(
 *   occurrences,
 *   "newName",
 *   semantic
 * );
 * for (const [scopeId, conflict] of conflicts) {
 *   console.log(`Scope ${scopeId}: ${conflict.message}`);
 * }
 */
export async function batchValidateScopeConflicts(
    occurrences: Array<SymbolOccurrence>,
    newName: string,
    resolver: Partial<SymbolResolver> | null
): Promise<Map<string, { message: string; existingSymbol: string }>> {
    const conflicts = new Map<string, { message: string; existingSymbol: string }>();

    if (!resolver || typeof resolver.lookup !== "function" || occurrences.length === 0) {
        return conflicts;
    }

    const normalizedNewName = tryNormalizeIdentifierName(newName);
    if (!normalizedNewName) {
        // Return early if the new name is syntactically invalid (e.g., reserved
        // keyword, contains illegal characters). There's no point checking for
        // conflicts when the rename target itself is malformed—validation will
        // fail at the assertion stage anyway. Returning the empty conflicts array
        // here keeps the caller's error reporting focused on the primary validation
        // failure rather than cascading into false-positive conflict detection.
        return conflicts;
    }

    const scopeGroups = groupOccurrencesByKey(occurrences, (occurrence) => occurrence.scopeId ?? GLOBAL_SCOPE_KEY);
    const scopeIds = [...scopeGroups.keys()];
    const lookupResults = await Promise.all(
        scopeIds.map(async (scopeId) => ({
            scopeId,
            existing: await resolver.lookup(normalizedNewName, scopeId === GLOBAL_SCOPE_KEY ? undefined : scopeId)
        }))
    );

    for (const { scopeId, existing } of lookupResults) {
        if (existing) {
            const scopeDisplayName = scopeId === GLOBAL_SCOPE_KEY ? "global scope" : `scope '${scopeId}'`;
            conflicts.set(scopeId, {
                message: `Name '${normalizedNewName}' already exists in ${scopeDisplayName}`,
                existingSymbol: existing.name
            });
        }
    }

    return conflicts;
}

/**
 * Validate that a rename maintains cross-file semantic consistency.
 * This function checks whether renaming a symbol would create ambiguous
 * references across different files in the project.
 *
 * For example, if file A defines and exports `foo`, and file B imports and
 * uses `foo`, renaming it to `bar` in file A must ensure that file B's
 * import is updated to `bar` as well. This validator detects cases where
 * the rename would leave file B with an unresolved reference.
 *
 * @param symbolId - The symbol being renamed
 * @param newName - The proposed new name
 * @param occurrences - All occurrences of the symbol
 * @param fileProvider - Provider for file-level symbol information
 * @returns Array of cross-file consistency errors
 *
 * @example
 * const errors = await validateCrossFileConsistency(
 *   "gml/script/scr_player",
 *   "scr_hero",
 *   occurrences,
 *   semantic
 * );
 * if (errors.length > 0) {
 *   console.error("Cross-file issues:", errors);
 * }
 */
export async function validateCrossFileConsistency(
    symbolId: string,
    newName: string,
    occurrences: Array<SymbolOccurrence>,
    fileProvider: Partial<FileSymbolProvider> | null
): Promise<Array<ConflictEntry>> {
    const errors: Array<ConflictEntry> = [];

    if (!fileProvider || !Core.hasMethods(fileProvider, "getFileSymbols")) {
        return errors;
    }

    if (!symbolId || !newName || occurrences.length === 0) {
        return errors;
    }

    let normalizedNewName: string;
    try {
        normalizedNewName = assertValidIdentifierName(newName);
    } catch (error) {
        errors.push({
            type: ConflictType.INVALID_IDENTIFIER,
            message: Core.getErrorMessage(error)
        });
        return errors;
    }

    // Group occurrences by file to analyze file-level impact
    const fileOccurrenceCounts = new Map<string, number>();
    const appendFileConsistencyConflicts = (
        filePath: string,
        occurrenceCount: number,
        fileSymbols: Array<{ id: string }>
    ) => {
        // Check if the file already defines a symbol with the new name
        const conflictingSymbol = fileSymbols.find((sym) => {
            const symName = extractSymbolName(sym.id);
            return symName === normalizedNewName && sym.id !== symbolId;
        });

        if (conflictingSymbol) {
            errors.push({
                type: ConflictType.SHADOW,
                message: `File '${filePath}' already defines symbol '${normalizedNewName}' (${conflictingSymbol.id})`,
                path: filePath
            });
        }

        // Warn if the file has many occurrences, as this increases the risk
        // of missing a reference during the rename operation
        if (occurrenceCount > 20) {
            errors.push({
                type: ConflictType.LARGE_RENAME,
                message: `File '${filePath}' contains ${occurrenceCount} occurrences - verify all references are updated`,
                severity: "warning",
                path: filePath
            });
        }
    };

    for (const occurrence of occurrences) {
        if (occurrence.path) {
            Core.incrementMapValue(fileOccurrenceCounts, occurrence.path);
        }
    }

    const pendingFileSymbolLookups: Array<Promise<void>> = [];
    for (const [filePath, occurrenceCount] of fileOccurrenceCounts) {
        const fileSymbols = fileProvider.getFileSymbols(filePath);
        if (isPromiseLike(fileSymbols)) {
            pendingFileSymbolLookups.push(
                Promise.resolve(fileSymbols).then((resolvedFileSymbols) =>
                    appendFileConsistencyConflicts(filePath, occurrenceCount, resolvedFileSymbols ?? [])
                )
            );
            continue;
        }

        appendFileConsistencyConflicts(filePath, occurrenceCount, fileSymbols ?? []);
    }

    if (pendingFileSymbolLookups.length > 0) {
        await Promise.all(pendingFileSymbolLookups);
    }

    return errors;
}

// ---------------------------------------------------------------------------
// Batch-rename bookkeeping helpers
// ---------------------------------------------------------------------------

/** One entry per symbolId that appears more than once in a batch rename request. */
export interface DuplicateSymbolIdEntry {
    symbolId: string;
    count: number;
}

/**
 * One entry per normalised new name that is targeted by more than one symbol in
 * the same batch rename request.
 */
export interface DuplicateTargetNameEntry {
    newName: string;
    symbolIds: ReadonlyArray<string>;
}

/**
 * One entry per rename whose normalised new name matches an original symbol name
 * elsewhere in the same batch.
 */
export interface CrossRenameConfusion {
    symbolId: string;
    newName: string;
}

/**
 * Identifies symbolIds that appear more than once in a batch rename request.
 *
 * Renaming the same symbol more than once creates ambiguous intent and would
 * generate conflicting edits. Returns one entry per duplicated symbolId so the
 * caller can surface errors and collect the relevant conflicting sets.
 *
 * @param renames - The batch rename requests to inspect
 * @returns Entries for every symbolId whose frequency in the batch exceeds one
 */
export function detectDuplicateSourceSymbolIds(
    renames: ReadonlyArray<RenameRequest>
): ReadonlyArray<DuplicateSymbolIdEntry> {
    const counts = new Map<string, number>();
    for (const rename of renames) {
        if (rename && typeof rename === "object" && typeof rename.symbolId === "string") {
            Core.incrementMapValue(counts, rename.symbolId);
        }
    }

    const duplicates: Array<DuplicateSymbolIdEntry> = [];
    for (const [symbolId, count] of counts) {
        if (count > 1) {
            duplicates.push({ symbolId, count });
        }
    }
    return duplicates;
}

/**
 * Identifies normalised new names that are targeted by more than one rename in the batch.
 *
 * When two renames share the same target name (e.g. renaming both `foo` and `bar` to
 * `baz`), the result would have duplicate definitions.  Returns one entry per colliding
 * name so the caller can surface errors and collect conflicting sets.
 *
 * Invalid rename entries (missing or non-string `symbolId` / `newName`) and entries
 * whose new name cannot be normalised to a valid identifier are silently skipped; those
 * failures are reported by the per-rename validation pass that runs before this check.
 *
 * @param renames - The batch rename requests to inspect
 * @returns Entries for every normalised new name claimed by more than one rename
 */
export function detectDuplicateTargetNames(
    renames: ReadonlyArray<RenameRequest>
): ReadonlyArray<DuplicateTargetNameEntry> {
    const nameToSymbols = new Map<string, Array<string>>();
    for (const rename of renames) {
        if (
            !rename ||
            typeof rename !== "object" ||
            !rename.symbolId ||
            typeof rename.symbolId !== "string" ||
            !rename.newName ||
            typeof rename.newName !== "string"
        ) {
            // Skip structurally invalid entries — those are already flagged by the
            // per-rename validation pass that precedes this check.
            continue;
        }

        const normalizedNewName = tryNormalizeIdentifierName(rename.newName);
        if (!normalizedNewName) {
            // Skip entries whose new name is not a valid identifier; they are
            // reported by the per-rename pass and do not contribute to name
            // collision detection.
            continue;
        }

        const group = nameToSymbols.get(normalizedNewName);
        if (group) {
            group.push(rename.symbolId);
        } else {
            nameToSymbols.set(normalizedNewName, [rename.symbolId]);
        }
    }

    const duplicates: Array<DuplicateTargetNameEntry> = [];
    for (const [newName, symbolIds] of nameToSymbols) {
        if (symbolIds.length > 1) {
            duplicates.push({ newName, symbolIds });
        }
    }
    return duplicates;
}

/**
 * Identifies renames whose normalised new name shadows another symbol's original name
 * in the same batch.
 *
 * This catches non-circular naming conflicts such as renaming `foo→bar` alongside
 * `bar→baz`. Even though it is not a cycle, the intermediate state would have two
 * symbols named `bar`, creating confusion about which references point to which
 * definition.  Accepts only structurally valid rename entries (non-empty string
 * `symbolId` and `newName`); malformed entries are silently skipped.
 *
 * @param validRenames - Structurally valid rename requests (symbolId and newName are
 *   non-empty strings). Typically the filtered subset already computed for
 *   `detectCircularRenames`.
 * @returns One entry per rename whose new name matches an existing old name in the batch
 */
export function detectCrossRenameNameConfusion(
    validRenames: ReadonlyArray<RenameRequest>
): ReadonlyArray<CrossRenameConfusion> {
    // Collect all original symbol names so the second pass can test membership in O(1).
    const oldNames = new Set<string>();
    for (const rename of validRenames) {
        const oldName = extractSymbolName(rename.symbolId);
        if (oldName) {
            oldNames.add(oldName);
        }
    }

    const confusions: Array<CrossRenameConfusion> = [];
    for (const rename of validRenames) {
        const oldName = extractSymbolName(rename.symbolId);
        if (!oldName) {
            continue;
        }

        const normalizedNewName = tryNormalizeIdentifierName(rename.newName);
        if (!normalizedNewName) {
            // Skip entries whose new name fails identifier normalisation — those
            // errors are already surfaced by the per-rename validation pass.
            continue;
        }

        // Warn if the new name was an existing old name. The `oldName !== normalizedNewName`
        // guard skips same-symbol renames (e.g., `scr_a → scr_a`): those are already
        // flagged as same-name errors by the structural validation pass, so they do not
        // represent a cross-rename confusion between two different symbols.
        if (oldNames.has(normalizedNewName) && oldName !== normalizedNewName) {
            confusions.push({ symbolId: rename.symbolId, newName: normalizedNewName });
        }
    }
    return confusions;
}
