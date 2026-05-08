import { type GameMakerAstLocation } from "@gmloop/core";

/**
 * A location range in the source code.
 */
export type Location = {
    start: GameMakerAstLocation;
    end: GameMakerAstLocation;
};

/**
 * Metadata for a declaration or reference occurrence.
 */
export type Occurrence = {
    kind: "declaration" | "reference";
    name: string | null;
    scopeId: string | null;
    classifications: string[];
    declaration: {
        scopeId: string | null;
        start: GameMakerAstLocation;
        end: GameMakerAstLocation;
    } | null;
    usageContext: {
        isRead?: boolean;
        isWrite?: boolean;
        isAssignmentTarget?: boolean;
        isCallTarget?: boolean;
        parentType?: string;
    } | null;
} & Location;

/**
 * Summary of what a scope contains for a particular symbol.
 */
export type ScopeSummary = {
    hasDeclaration: boolean;
    hasReference: boolean;
    /** Most recent declaration/reference timestamp for this symbol in this scope. */
    lastModified: number;
};

/**
 * Role information for a scope/symbol resolution.
 */
export type ScopeRole = {
    type?: string;
    scopeOverride?: unknown;
    tags?: Iterable<string | undefined | null>;
    kind?: string;
};

/**
 * Details of modifications made to a scope.
 */
export type ScopeModificationDetails = {
    scopeId: string;
    scopeKind: string;
    lastModified: number;
    modificationCount: number;
    declarationCount: number;
    referenceCount: number;
    symbolCount: number;
    symbols: Array<{
        name: string;
        declarationCount: number;
        referenceCount: number;
    }>;
};

/**
 * SCIP-compatible occurrence data.
 */
export type ScipOccurrence = {
    range: [number, number, number, number];
    symbol: string;
    symbolRoles: number;
};

/**
 * Metadata associated with a scope.
 */
export type ScopeMetadata = {
    name?: string;
    path?: string;
} & Partial<Location>;

/**
 * Detailed information about a scope.
 */
export type ScopeDetails = {
    scopeId: string;
    scopeKind: string;
} & ScopeMetadata;

/**
 * Information about a scope's modification status.
 */
export type ScopeModificationMetadata = {
    scopeId: string;
    scopeKind: string;
    lastModified: number;
    modificationCount: number;
};

/**
 * Information about a symbol declaration.
 */
export type SymbolDeclarationInfo = {
    name: string;
    scopeId: string;
    scopeKind: string;
    metadata: ScopeSymbolMetadata;
};

/**
 * SCIP occurrences grouped by scope.
 */
export type ScopeScipOccurrences = {
    scopeId: string;
    scopeKind: string;
    occurrences: ScipOccurrence[];
};

/**
 * Metadata for a symbol declaration.
 */
export type ScopeSymbolMetadata = {
    name: string | null;
    scopeId: string | null;
    classifications: string[];
} & Location;

/**
 * A definition of a symbol within a scope.
 */
export type SymbolDefinition = {
    name: string;
    metadata: ScopeSymbolMetadata;
};

/**
 * A reference to a symbol declared in an external scope.
 */
export type ExternalReference = {
    name: string;
    declaringScopeId: string | null;
    referencingScopeId: string;
    declaration: ScopeSymbolMetadata | null;
    occurrences: Occurrence[];
};

/**
 * Dependency information between scopes.
 */
export type ScopeDependency = {
    dependencyScopeId: string;
    dependencyScopeKind: string;
    symbols: string[];
};

/**
 * Dependent information between scopes.
 */
export type ScopeDependent = {
    dependentScopeId: string;
    dependentScopeKind: string;
    symbols: string[];
};

/**
 * Occurrence tracking for a specific identifier within a scope.
 */
export type IdentifierOccurrences = {
    declarations: Array<Occurrence>;
    references: Array<Occurrence>;
};

/**
 * Summary of all occurrences within a scope.
 */
export type ScopeOccurrencesSummary = {
    scopeId: string;
    scopeKind: string;
    lastModified: number;
    modificationCount: number;
    identifiers: Array<{
        name: string;
        declarations: Occurrence[];
        references: Occurrence[];
    }>;
};

/**
 * An occurrence of a symbol with scope context.
 */
export type SymbolOccurrence = {
    scopeId: string;
    scopeKind: string;
    kind: "declaration" | "reference";
    occurrence: Occurrence;
};

/**
 * Summary of a symbol's status within a specific scope.
 */
export type SymbolScopeSummary = {
    scopeId: string;
    scopeKind: string;
    hasDeclaration: boolean;
    hasReference: boolean;
};

/**
 * A summary item for all symbols across the tracker.
 */
export type AllSymbolsSummaryItem = {
    name: string;
    scopeCount: number;
    declarationCount: number;
    referenceCount: number;
    scopes: SymbolScopeSummary[];
};
