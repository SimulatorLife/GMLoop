import { ROLE_DEF, ROLE_REF } from "../symbols/scip.js";
import type { Scope } from "./scope.js";
import type { IdentifierOccurrences, Occurrence, ScipOccurrence, ScopeScipOccurrences, ScopeSummary } from "./types.js";

/**
 * Read-only window onto the {@link ScopeTracker} that the SCIP export helpers
 * rely on. Defining the surface as an interface keeps this module decoupled
 * from the tracker's implementation, so the export pipeline can be tested
 * against lightweight fakes and so changes to the tracker's internals do not
 * ripple into the serialization layer.
 */
export interface ScipExportView {
    readonly scopesById: ReadonlyMap<string, Scope>;
    readonly symbolToScopesIndex: ReadonlyMap<string, ReadonlyMap<string, ScopeSummary>>;
}

export interface ScipExportOptions {
    scopeId?: string | null;
    includeReferences?: boolean;
    symbolGenerator?: (name: string, scopeId: string) => string | null;
}

const DEFAULT_INCLUDE_REFERENCES = true;

function defaultScipSymbolGenerator(name: string, scopeId: string): string {
    return `${scopeId}::${name}`;
}

function toScipOccurrence(
    occurrence: Occurrence,
    symbolRoles: number,
    getSymbol: (name: string, scopeId: string) => string | null
): ScipOccurrence | null {
    const start = occurrence.start;
    const end = occurrence.end;

    if (!start || !end) {
        return null;
    }

    const startLine = typeof start.line === "number" ? start.line : null;
    const startCol = typeof start.column === "number" ? start.column : 0;
    const endLine = typeof end.line === "number" ? end.line : null;
    const endCol = typeof end.column === "number" ? end.column : 0;

    if (startLine === null || endLine === null) {
        return null;
    }

    const name = occurrence.name;
    const occScopeId = occurrence.scopeId;

    if (!name || !occScopeId) {
        return null;
    }

    const symbol = getSymbol(name, occScopeId);
    if (!symbol) {
        return null;
    }

    return {
        range: [startLine, startCol, endLine, endCol],
        symbol,
        symbolRoles
    };
}

function appendScipDeclarations(
    entry: IdentifierOccurrences,
    occurrences: ScipOccurrence[],
    getSymbol: (name: string, scopeId: string) => string | null
): void {
    for (const declaration of entry.declarations) {
        const scipOcc = toScipOccurrence(declaration, ROLE_DEF, getSymbol);
        if (scipOcc) {
            occurrences.push(scipOcc);
        }
    }
}

function appendScipReferences(
    entry: IdentifierOccurrences,
    occurrences: ScipOccurrence[],
    getSymbol: (name: string, scopeId: string) => string | null
): void {
    for (const reference of entry.references) {
        const scipOcc = toScipOccurrence(reference, ROLE_REF, getSymbol);
        if (scipOcc) {
            occurrences.push(scipOcc);
        }
    }
}

function getSingleScopeArray(view: ScipExportView, scopeId: string): Scope[] {
    const scope = view.scopesById.get(scopeId);
    return scope ? [scope] : [];
}

function collectScopesForSymbols(view: ScipExportView, symbolSet: Set<string>): Scope[] {
    const scopeIds = new Set<string>();

    for (const symbol of symbolSet) {
        const scopeSummaryMap = view.symbolToScopesIndex.get(symbol);
        if (!scopeSummaryMap) {
            continue;
        }

        for (const scopeId of scopeSummaryMap.keys()) {
            scopeIds.add(scopeId);
        }
    }

    if (scopeIds.size === 0) {
        return [];
    }

    const scopes: Scope[] = [];
    for (const scopeId of scopeIds) {
        const scope = view.scopesById.get(scopeId);
        if (scope) {
            scopes.push(scope);
        }
    }

    return scopes;
}

function sortByScopeId(results: ScopeScipOccurrences[]): void {
    // Sort in place using simple string comparison to keep the export output
    // deterministic for consumers that diff SCIP payloads across runs.
    results.sort((a, b) => (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0));
}

/**
 * Serializes every occurrence recorded in `view` into the SCIP wire format.
 *
 * This function is a pure transformation over the read-only tracker state.
 * It performs no mutation of the source and is safe to call concurrently with
 * other read-only queries against the same view.
 */
export function exportScipOccurrencesFromTracker(
    view: ScipExportView,
    options: ScipExportOptions = {}
): ScopeScipOccurrences[] {
    const { scopeId = null, includeReferences = DEFAULT_INCLUDE_REFERENCES, symbolGenerator = null } = options;

    const results: ScopeScipOccurrences[] = [];
    const getSymbol = symbolGenerator ?? defaultScipSymbolGenerator;

    const scopesToProcess = scopeId ? getSingleScopeArray(view, scopeId) : Array.from(view.scopesById.values());

    for (const scope of scopesToProcess) {
        const occurrences: ScipOccurrence[] = [];

        for (const entry of scope.occurrences.values()) {
            appendScipDeclarations(entry, occurrences, getSymbol);
            if (includeReferences) {
                appendScipReferences(entry, occurrences, getSymbol);
            }
        }

        if (occurrences.length > 0) {
            results.push({
                scopeId: scope.id,
                scopeKind: scope.kind,
                occurrences
            });
        }
    }

    sortByScopeId(results);
    return results;
}

/**
 * Symbol-filtered variant of {@link exportScipOccurrencesFromTracker}.
 *
 * Limits serialization to the requested symbol set so callers (notably the
 * hot-reload invalidation pipeline) can avoid emitting SCIP entries for
 * symbols that did not change.
 */
export function exportOccurrencesBySymbolsFromTracker(
    view: ScipExportView,
    symbolNames: Iterable<string>,
    options: ScipExportOptions = {}
): ScopeScipOccurrences[] {
    const { scopeId = null, includeReferences = DEFAULT_INCLUDE_REFERENCES, symbolGenerator = null } = options;
    const symbolSet = new Set(symbolNames);

    if (symbolSet.size === 0) {
        return [];
    }

    const results: ScopeScipOccurrences[] = [];
    const getSymbol = symbolGenerator ?? defaultScipSymbolGenerator;

    const scopesToProcess = scopeId ? getSingleScopeArray(view, scopeId) : collectScopesForSymbols(view, symbolSet);

    if (scopesToProcess.length === 0) {
        return [];
    }

    for (const scope of scopesToProcess) {
        const occurrences: ScipOccurrence[] = [];

        // Look up each requested symbol directly instead of scanning every
        // occurrence entry in the scope. Hot-reload callers typically request
        // a handful of changed symbols out of a much larger declared set, so
        // this keeps the cost proportional to `symbolSet.size` rather than to
        // the scope's total occurrence count.
        for (const name of symbolSet) {
            const entry = scope.occurrences.get(name);
            if (!entry) {
                continue;
            }

            appendScipDeclarations(entry, occurrences, getSymbol);
            if (includeReferences) {
                appendScipReferences(entry, occurrences, getSymbol);
            }
        }

        if (occurrences.length > 0) {
            results.push({
                scopeId: scope.id,
                scopeKind: scope.kind,
                occurrences
            });
        }
    }

    sortByScopeId(results);
    return results;
}
