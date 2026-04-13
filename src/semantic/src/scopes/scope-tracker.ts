import { Core, type MutableGameMakerAstNode } from "@gmloop/core";

import { ROLE_DEF, ROLE_REF } from "../symbols/scip-types.js";
import { IdentifierCacheManager } from "./identifier-cache-manager.js";
import { cloneDeclarationMetadata, cloneOccurrence, createOccurrence } from "./occurrence.js";
import { GlobalIdentifierRegistry } from "./registry.js";
import { IdentifierRoleTracker } from "./role-tracker.js";
import { ensureIdentifierOccurrences, Scope } from "./scope.js";
import {
    formatKnownScopeOverrideKeywords,
    isScopeOverrideKeyword,
    ScopeOverrideKeyword
} from "./scope-override-keywords.js";
import type {
    AllSymbolsSummaryItem,
    ExternalReference,
    IdentifierOccurrences,
    Occurrence,
    ScipOccurrence,
    ScopeDependency,
    ScopeDependent,
    ScopeDetails,
    ScopeMetadata,
    ScopeModificationDetails,
    ScopeModificationMetadata,
    ScopeOccurrencesSummary,
    ScopeRole,
    ScopeScipOccurrences,
    ScopeSummary,
    ScopeSymbolMetadata,
    SymbolDeclarationInfo,
    SymbolDefinition,
    SymbolOccurrence,
    SymbolScopeSummary
} from "./types.js";

/**
 * Resolves a scope override string to a scope object.
 */
function resolveStringScopeOverride(
    tracker: ScopeTracker,
    scopeOverride: string,
    currentScope: Scope | null
): Scope | null {
    if (isScopeOverrideKeyword(scopeOverride)) {
        return scopeOverride === ScopeOverrideKeyword.GLOBAL ? (tracker.getRootScope() ?? currentScope) : currentScope;
    }

    const found = tracker.getScopeStack().find((scope) => scope.id === scopeOverride);

    if (found) {
        return found;
    }

    const keywords = formatKnownScopeOverrideKeywords();
    throw new RangeError(
        `Unknown scope override string '${scopeOverride}'. Expected one of: ${keywords}, or a known scope identifier.`
    );
}

const DEFAULT_DECLARATION_ROLE: ScopeRole = Object.freeze({ type: "declaration" });
const DEFAULT_REFERENCE_ROLE: ScopeRole = Object.freeze({ type: "reference" });
const DEFAULT_LOOKUP_CACHE_MAX_ENTRIES = 2048;

/**
 * Manages lexical and structural scopes, symbol declarations, and references.
 */
export class ScopeTracker {
    private scopeCounter: number = 0;
    private scopeStack: Scope[];
    private rootScope: Scope | null;
    private scopesById: Map<string, Scope>;
    private scopeChildrenIndex: Map<string, Set<string>>;
    private symbolToScopesIndex: Map<string, Map<string, ScopeSummary>>;
    private pathToScopesIndex: Map<string, Set<string>>;
    private pathLastModifiedIndex: Map<string, number>;
    private enabled: boolean;
    private identifierRoleTracker: IdentifierRoleTracker;
    private globalIdentifierRegistry: GlobalIdentifierRegistry;
    private identifierCache: IdentifierCacheManager;
    private lookupCache: Map<string, ScopeSymbolMetadata | null>;
    private lookupCacheDepth: number;
    private lookupCacheMaxEntries: number;

    private collectUniqueSymbolNames(names: Iterable<string>): string[] {
        const uniqueNames = new Set<string>();

        for (const name of names) {
            if (!name) {
                continue;
            }

            uniqueNames.add(name);
        }

        return [...uniqueNames];
    }

    private normalizeTrackedPath(path: string): string {
        // Most tracked paths are already POSIX-style, so avoid the replaceAll()
        // scan and string allocation on that common case.
        return path.includes("\\") ? path.replaceAll("\\", "/") : path;
    }

    private collectFilePathsForSymbolSummaries(
        scopeSummaryMap: Map<string, ScopeSummary>,
        occurrenceKind: "declaration" | "reference"
    ): Set<string> {
        const paths = new Set<string>();

        for (const [scopeId, summary] of scopeSummaryMap) {
            if (occurrenceKind === "declaration" && !summary.hasDeclaration) {
                continue;
            }

            if (occurrenceKind === "reference" && !summary.hasReference) {
                continue;
            }

            const scope = this.scopesById.get(scopeId);
            const path = scope?.metadata.path;
            if (path) {
                paths.add(this.normalizeTrackedPath(path));
            }
        }

        return paths;
    }

    private updatePathLastModifiedForScope(scope: Scope): void {
        const path = scope.metadata.path;
        if (!path) {
            return;
        }

        const timestamp = scope.lastModifiedTimestamp;
        if (timestamp < 0) {
            return;
        }

        const trackedPath = this.normalizeTrackedPath(path);
        const previousTimestamp = this.pathLastModifiedIndex.get(trackedPath);
        if (previousTimestamp === undefined || timestamp > previousTimestamp) {
            this.pathLastModifiedIndex.set(trackedPath, timestamp);
        }
    }

    private recomputePathLastModified(path: string): void {
        const trackedPath = this.normalizeTrackedPath(path);
        const scopeIds = this.pathToScopesIndex.get(trackedPath);
        if (!scopeIds || scopeIds.size === 0) {
            this.pathLastModifiedIndex.delete(trackedPath);
            return;
        }

        let latestTimestamp = -1;
        for (const scopeId of scopeIds) {
            const scope = this.scopesById.get(scopeId);
            if (!scope) {
                continue;
            }

            if (scope.lastModifiedTimestamp > latestTimestamp) {
                latestTimestamp = scope.lastModifiedTimestamp;
            }
        }

        if (latestTimestamp < 0) {
            this.pathLastModifiedIndex.delete(trackedPath);
            return;
        }

        this.pathLastModifiedIndex.set(trackedPath, latestTimestamp);
    }

    private getTrackedSymbolSummaries(name: string | null | undefined): Map<string, ScopeSummary> | null {
        if (!name) {
            return null;
        }

        const scopeSummaryMap = this.symbolToScopesIndex.get(name);
        if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
            return null;
        }

        return scopeSummaryMap;
    }

    private collectSymbolOccurrencesForName(
        name: string | null | undefined,
        {
            cloneOccurrences,
            includeDeclarations,
            includeReferences,
            referenceFilter
        }: {
            cloneOccurrences: boolean;
            includeDeclarations: boolean;
            includeReferences: boolean;
            referenceFilter: (occurrence: Occurrence) => boolean;
        }
    ): SymbolOccurrence[] {
        const scopeSummaryMap = this.getTrackedSymbolSummaries(name);
        if (!scopeSummaryMap) {
            return [];
        }

        const results: SymbolOccurrence[] = [];
        for (const scopeId of scopeSummaryMap.keys()) {
            const scope = this.scopesById.get(scopeId);
            if (!scope) {
                continue;
            }

            const entry = scope.occurrences.get(name);
            if (!entry) {
                continue;
            }

            if (includeDeclarations) {
                for (const declaration of entry.declarations) {
                    results.push({
                        scopeId: scope.id,
                        scopeKind: scope.kind,
                        kind: "declaration",
                        occurrence: cloneOccurrences ? cloneOccurrence(declaration) : declaration
                    });
                }
            }

            if (includeReferences) {
                for (const reference of entry.references) {
                    if (!referenceFilter(reference)) {
                        continue;
                    }

                    results.push({
                        scopeId: scope.id,
                        scopeKind: scope.kind,
                        kind: "reference",
                        occurrence: cloneOccurrences ? cloneOccurrence(reference) : reference
                    });
                }
            }
        }

        return results;
    }

    private collectSymbolReadWriteOccurrences(
        name: string | null | undefined,
        options: {
            cloneOccurrences: boolean;
            accessKind: "read" | "write";
        }
    ): SymbolOccurrence[] {
        const { cloneOccurrences, accessKind } = options;

        return this.collectSymbolOccurrencesForName(name, {
            cloneOccurrences,
            includeDeclarations: false,
            includeReferences: true,
            referenceFilter: (occurrence) =>
                accessKind === "write"
                    ? Boolean(occurrence.usageContext?.isWrite)
                    : Boolean(occurrence.usageContext?.isRead)
        });
    }

    constructor({
        enabled = true,
        lookupCacheMaxEntries = DEFAULT_LOOKUP_CACHE_MAX_ENTRIES,
        identifierCacheMaxTrackedNames = 4000,
        identifierCacheMaxScopesPerName = 64
    } = {}) {
        this.scopeStack = [];
        this.rootScope = null;
        this.scopesById = new Map();
        this.scopeChildrenIndex = new Map();
        this.symbolToScopesIndex = new Map();
        this.pathToScopesIndex = new Map();
        this.pathLastModifiedIndex = new Map();
        this.enabled = Boolean(enabled);
        this.identifierRoleTracker = new IdentifierRoleTracker();
        this.globalIdentifierRegistry = new GlobalIdentifierRegistry();
        this.identifierCache = new IdentifierCacheManager({
            maxTrackedNames: identifierCacheMaxTrackedNames,
            maxScopesPerName: identifierCacheMaxScopesPerName
        });
        this.lookupCache = new Map();
        this.lookupCacheDepth = -1;
        this.lookupCacheMaxEntries =
            typeof lookupCacheMaxEntries === "number" && Number.isFinite(lookupCacheMaxEntries)
                ? Math.max(1, Math.floor(lookupCacheMaxEntries))
                : DEFAULT_LOOKUP_CACHE_MAX_ENTRIES;
    }

    private readLookupCache(name: string): ScopeSymbolMetadata | null | undefined {
        const cached = this.lookupCache.get(name);
        if (cached === undefined) {
            return undefined;
        }

        // Move cache entry to the end to keep a simple insertion-order LRU.
        this.lookupCache.delete(name);
        this.lookupCache.set(name, cached);
        return cached;
    }

    private writeLookupCache(name: string, metadata: ScopeSymbolMetadata | null): void {
        this.lookupCache.delete(name);
        this.lookupCache.set(name, metadata);

        while (this.lookupCache.size > this.lookupCacheMaxEntries) {
            const oldestName = this.lookupCache.keys().next().value;
            if (!oldestName) {
                break;
            }

            this.lookupCache.delete(oldestName);
        }
    }

    /**
     * Executes a callback within a new scope of the specified kind.
     */
    public withScope<T>(kind: string, callback: () => T, metadata: ScopeMetadata = {}): T {
        this.enterScope(kind, metadata);
        try {
            return callback();
        } finally {
            this.exitScope();
        }
    }

    /**
     * Enters a new scope.
     */
    public enterScope(kind: string, metadata: ScopeMetadata = {}): Scope {
        const parent = this.scopeStack.at(-1) ?? null;
        const scope = new Scope(`scope-${this.scopeCounter++}`, kind ?? "unknown", parent, metadata);
        this.scopeStack.push(scope);
        this.scopesById.set(scope.id, scope);
        scope.stackIndex = this.scopeStack.length - 1;
        if (!this.rootScope) {
            this.rootScope = scope;
        }
        if (parent) {
            let children = this.scopeChildrenIndex.get(parent.id);
            if (!children) {
                children = new Set<string>();
                this.scopeChildrenIndex.set(parent.id, children);
            }
            children.add(scope.id);
        }

        const path = metadata?.path;
        if (typeof path === "string" && path.length > 0) {
            const trackedPath = this.normalizeTrackedPath(path);
            let scopeSet = this.pathToScopesIndex.get(trackedPath);
            if (!scopeSet) {
                scopeSet = new Set<string>();
                this.pathToScopesIndex.set(trackedPath, scopeSet);
            }
            scopeSet.add(scope.id);
        }

        // Invalidate lookup cache on scope depth change
        if (this.lookupCacheDepth !== this.scopeStack.length) {
            this.lookupCache.clear();
            this.lookupCacheDepth = this.scopeStack.length;
        }

        return scope;
    }

    /**
     * Exits the current scope.
     */
    public exitScope(): void {
        const scope = this.scopeStack.pop();
        if (scope) {
            scope.stackIndex = null;
        }
        // Invalidate lookup cache on scope depth change
        if (this.lookupCacheDepth !== this.scopeStack.length) {
            this.lookupCache.clear();
            this.lookupCacheDepth = this.scopeStack.length;
        }
    }

    /**
     * Returns the current active scope.
     */
    public currentScope(): Scope | null {
        return this.scopeStack.at(-1) ?? null;
    }

    /**
     * Returns the root scope of the tracker.
     */
    public getRootScope(): Scope | null {
        return this.rootScope;
    }

    /**
     * Internal getter for the scope stack.
     */
    public getScopeStack(): Scope[] {
        return this.scopeStack;
    }

    /**
     * Helper method to get a single scope as an array, avoiding filter allocation.
     * Returns empty array if scope doesn't exist.
     */
    private getSingleScopeArray(scopeId: string): Scope[] {
        const scope = this.scopesById.get(scopeId);
        return scope ? [scope] : [];
    }

    private getDescendantScopeIds(scopeId: string): Set<string> {
        const descendants = new Set<string>();
        const children = this.scopeChildrenIndex.get(scopeId);

        if (!children || children.size === 0) {
            return descendants;
        }

        // Use an array as a stack to avoid Set iteration overhead
        const stack: string[] = [];
        for (const childId of children) {
            stack.push(childId);
        }

        while (stack.length > 0) {
            const childId = stack.pop();
            if (!childId || descendants.has(childId)) {
                continue;
            }

            descendants.add(childId);

            const grandChildren = this.scopeChildrenIndex.get(childId);
            if (grandChildren && grandChildren.size > 0) {
                for (const grandChildId of grandChildren) {
                    stack.push(grandChildId);
                }
            }
        }

        return descendants;
    }

    private clearResolveIdentifierCacheForName(
        name: string | null | undefined,
        declaringScopeId?: string | null
    ): void {
        if (!name) {
            return;
        }

        if (!declaringScopeId) {
            this.identifierCache.invalidate(name);
            return;
        }

        const descendantIds = this.getDescendantScopeIds(declaringScopeId);
        // Add the declaring scope itself to the set to avoid array allocation
        descendantIds.add(declaringScopeId);
        this.identifierCache.invalidate(name, descendantIds);
    }

    public resolveScopeOverride(scopeOverride: unknown): Scope | null {
        const currentScope = this.currentScope();

        if (!scopeOverride) {
            return currentScope;
        }

        if (this.isScopeObject(scopeOverride)) {
            return scopeOverride;
        }

        if (typeof scopeOverride === "string") {
            return resolveStringScopeOverride(this, scopeOverride, currentScope);
        }

        return currentScope;
    }

    private isScopeObject(value: unknown): value is Scope {
        return (
            typeof value === "object" &&
            value !== null &&
            "id" in value &&
            typeof (value as { id: unknown }).id === "string"
        );
    }

    public buildClassifications(role?: ScopeRole | null, isDeclaration: boolean = false): string[] {
        const tags = new Set(["identifier", isDeclaration ? "declaration" : "reference"]);

        const roleKind = role?.kind;
        if (typeof roleKind === "string") {
            tags.add(roleKind);
        }

        if (role?.tags) {
            for (const tag of role.tags) {
                if (tag) {
                    tags.add(tag);
                }
            }
        }

        return [...tags];
    }

    private storeDeclaration(scope: Scope | null, name: string, metadata: ScopeSymbolMetadata): void {
        if (!scope || !name) {
            return;
        }
        scope.symbolMetadata.set(name, metadata);
        // Invalidate cache for this name since a new declaration may shadow previous lookups
        this.lookupCache.delete(name);
    }

    private recordScopeOccurrence(
        scope: Scope | null | undefined,
        name: string | null | undefined,
        occurrence: Occurrence
    ): void {
        if (!scope || !name || !occurrence) {
            return;
        }

        const entry = ensureIdentifierOccurrences(scope, name);
        const isReference = occurrence.kind === "reference";

        if (isReference) {
            entry.references.push(occurrence);
        } else {
            entry.declarations.push(occurrence);
        }

        scope.markModified();
        this.updatePathLastModifiedForScope(scope);

        let scopeSummaryMap = this.symbolToScopesIndex.get(name);
        if (!scopeSummaryMap) {
            scopeSummaryMap = new Map<string, ScopeSummary>();
            this.symbolToScopesIndex.set(name, scopeSummaryMap);
        }

        let scopeSummary = scopeSummaryMap.get(scope.id);
        if (!scopeSummary) {
            scopeSummary = { hasDeclaration: false, hasReference: false };
            scopeSummaryMap.set(scope.id, scopeSummary);
        }

        if (isReference) {
            scopeSummary.hasReference = true;
        } else {
            scopeSummary.hasDeclaration = true;
        }
    }

    public lookup(name: string | null | undefined): ScopeSymbolMetadata | null {
        if (!this.enabled || !name) {
            return null;
        }

        // Check cache first (cache is invalidated on scope depth changes)
        const cached = this.readLookupCache(name);
        if (cached !== undefined) {
            return cached;
        }

        // Perform lookup
        for (let i = this.scopeStack.length - 1; i >= 0; i--) {
            const scope = this.scopeStack[i];
            const metadata = scope.symbolMetadata.get(name);
            if (metadata) {
                this.writeLookupCache(name, metadata);
                return metadata;
            }
        }

        // Cache miss result
        this.writeLookupCache(name, null);
        return null;
    }

    public declare(
        name: string | null | undefined,
        node: MutableGameMakerAstNode | null | undefined,
        role?: ScopeRole
    ): void {
        if (!this.enabled || !name || !node) {
            return;
        }

        const normalizedRole = role ?? DEFAULT_DECLARATION_ROLE;
        const scope = this.resolveScopeOverride(normalizedRole.scopeOverride);
        const scopeId = scope?.id ?? null;
        const classifications = this.buildClassifications(normalizedRole, true);

        const metadata: ScopeSymbolMetadata = {
            name,
            scopeId: scopeId ?? "",
            classifications,
            start: { line: 0, column: 0, index: 0 },
            end: { line: 0, column: 0, index: 0 }
        };

        Core.assignClonedLocation(metadata, node);

        this.storeDeclaration(scope, name, metadata);
        this.clearResolveIdentifierCacheForName(name, scopeId);

        node.scopeId = scopeId;
        node.declaration = Core.assignClonedLocation({ scopeId: scopeId ?? undefined }, metadata);
        node.classifications = classifications;

        const occurrence = createOccurrence("declaration", metadata, node, metadata);
        this.recordScopeOccurrence(scope, name, occurrence);
    }

    public reference(
        name: string | null | undefined,
        node: MutableGameMakerAstNode | null | undefined,
        role?: ScopeRole
    ): void {
        if (!this.enabled || !name || !node) {
            return;
        }

        const normalizedRole = role ?? DEFAULT_REFERENCE_ROLE;
        const scope = this.currentScope();
        const scopeId = scope?.id ?? null;
        const declaration = this.lookup(name);

        let derivedTags: string[] = [];
        if (declaration?.classifications) {
            derivedTags = declaration.classifications.filter((tag) => tag !== "identifier" && tag !== "declaration");
        }

        const combinedRole: ScopeRole = {
            ...normalizedRole,
            tags: [...derivedTags, ...Array.from(normalizedRole.tags ?? [])]
        };

        const classifications = this.buildClassifications(combinedRole, false);

        node.scopeId = scopeId;
        node.classifications = classifications;

        node.declaration = declaration
            ? Core.assignClonedLocation({ scopeId: declaration.scopeId }, declaration)
            : null;

        const occurrenceMetadata = {
            name,
            scopeId,
            classifications
        };

        const occurrence = createOccurrence("reference", occurrenceMetadata, node, declaration);
        this.recordScopeOccurrence(scope, name, occurrence);
    }

    public exportOccurrences(
        includeReferences: boolean | { includeReferences?: boolean } = true
    ): ScopeOccurrencesSummary[] {
        const includeRefs =
            typeof includeReferences === "boolean" ? includeReferences : Boolean(includeReferences?.includeReferences);
        const results: ScopeOccurrencesSummary[] = [];

        for (const scope of this.scopesById.values()) {
            const summary = this.buildScopeOccurrencesSummary(scope, includeRefs);
            if (summary) {
                results.push(summary);
            }
        }

        return results;
    }

    /**
     * Builds a scope occurrences summary for a single scope.
     * Returns null if the scope has no identifiers with occurrences.
     */
    private buildScopeOccurrencesSummary(scope: Scope, includeReferences: boolean): ScopeOccurrencesSummary | null {
        const identifiers: ScopeOccurrencesSummary["identifiers"] = [];

        for (const [name, entry] of scope.occurrences) {
            // Pre-allocate arrays with exact size to avoid reallocation during iteration
            const declCount = entry.declarations.length;
            const refCount = entry.references.length;

            if (declCount === 0 && refCount === 0) {
                continue;
            }

            const declarations: Occurrence[] = Array.from({ length: declCount });
            for (let i = 0; i < declCount; i++) {
                declarations[i] = cloneOccurrence(entry.declarations[i]);
            }

            const references: Occurrence[] = includeReferences ? Array.from({ length: refCount }) : [];
            if (includeReferences) {
                for (let i = 0; i < refCount; i++) {
                    references[i] = cloneOccurrence(entry.references[i]);
                }
            }

            identifiers.push({
                name,
                declarations,
                references
            });
        }

        if (identifiers.length === 0) {
            return null;
        }

        return {
            scopeId: scope.id,
            scopeKind: scope.kind,
            lastModified: scope.lastModifiedTimestamp,
            modificationCount: scope.modificationCount,
            identifiers
        };
    }

    /**
     * Exports occurrences only for scopes modified after the given timestamp.
     * This is optimized for hot reload scenarios where only a subset of files
     * have changed, avoiding expensive cloning of unchanged scopes.
     *
     * @param sinceTimestamp - Only export scopes modified after this timestamp
     * @param includeReferences - Whether to include reference occurrences
     * @returns Array of scope occurrence summaries for modified scopes only
     */
    public exportModifiedOccurrences(
        sinceTimestamp: number,
        includeReferences: boolean | { includeReferences?: boolean } = true
    ): ScopeOccurrencesSummary[] {
        const includeRefs =
            typeof includeReferences === "boolean" ? includeReferences : Boolean(includeReferences?.includeReferences);
        const results: ScopeOccurrencesSummary[] = [];

        for (const scope of this.scopesById.values()) {
            if (scope.lastModifiedTimestamp <= sinceTimestamp) {
                continue;
            }

            const summary = this.buildScopeOccurrencesSummary(scope, includeRefs);
            if (summary) {
                results.push(summary);
            }
        }

        return results;
    }

    public getScopeOccurrences(
        scopeId: string | null | undefined,
        { includeReferences = true } = {}
    ): ScopeOccurrencesSummary | null {
        if (!scopeId) {
            return null;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return null;
        }

        const includeRefs = Boolean(includeReferences);
        const identifiers: ScopeOccurrencesSummary["identifiers"] = [];

        for (const [name, entry] of scope.occurrences) {
            const declarations = entry.declarations.map((occurrence) => cloneOccurrence(occurrence));
            const references = includeRefs ? entry.references.map((occurrence) => cloneOccurrence(occurrence)) : [];

            if (declarations.length === 0 && references.length === 0) {
                continue;
            }

            identifiers.push({
                name,
                declarations,
                references
            });
        }

        return {
            scopeId: scope.id,
            scopeKind: scope.kind,
            lastModified: scope.lastModifiedTimestamp,
            modificationCount: scope.modificationCount,
            identifiers
        };
    }

    public getSymbolOccurrences(name: string | null | undefined): SymbolOccurrence[] {
        return this.collectSymbolOccurrencesForName(name, {
            cloneOccurrences: true,
            includeDeclarations: true,
            includeReferences: true,
            referenceFilter: () => true
        });
    }

    public getBatchSymbolOccurrences(names: Iterable<string>): Map<string, SymbolOccurrence[]> {
        const results = new Map<string, SymbolOccurrence[]>();
        const uniqueNames = this.collectUniqueSymbolNames(names);

        // Optimize by processing all symbols in one pass rather than calling getSymbolOccurrences repeatedly
        for (const name of uniqueNames) {
            const nameResults = this.collectSymbolOccurrencesForName(name, {
                cloneOccurrences: true,
                includeDeclarations: true,
                includeReferences: true,
                referenceFilter: () => true
            });
            if (nameResults.length > 0) {
                results.set(name, nameResults);
            }
        }

        return results;
    }

    /**
     * Returns symbol occurrences without cloning occurrence objects.
     *
     * **UNSAFE**: The returned occurrence objects are direct references to internal state.
     * Callers MUST NOT modify them. Use this method only for read-only analysis where
     * performance is critical (e.g., hot-reload dependency tracking, large-scale queries).
     *
     * For safe access with defensive copying, use `getSymbolOccurrences()`.
     *
     * @param name - Symbol name to query
     * @returns Array of symbol occurrences with internal references (DO NOT MODIFY)
     */
    public getSymbolOccurrencesUnsafe(name: string | null | undefined): SymbolOccurrence[] {
        return this.collectSymbolOccurrencesForName(name, {
            cloneOccurrences: false,
            includeDeclarations: true,
            includeReferences: true,
            referenceFilter: () => true
        });
    }

    /**
     * Returns batch symbol occurrences without cloning occurrence objects.
     *
     * **UNSAFE**: The returned occurrence objects are direct references to internal state.
     * Callers MUST NOT modify them. Use this method only for read-only analysis where
     * performance is critical (e.g., hot-reload dependency tracking, bulk invalidation).
     *
     * For safe access with defensive copying, use `getBatchSymbolOccurrences()`.
     *
     * @param names - Iterable of symbol names to query
     * @returns Map of symbol names to occurrence arrays with internal references (DO NOT MODIFY)
     */
    public getBatchSymbolOccurrencesUnsafe(names: Iterable<string>): Map<string, SymbolOccurrence[]> {
        const results = new Map<string, SymbolOccurrence[]>();
        const uniqueNames = this.collectUniqueSymbolNames(names);

        for (const name of uniqueNames) {
            const nameResults = this.collectSymbolOccurrencesForName(name, {
                cloneOccurrences: false,
                includeDeclarations: true,
                includeReferences: true,
                referenceFilter: () => true
            });
            if (nameResults.length > 0) {
                results.set(name, nameResults);
            }
        }

        return results;
    }

    public getScopesForSymbol(name: string | null | undefined): string[] {
        if (!name) {
            return [];
        }

        const scopeSummaryMap = this.symbolToScopesIndex.get(name);
        if (!scopeSummaryMap) {
            return [];
        }

        return [...scopeSummaryMap.keys()];
    }

    public getSymbolScopeSummary(name: string | null | undefined): SymbolScopeSummary[] {
        if (!name) {
            return [];
        }

        const scopeSummaryMap = this.symbolToScopesIndex.get(name);
        if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
            return [];
        }

        const summaries: SymbolScopeSummary[] = [];

        for (const [scopeId, summary] of scopeSummaryMap) {
            const scope = this.scopesById.get(scopeId);
            if (!scope) {
                continue;
            }

            summaries.push({
                scopeId,
                scopeKind: scope.kind,
                hasDeclaration: Boolean(summary.hasDeclaration),
                hasReference: Boolean(summary.hasReference)
            });
        }

        return summaries;
    }

    public getAllSymbolsSummary(): AllSymbolsSummaryItem[] {
        if (!this.enabled) {
            return [];
        }

        const summaries: AllSymbolsSummaryItem[] = [];

        for (const [name, scopeSummaryMap] of this.symbolToScopesIndex) {
            let totalDeclarations = 0;
            let totalReferences = 0;
            const scopeDetails: SymbolScopeSummary[] = [];

            for (const [scopeId, summary] of scopeSummaryMap) {
                const scope = this.scopesById.get(scopeId);
                if (!scope) {
                    continue;
                }

                const entry = scope.occurrences.get(name);
                if (entry) {
                    totalDeclarations += entry.declarations.length;
                    totalReferences += entry.references.length;
                }

                scopeDetails.push({
                    scopeId,
                    scopeKind: scope.kind,
                    hasDeclaration: Boolean(summary.hasDeclaration),
                    hasReference: Boolean(summary.hasReference)
                });
            }

            summaries.push({
                name,
                scopeCount: scopeSummaryMap.size,
                declarationCount: totalDeclarations,
                referenceCount: totalReferences,
                scopes: scopeDetails
            });
        }

        return summaries;
    }

    public getScopeSymbols(scopeId: string | null | undefined): string[] {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        return [...scope.occurrences.keys()];
    }

    /**
     * Resolves the declaring scope ID for a symbol starting from the given scope,
     * walking the scope chain upwards.
     *
     * This is a lean alternative to {@link resolveIdentifier} for callers that
     * only need to know *which* scope declares a symbol — not the full declaration
     * metadata. It avoids the `cloneDeclarationMetadata` allocation overhead while
     * still populating the identifier cache for subsequent lookups.
     *
     * This method is used in the hot-reload invalidation critical path
     * (`collectScopeDependents`, `recordCrossPathDependencyEdge`) where
     * `resolveIdentifier` would otherwise clone metadata on every call.
     *
     * @param name       - Symbol name to resolve.
     * @param refScopeId - Starting scope ID for the chain walk.
     * @returns The `scopeId` of the declaring scope, or `null` if not found.
     */
    private resolveDeclaringScopeId(name: string, refScopeId: string): string | null {
        const startScope = this.scopesById.get(refScopeId);
        if (!startScope) {
            return null;
        }

        // Check the identifier cache first — avoids a scope chain walk entirely.
        const cached = this.identifierCache.read(name, refScopeId);
        if (cached !== undefined) {
            return cached?.scopeId ?? null;
        }

        const storedIndex = startScope.stackIndex;
        const startIndex: number | undefined =
            typeof storedIndex === "number" &&
            storedIndex >= 0 &&
            storedIndex < this.scopeStack.length &&
            this.scopeStack[storedIndex] === startScope
                ? storedIndex
                : undefined;

        if (startIndex === undefined) {
            let current: Scope | null = startScope;
            while (current) {
                const declaration = current.symbolMetadata.get(name);
                if (declaration) {
                    this.identifierCache.write(name, refScopeId, declaration);
                    return declaration.scopeId;
                }
                current = current.parent;
            }
            this.identifierCache.write(name, refScopeId, null);
            return null;
        }

        for (let i = startIndex; i >= 0; i -= 1) {
            const scope = this.scopeStack[i];
            const declaration = scope.symbolMetadata.get(name);
            if (declaration) {
                this.identifierCache.write(name, refScopeId, declaration);
                return declaration.scopeId;
            }
        }

        this.identifierCache.write(name, refScopeId, null);
        return null;
    }

    public resolveIdentifier(name: string | null | undefined, scopeId?: string | null): ScopeSymbolMetadata | null {
        if (!name) {
            return null;
        }

        let startScope: Scope | null | undefined;
        if (scopeId) {
            startScope = this.scopesById.get(scopeId);
            if (!startScope) {
                return null;
            }
        } else {
            startScope = this.currentScope();
        }

        if (!startScope) {
            return null;
        }

        const cacheScopeId = startScope.id;
        const cachedDeclaration = this.identifierCache.read(name, cacheScopeId);

        if (cachedDeclaration !== undefined) {
            return cachedDeclaration ? cloneDeclarationMetadata(cachedDeclaration) : null;
        }

        const storedIndex = startScope.stackIndex;
        const startIndex: number | undefined =
            typeof storedIndex === "number" &&
            storedIndex >= 0 &&
            storedIndex < this.scopeStack.length &&
            this.scopeStack[storedIndex] === startScope
                ? storedIndex
                : undefined;

        if (startIndex === undefined) {
            let current: Scope | null = startScope;
            while (current) {
                const declaration = current.symbolMetadata.get(name);
                if (declaration) {
                    this.identifierCache.write(name, cacheScopeId, declaration);
                    return cloneDeclarationMetadata(declaration);
                }
                current = current.parent;
            }
            this.identifierCache.write(name, cacheScopeId, null);
            return null;
        }

        for (let i = startIndex; i >= 0; i -= 1) {
            const scope = this.scopeStack[i];
            const declaration = scope.symbolMetadata.get(name);
            if (declaration) {
                this.identifierCache.write(name, cacheScopeId, declaration);
                return cloneDeclarationMetadata(declaration);
            }
        }

        this.identifierCache.write(name, cacheScopeId, null);
        return null;
    }

    public getScopeChain(scopeId: string | null | undefined): Array<{ id: string; kind: string }> {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        const chain = [];
        let current: Scope | null = scope;
        while (current) {
            chain.push({
                id: current.id,
                kind: current.kind
            });
            current = current.parent;
        }

        return chain;
    }

    public getScopeDefinitions(scopeId: string | null | undefined): SymbolDefinition[] {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        const definitions: SymbolDefinition[] = [];
        for (const [name, metadata] of scope.symbolMetadata) {
            definitions.push({
                name,
                metadata: { ...metadata }
            });
        }

        return definitions;
    }

    public getScopeExternalReferences(scopeId: string | null | undefined): ExternalReference[] {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        const externalRefs: ExternalReference[] = [];

        for (const [name, entry] of scope.occurrences) {
            // Check references first before any other work (early exit optimization)
            if (entry.references.length === 0) {
                continue;
            }

            // Skip local declarations
            if (scope.symbolMetadata.has(name)) {
                continue;
            }

            const resolvedDeclaration = this.resolveIdentifier(name, scopeId);
            const declaringScopeId = resolvedDeclaration?.scopeId ?? null;

            if (declaringScopeId === scopeId) {
                continue;
            }

            // Pre-allocate array for occurrences
            const refCount = entry.references.length;
            const occurrences: Occurrence[] = Array.from({ length: refCount });
            for (let i = 0; i < refCount; i++) {
                occurrences[i] = cloneOccurrence(entry.references[i]);
            }

            externalRefs.push({
                name,
                declaringScopeId,
                referencingScopeId: scopeId,
                declaration: resolvedDeclaration ? cloneDeclarationMetadata(resolvedDeclaration) : null,
                occurrences
            });
        }

        return externalRefs;
    }

    public getScopeDependencies(scopeId: string | null | undefined): ScopeDependency[] {
        if (!scopeId) {
            return [];
        }

        const externalRefs = this.getScopeExternalReferences(scopeId);
        if (externalRefs.length === 0) {
            return [];
        }

        const dependenciesMap = new Map<string, Set<string>>();

        for (const ref of externalRefs) {
            if (!ref.declaringScopeId) {
                continue;
            }

            let symbols = dependenciesMap.get(ref.declaringScopeId);
            if (!symbols) {
                symbols = new Set();
                dependenciesMap.set(ref.declaringScopeId, symbols);
            }

            symbols.add(ref.name);
        }

        const dependencies: ScopeDependency[] = [];
        for (const [depScopeId, symbols] of dependenciesMap) {
            const depScope = this.scopesById.get(depScopeId);
            if (!depScope) {
                continue;
            }

            // Convert set to sorted array efficiently
            const symbolsArray = [...symbols];
            symbolsArray.sort();
            dependencies.push({
                dependencyScopeId: depScopeId,
                dependencyScopeKind: depScope.kind,
                symbols: symbolsArray
            });
        }

        // Sort in place using simple string comparison
        dependencies.sort((a, b) =>
            a.dependencyScopeId < b.dependencyScopeId ? -1 : a.dependencyScopeId > b.dependencyScopeId ? 1 : 0
        );
        return dependencies;
    }

    public getScopeDependents(scopeId: string | null | undefined): ScopeDependent[] {
        return this.collectScopeDependents(scopeId, true);
    }

    private collectScopeDependents(scopeId: string | null | undefined, sortResults: boolean): ScopeDependent[] {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        const declaredSymbols = new Set(scope.symbolMetadata.keys());
        if (declaredSymbols.size === 0) {
            return [];
        }

        const dependentsMap = new Map<string, Set<string>>();

        for (const symbol of declaredSymbols) {
            const scopeSummaryMap = this.symbolToScopesIndex.get(symbol);
            if (!scopeSummaryMap) {
                continue;
            }

            for (const [refScopeId, summary] of scopeSummaryMap) {
                if (refScopeId === scopeId) {
                    continue;
                }

                if (!summary.hasReference) {
                    continue;
                }

                const refScope = this.scopesById.get(refScopeId);
                if (!refScope) {
                    continue;
                }

                const localDeclaration = refScope.symbolMetadata.get(symbol);
                if (localDeclaration) {
                    continue;
                }

                const declaringScopeId = this.resolveDeclaringScopeId(symbol, refScopeId);
                if (declaringScopeId !== scopeId) {
                    continue;
                }

                let symbols = dependentsMap.get(refScopeId);
                if (!symbols) {
                    symbols = new Set();
                    dependentsMap.set(refScopeId, symbols);
                }

                symbols.add(symbol);
            }
        }

        const dependents: ScopeDependent[] = [];
        for (const [depScopeId, symbols] of dependentsMap) {
            const depScope = this.scopesById.get(depScopeId);
            if (!depScope) {
                continue;
            }

            // Convert set to sorted array efficiently
            const symbolsArray = [...symbols];
            symbolsArray.sort();
            dependents.push({
                dependentScopeId: depScopeId,
                dependentScopeKind: depScope.kind,
                symbols: symbolsArray
            });
        }

        if (sortResults) {
            // Sort in place using simple string comparison
            dependents.sort((a, b) =>
                a.dependentScopeId < b.dependentScopeId ? -1 : a.dependentScopeId > b.dependentScopeId ? 1 : 0
            );
        }

        return dependents;
    }

    public getTransitiveDependents(
        scopeId: string | null | undefined,
        visited: Set<string> = new Set()
    ): Array<{ dependentScopeId: string; dependentScopeKind: string; depth: number }> {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        if (visited.has(scopeId)) {
            return [];
        }

        visited.add(scopeId);

        const depthMap = new Map<string, { kind: string; depth: number }>();
        const queue: Array<{ scopeId: string; depth: number }> = [];

        const directDependents = this.collectScopeDependents(scopeId, false);
        for (const dep of directDependents) {
            queue.push({
                scopeId: dep.dependentScopeId,
                depth: 1
            });
        }

        for (let index = 0; index < queue.length; index += 1) {
            const current = queue[index];
            if (visited.has(current.scopeId)) {
                continue;
            }

            visited.add(current.scopeId);

            const currentScope = this.scopesById.get(current.scopeId);
            if (!currentScope) {
                continue;
            }

            const existing = depthMap.get(current.scopeId);
            if (!existing || current.depth < existing.depth) {
                depthMap.set(current.scopeId, {
                    kind: currentScope.kind,
                    depth: current.depth
                });
            }

            const nextDependents = this.collectScopeDependents(current.scopeId, false);
            for (const dep of nextDependents) {
                if (visited.has(dep.dependentScopeId)) {
                    continue;
                }

                queue.push({
                    scopeId: dep.dependentScopeId,
                    depth: current.depth + 1
                });
            }
        }

        const result = [];
        for (const [id, { kind, depth }] of depthMap) {
            result.push({
                dependentScopeId: id,
                dependentScopeKind: kind,
                depth
            });
        }

        // Sort in place using simple string comparison
        result.sort((a, b) => {
            if (a.depth !== b.depth) {
                return a.depth - b.depth;
            }
            return a.dependentScopeId < b.dependentScopeId ? -1 : a.dependentScopeId > b.dependentScopeId ? 1 : 0;
        });
        return result;
    }

    public getInvalidationSet(
        scopeId: string | null | undefined,
        { includeDescendants = false }: { includeDescendants?: boolean } = {}
    ): Array<{ scopeId: string; scopeKind: string; reason: string }> {
        if (!scopeId) {
            return [];
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return [];
        }

        const invalidationSet: Array<{
            scopeId: string;
            scopeKind: string;
            reason: string;
        }> = [];
        const seenScopes = new Set<string>();

        const addScope = (scopeIdToAdd: string, scopeKind: string, reason: string): void => {
            if (seenScopes.has(scopeIdToAdd)) {
                return;
            }
            seenScopes.add(scopeIdToAdd);
            invalidationSet.push({
                scopeId: scopeIdToAdd,
                scopeKind,
                reason
            });
        };

        addScope(scope.id, scope.kind, "self");

        const dependents = this.getTransitiveDependents(scopeId);
        for (const dep of dependents) {
            addScope(dep.dependentScopeId, dep.dependentScopeKind, "dependent");
        }

        if (includeDescendants) {
            const descendants = this.getDescendantScopes(scopeId);
            for (const desc of descendants) {
                addScope(desc.scopeId, desc.scopeKind, "descendant");
            }
        }

        return invalidationSet;
    }

    /**
     * Computes invalidation sets for multiple file paths in a single pass.
     *
     * This method is optimized for hot-reload scenarios where multiple files
     * change simultaneously (e.g., format-on-save, refactoring operations).
     * It processes all paths in a single traversal, deduplicating scopes
     * and their dependents to minimize redundant work.
     *
     * @param paths - Iterable of file paths to compute invalidation sets for
     * @param options - Configuration options
     * @param options.includeDescendants - Whether to include descendant scopes
     * @returns Map of file paths to their invalidation sets
     */
    public getBatchInvalidationSets(
        paths: Iterable<string>,
        { includeDescendants = false }: { includeDescendants?: boolean } = {}
    ): Map<string, Array<{ scopeId: string; scopeKind: string; reason: string }>> {
        const results = new Map<string, Array<{ scopeId: string; scopeKind: string; reason: string }>>();
        const normalizedPathResultsCache = new Map<
            string,
            Array<{ scopeId: string; scopeKind: string; reason: string }>
        >();
        const transitiveDependentsCache = new Map<
            string,
            Array<{ dependentScopeId: string; dependentScopeKind: string; depth: number }>
        >();
        const descendantScopesCache = new Map<string, Array<{ scopeId: string; scopeKind: string; depth: number }>>();

        for (const path of paths) {
            if (!path || typeof path !== "string" || path.length === 0) {
                continue;
            }

            if (results.has(path)) {
                continue;
            }

            const trackedPath = this.normalizeTrackedPath(path);
            const cachedInvalidationSet = normalizedPathResultsCache.get(trackedPath);
            if (cachedInvalidationSet) {
                results.set(path, cachedInvalidationSet);
                continue;
            }

            const scopeIds = this.pathToScopesIndex.get(trackedPath);
            if (!scopeIds || scopeIds.size === 0) {
                normalizedPathResultsCache.set(trackedPath, []);
                results.set(path, []);
                continue;
            }

            const pathInvalidationSet: Array<{
                scopeId: string;
                scopeKind: string;
                reason: string;
            }> = [];
            const seenScopes = new Set<string>();

            for (const scopeId of scopeIds) {
                const scope = this.scopesById.get(scopeId);
                if (!scope) {
                    continue;
                }

                if (!seenScopes.has(scope.id)) {
                    seenScopes.add(scope.id);
                    pathInvalidationSet.push({
                        scopeId: scope.id,
                        scopeKind: scope.kind,
                        reason: "self"
                    });
                }

                let dependents = transitiveDependentsCache.get(scopeId);
                if (!dependents) {
                    dependents = this.getTransitiveDependents(scopeId);
                    transitiveDependentsCache.set(scopeId, dependents);
                }

                for (const dep of dependents) {
                    if (seenScopes.has(dep.dependentScopeId)) {
                        continue;
                    }
                    seenScopes.add(dep.dependentScopeId);
                    pathInvalidationSet.push({
                        scopeId: dep.dependentScopeId,
                        scopeKind: dep.dependentScopeKind,
                        reason: "dependent"
                    });
                }

                if (includeDescendants) {
                    let descendants = descendantScopesCache.get(scopeId);
                    if (!descendants) {
                        descendants = this.getDescendantScopes(scopeId);
                        descendantScopesCache.set(scopeId, descendants);
                    }

                    for (const desc of descendants) {
                        if (seenScopes.has(desc.scopeId)) {
                            continue;
                        }
                        seenScopes.add(desc.scopeId);
                        pathInvalidationSet.push({
                            scopeId: desc.scopeId,
                            scopeKind: desc.scopeKind,
                            reason: "descendant"
                        });
                    }
                }
            }

            normalizedPathResultsCache.set(trackedPath, pathInvalidationSet);
            results.set(path, pathInvalidationSet);
        }

        return results;
    }

    public getDescendantScopes(
        scopeId: string | null | undefined
    ): Array<{ scopeId: string; scopeKind: string; depth: number }> {
        if (!scopeId) {
            return [];
        }

        const descendants: Array<{
            scopeId: string;
            scopeKind: string;
            depth: number;
        }> = [];
        const children = this.scopeChildrenIndex.get(scopeId);
        if (!children || children.size === 0) {
            return descendants;
        }

        const queue: Array<{ scopeId: string; depth: number }> = [];
        for (const childId of children) {
            queue.push({ scopeId: childId, depth: 1 });
        }

        for (let i = 0; i < queue.length; i += 1) {
            const current = queue[i];
            const scope = this.scopesById.get(current.scopeId);
            if (!scope) {
                continue;
            }

            descendants.push({
                scopeId: scope.id,
                scopeKind: scope.kind,
                depth: current.depth
            });

            const grandChildren = this.scopeChildrenIndex.get(scope.id);
            if (grandChildren && grandChildren.size > 0) {
                for (const grandChildId of grandChildren) {
                    queue.push({ scopeId: grandChildId, depth: current.depth + 1 });
                }
            }
        }

        // Sort in place since descendants is already a new array
        descendants.sort((a, b) => {
            if (a.depth !== b.depth) {
                return a.depth - b.depth;
            }
            // Use simple string comparison for scope IDs (deterministic identifiers)
            return a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0;
        });
        return descendants;
    }

    public getScopeMetadata(scopeId: string | null | undefined): ScopeDetails | null {
        if (!scopeId) {
            return null;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return null;
        }

        return {
            scopeId: scope.id,
            scopeKind: scope.kind,
            name: scope.metadata.name,
            path: scope.metadata.path,
            start: scope.metadata.start ? Core.cloneLocation(scope.metadata.start) : undefined,
            end: scope.metadata.end ? Core.cloneLocation(scope.metadata.end) : undefined
        };
    }

    public getScopesByPath(path: string | null | undefined): ScopeDetails[] {
        if (!path || typeof path !== "string" || path.length === 0) {
            return [];
        }

        const trackedPath = this.normalizeTrackedPath(path);
        const scopeIds = this.pathToScopesIndex.get(trackedPath);
        if (!scopeIds || scopeIds.size === 0) {
            return [];
        }

        const scopes: ScopeDetails[] = [];
        for (const scopeId of scopeIds) {
            const scope = this.scopesById.get(scopeId);
            if (scope) {
                scopes.push({
                    scopeId: scope.id,
                    scopeKind: scope.kind,
                    name: scope.metadata.name,
                    path: scope.metadata.path,
                    start: scope.metadata.start ? Core.cloneLocation(scope.metadata.start) : undefined,
                    end: scope.metadata.end ? Core.cloneLocation(scope.metadata.end) : undefined
                });
            }
        }

        // Sort in place since scopes is already a new array
        // Use simple string comparison for scope IDs (deterministic identifiers)
        scopes.sort((a, b) => (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0));
        return scopes;
    }

    /**
     * Returns the set of file paths where the named symbol has at least one
     * reference occurrence.
     *
     * This enables hot-reload dependency tracking: when a symbol's declaration
     * changes (e.g., a script signature is modified), callers can determine
     * which source files reference that symbol and schedule them for
     * re-analysis without scanning the entire project.
     *
     * Only scopes with a `path` in their metadata are included. Scopes
     * without a path (e.g., anonymous blocks) are skipped.
     *
     * @param name - Symbol name to query
     * @returns Set of file paths containing at least one reference to the symbol
     */
    public getFilePathsReferencingSymbol(name: string | null | undefined): Set<string> {
        if (!name || !this.enabled) {
            return new Set();
        }

        const scopeSummaryMap = this.symbolToScopesIndex.get(name);
        if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
            return new Set();
        }

        return this.collectFilePathsForSymbolSummaries(scopeSummaryMap, "reference");
    }

    /**
     * Returns referencing file paths for a batch of symbols.
     *
     * This method is optimized for hot-reload invalidation workflows where
     * multiple symbols may be affected by a single edit operation. It avoids
     * repeated name normalization and duplicate symbol processing.
     *
     * Symbols with no references are omitted from the result map.
     *
     * @param names - Symbol names to query
     * @returns Map of symbol name to referenced file paths
     */
    public getBatchFilePathsReferencingSymbols(names: Iterable<string>): Map<string, Set<string>> {
        const results = new Map<string, Set<string>>();
        if (!this.enabled) {
            return results;
        }

        const uniqueNames = this.collectUniqueSymbolNames(names);
        for (const name of uniqueNames) {
            const scopeSummaryMap = this.symbolToScopesIndex.get(name);
            if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
                continue;
            }

            const paths = this.collectFilePathsForSymbolSummaries(scopeSummaryMap, "reference");
            if (paths.size > 0) {
                results.set(name, paths);
            }
        }

        return results;
    }

    /**
     * Returns the set of file paths where the named symbol has at least one
     * declaration occurrence.
     *
     * This is the counterpart to {@link getFilePathsReferencingSymbol}:
     * together they provide the full picture of which files declare a symbol
     * and which files consume it. Hot-reload pipelines use the declaration
     * paths to determine the root files that must be re-analysed to refresh
     * a symbol's definition before propagating updates to all referencing files.
     *
     * Only scopes with a `path` in their metadata are included. Scopes
     * without a path (e.g., anonymous or synthetic scopes) are silently skipped.
     *
     * @param name - Symbol name to query
     * @returns Set of file paths containing at least one declaration of the symbol
     */
    public getFilePathsDeclaringSymbol(name: string | null | undefined): Set<string> {
        if (!name || !this.enabled) {
            return new Set();
        }

        const scopeSummaryMap = this.symbolToScopesIndex.get(name);
        if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
            return new Set();
        }

        return this.collectFilePathsForSymbolSummaries(scopeSummaryMap, "declaration");
    }

    /**
     * Returns declaration file paths for a batch of symbols.
     *
     * This method supports hot-reload pipelines that need to resolve several
     * changed definitions in one pass before computing downstream invalidation.
     *
     * Symbols with no declarations are omitted from the result map.
     *
     * @param names - Symbol names to query
     * @returns Map of symbol name to declaration file paths
     */
    public getBatchFilePathsDeclaringSymbols(names: Iterable<string>): Map<string, Set<string>> {
        const results = new Map<string, Set<string>>();
        if (!this.enabled) {
            return results;
        }

        const uniqueNames = this.collectUniqueSymbolNames(names);
        for (const name of uniqueNames) {
            const scopeSummaryMap = this.symbolToScopesIndex.get(name);
            if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
                continue;
            }

            const paths = this.collectFilePathsForSymbolSummaries(scopeSummaryMap, "declaration");
            if (paths.size > 0) {
                results.set(name, paths);
            }
        }

        return results;
    }

    public getScopeModificationMetadata(scopeId: string | null | undefined): ScopeModificationMetadata | null {
        if (!scopeId) {
            return null;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return null;
        }

        return {
            scopeId: scope.id,
            scopeKind: scope.kind,
            lastModified: scope.lastModifiedTimestamp,
            modificationCount: scope.modificationCount
        };
    }

    public updateScopeMetadata(scopeId: string | null | undefined, metadata: ScopeMetadata): ScopeDetails | null {
        if (!scopeId) {
            return null;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return null;
        }

        let metadataChanged = false;
        const previousTrackedPath = scope.metadata.path ? this.normalizeTrackedPath(scope.metadata.path) : null;

        if (Object.hasOwn(metadata, "name")) {
            if (scope.metadata.name !== metadata.name) {
                metadataChanged = true;
            }
            scope.metadata.name = metadata.name;
        }

        if (Object.hasOwn(metadata, "path")) {
            const previousPath = scope.metadata.path;
            const trackedPreviousPath = previousPath ? this.normalizeTrackedPath(previousPath) : undefined;
            const nextPath = typeof metadata.path === "string" && metadata.path.length > 0 ? metadata.path : undefined;
            const trackedNextPath = nextPath ? this.normalizeTrackedPath(nextPath) : undefined;

            if (previousPath && previousPath !== nextPath) {
                const scopeSet = this.pathToScopesIndex.get(trackedPreviousPath ?? previousPath);
                if (scopeSet) {
                    scopeSet.delete(scope.id);
                    if (scopeSet.size === 0) {
                        this.pathToScopesIndex.delete(trackedPreviousPath ?? previousPath);
                    }
                }
            }

            if (nextPath && nextPath !== previousPath) {
                let scopeSet = this.pathToScopesIndex.get(trackedNextPath ?? nextPath);
                if (!scopeSet) {
                    scopeSet = new Set<string>();
                    this.pathToScopesIndex.set(trackedNextPath ?? nextPath, scopeSet);
                }
                scopeSet.add(scope.id);
            }

            if (previousPath !== nextPath) {
                metadataChanged = true;
            }

            scope.metadata.path = nextPath;
        }

        if (Object.hasOwn(metadata, "start")) {
            const currentStart = scope.metadata.start;
            const nextStart = metadata.start;
            if (
                (!currentStart && nextStart) ||
                (currentStart && !nextStart) ||
                (currentStart &&
                    nextStart &&
                    (currentStart.line !== nextStart.line ||
                        currentStart.column !== nextStart.column ||
                        currentStart.index !== nextStart.index))
            ) {
                metadataChanged = true;
            }
            scope.metadata.start = metadata.start ? Core.cloneLocation(metadata.start) : undefined;
        }

        if (Object.hasOwn(metadata, "end")) {
            const currentEnd = scope.metadata.end;
            const nextEnd = metadata.end;
            if (
                (!currentEnd && nextEnd) ||
                (currentEnd && !nextEnd) ||
                (currentEnd &&
                    nextEnd &&
                    (currentEnd.line !== nextEnd.line ||
                        currentEnd.column !== nextEnd.column ||
                        currentEnd.index !== nextEnd.index))
            ) {
                metadataChanged = true;
            }
            scope.metadata.end = metadata.end ? Core.cloneLocation(metadata.end) : undefined;
        }

        if (metadataChanged) {
            scope.markModified();
            const nextTrackedPath = scope.metadata.path ? this.normalizeTrackedPath(scope.metadata.path) : null;

            if (previousTrackedPath && previousTrackedPath !== nextTrackedPath) {
                this.recomputePathLastModified(previousTrackedPath);
            }

            if (nextTrackedPath) {
                this.updatePathLastModifiedForScope(scope);
            }
        }

        return this.getScopeMetadata(scopeId);
    }

    public getModifiedScopes(sinceTimestamp: number = 0): ScopeModificationMetadata[] {
        const modifiedScopes: ScopeModificationMetadata[] = [];

        for (const scope of this.scopesById.values()) {
            if (scope.lastModifiedTimestamp > sinceTimestamp) {
                modifiedScopes.push({
                    scopeId: scope.id,
                    scopeKind: scope.kind,
                    lastModified: scope.lastModifiedTimestamp,
                    modificationCount: scope.modificationCount
                });
            }
        }

        return modifiedScopes;
    }

    /**
     * Returns the set of file paths associated with scopes modified after
     * the given timestamp.
     *
     * This is the primary entry point for hot-reload change detection: after
     * parsing or analysis, call this with the timestamp from before the
     * operation to find which files were touched during the analysis pass.
     *
     * Only scopes with a `path` in their metadata contribute a file path.
     * Scopes without a path (e.g., anonymous blocks or synthetic scopes)
     * are silently skipped.
     *
     * @param sinceTimestamp - Return paths for scopes with a lastModified
     *                         timestamp strictly greater than this value.
     *                         Pass 0 to return all paths for any modified scope.
     * @returns Set of file paths for scopes modified after the timestamp
     */
    public getChangedFilePaths(sinceTimestamp: number): Set<string> {
        if (!this.enabled) {
            return new Set();
        }

        const paths = new Set<string>();
        for (const [trackedPath, lastModified] of this.pathLastModifiedIndex) {
            if (lastModified > sinceTimestamp) {
                paths.add(trackedPath);
            }
        }

        return paths;
    }

    public getMostRecentlyModifiedScope(): ScopeModificationMetadata | null {
        let mostRecent: Scope | null = null;
        let latestTimestamp = -1;

        for (const scope of this.scopesById.values()) {
            if (scope.lastModifiedTimestamp > latestTimestamp) {
                latestTimestamp = scope.lastModifiedTimestamp;
                mostRecent = scope;
            }
        }

        if (!mostRecent) {
            return null;
        }

        return {
            scopeId: mostRecent.id,
            scopeKind: mostRecent.kind,
            lastModified: mostRecent.lastModifiedTimestamp,
            modificationCount: mostRecent.modificationCount
        };
    }

    public getScopeModificationDetails(scopeId: string | null | undefined): ScopeModificationDetails | null {
        if (!scopeId) {
            return null;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return null;
        }

        let totalDeclarations = 0;
        let totalReferences = 0;
        const symbols = [];

        for (const [name, entry] of scope.occurrences) {
            const declarationCount = entry.declarations.length;
            const referenceCount = entry.references.length;

            totalDeclarations += declarationCount;
            totalReferences += referenceCount;

            symbols.push({
                name,
                declarationCount,
                referenceCount
            });
        }

        // Sort symbols in place
        symbols.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

        return {
            scopeId: scope.id,
            scopeKind: scope.kind,
            lastModified: scope.lastModifiedTimestamp,
            modificationCount: scope.modificationCount,
            declarationCount: totalDeclarations,
            referenceCount: totalReferences,
            symbolCount: symbols.length,
            symbols
        };
    }

    public getSymbolWrites(name: string | null | undefined): SymbolOccurrence[] {
        return this.collectSymbolReadWriteOccurrences(name, {
            cloneOccurrences: true,
            accessKind: "write"
        });
    }

    public getSymbolReads(name: string | null | undefined): SymbolOccurrence[] {
        return this.collectSymbolReadWriteOccurrences(name, {
            cloneOccurrences: true,
            accessKind: "read"
        });
    }

    /**
     * Returns symbol writes without cloning occurrence objects.
     *
     * **UNSAFE**: The returned occurrence objects are direct references to internal state.
     * Callers MUST NOT modify them. Use this method only for read-only analysis where
     * performance is critical (e.g., hot-reload write tracking, dependency analysis).
     *
     * For safe access with defensive copying, use `getSymbolWrites()`.
     *
     * @param name - Symbol name to query
     * @returns Array of write occurrences with internal references (DO NOT MODIFY)
     */
    public getSymbolWritesUnsafe(name: string | null | undefined): SymbolOccurrence[] {
        return this.collectSymbolReadWriteOccurrences(name, {
            cloneOccurrences: false,
            accessKind: "write"
        });
    }

    /**
     * Returns symbol reads without cloning occurrence objects.
     *
     * **UNSAFE**: The returned occurrence objects are direct references to internal state.
     * Callers MUST NOT modify them. Use this method only for read-only analysis where
     * performance is critical (e.g., hot-reload read tracking, dependency analysis).
     *
     * For safe access with defensive copying, use `getSymbolReads()`.
     *
     * @param name - Symbol name to query
     * @returns Array of read occurrences with internal references (DO NOT MODIFY)
     */
    public getSymbolReadsUnsafe(name: string | null | undefined): SymbolOccurrence[] {
        return this.collectSymbolReadWriteOccurrences(name, {
            cloneOccurrences: false,
            accessKind: "read"
        });
    }

    public withRole<T>(role: ScopeRole | null, callback: () => T): T {
        return this.identifierRoleTracker.withRole(role, callback);
    }

    public cloneRole(role: ScopeRole | null): ScopeRole {
        return this.identifierRoleTracker.cloneRole(role);
    }

    public getCurrentRole(): ScopeRole | null {
        return this.identifierRoleTracker.getCurrentRole();
    }

    public applyCurrentRoleToIdentifier(
        name: string | null | undefined,
        node: MutableGameMakerAstNode | null | undefined
    ): void {
        if (!name || !Core.isIdentifierNode(node)) {
            return;
        }

        const role = this.identifierRoleTracker.cloneRole(this.identifierRoleTracker.getCurrentRole());
        const roleType = role?.type === "declaration" ? "declaration" : "reference";

        if (roleType === "declaration") {
            this.declare(name, node, role);
        } else {
            this.reference(name, node, role);
        }
    }

    public get globalIdentifiers(): Set<string> {
        return this.globalIdentifierRegistry.getGlobalIdentifierNames();
    }

    public markGlobalIdentifier(node: MutableGameMakerAstNode | null | undefined): void {
        this.globalIdentifierRegistry.markIdentifier(node);
    }

    public applyGlobalIdentifiersToNode(node: MutableGameMakerAstNode | null | undefined): void {
        this.globalIdentifierRegistry.applyToNode(node);
    }

    public getAllDeclarations(): SymbolDeclarationInfo[] {
        const declarations: SymbolDeclarationInfo[] = [];

        for (const scope of this.scopesById.values()) {
            for (const [name, metadata] of scope.symbolMetadata) {
                declarations.push({
                    name,
                    scopeId: scope.id,
                    scopeKind: scope.kind,
                    metadata: cloneDeclarationMetadata(metadata)
                });
            }
        }

        // Sort in place using simple string comparison
        declarations.sort((a, b) => {
            if (a.scopeId !== b.scopeId) {
                return a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0;
            }
            return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        return declarations;
    }

    public getDeclarationInScope(
        name: string | null | undefined,
        scopeId: string | null | undefined
    ): ScopeSymbolMetadata | null {
        if (!name || !scopeId) {
            return null;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return null;
        }

        const metadata = scope.symbolMetadata.get(name);
        if (!metadata) {
            return null;
        }

        return cloneDeclarationMetadata(metadata);
    }

    private defaultScipSymbolGenerator(name: string, scopeId: string): string {
        return `${scopeId}::${name}`;
    }

    private toScipOccurrence(
        occurrence: Occurrence,
        symbolRoles: number,
        getSymbol: (name: string, scopeId: string) => string | null
    ): ScipOccurrence | null {
        const start = occurrence?.start;
        const end = occurrence?.end;

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

        const name = occurrence?.name;
        const occScopeId = occurrence?.scopeId;

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

    public exportScipOccurrences(
        options: {
            scopeId?: string | null;
            includeReferences?: boolean;
            symbolGenerator?: (name: string, scopeId: string) => string | null;
        } = {}
    ): ScopeScipOccurrences[] {
        const { scopeId = null, includeReferences = true, symbolGenerator = null } = options;

        const results: ScopeScipOccurrences[] = [];
        const getSymbol = symbolGenerator ?? this.defaultScipSymbolGenerator.bind(this);

        const scopesToProcess = scopeId ? this.getSingleScopeArray(scopeId) : Array.from(this.scopesById.values());

        for (const scope of scopesToProcess) {
            const occurrences: ScipOccurrence[] = [];

            for (const entry of scope.occurrences.values()) {
                this.appendScipDeclarations(entry, occurrences, getSymbol);
                if (includeReferences) {
                    this.appendScipReferences(entry, occurrences, getSymbol);
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

        // Sort in place using simple string comparison
        results.sort((a, b) => (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0));
        return results;
    }

    private appendScipDeclarations(
        entry: IdentifierOccurrences,
        occurrences: Array<ScipOccurrence>,
        getSymbol: (name: string, scopeId: string) => string | null
    ): void {
        for (const declaration of entry.declarations) {
            const scipOcc = this.toScipOccurrence(declaration, ROLE_DEF, getSymbol);
            if (scipOcc) {
                occurrences.push(scipOcc);
            }
        }
    }

    private appendScipReferences(
        entry: IdentifierOccurrences,
        occurrences: Array<ScipOccurrence>,
        getSymbol: (name: string, scopeId: string) => string | null
    ): void {
        for (const reference of entry.references) {
            const scipOcc = this.toScipOccurrence(reference, ROLE_REF, getSymbol);
            if (scipOcc) {
                occurrences.push(scipOcc);
            }
        }
    }

    public exportOccurrencesBySymbols(
        symbolNames: Iterable<string>,
        options: {
            scopeId?: string | null;
            includeReferences?: boolean;
            symbolGenerator?: (name: string, scopeId: string) => string | null;
        } = {}
    ): ScopeScipOccurrences[] {
        const { scopeId = null, includeReferences = true, symbolGenerator = null } = options;
        const symbolSet = new Set(symbolNames);

        if (symbolSet.size === 0) {
            return [];
        }

        const results: ScopeScipOccurrences[] = [];
        const getSymbol = symbolGenerator ?? this.defaultScipSymbolGenerator.bind(this);

        const scopesToProcess = scopeId ? this.getSingleScopeArray(scopeId) : this.collectScopesForSymbols(symbolSet);

        if (scopesToProcess.length === 0) {
            return [];
        }

        for (const scope of scopesToProcess) {
            const occurrences: ScipOccurrence[] = [];

            for (const [name, entry] of scope.occurrences.entries()) {
                if (!symbolSet.has(name)) {
                    continue;
                }

                this.appendScipDeclarations(entry, occurrences, getSymbol);
                if (includeReferences) {
                    this.appendScipReferences(entry, occurrences, getSymbol);
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

        // Sort in place using simple string comparison
        results.sort((a, b) => (a.scopeId < b.scopeId ? -1 : a.scopeId > b.scopeId ? 1 : 0));
        return results;
    }

    private collectScopesForSymbols(symbolSet: Set<string>): Scope[] {
        const scopeIds = new Set<string>();

        for (const symbol of symbolSet) {
            const scopeSummaryMap = this.symbolToScopesIndex.get(symbol);
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
            const scope = this.scopesById.get(scopeId);
            if (scope) {
                scopes.push(scope);
            }
        }

        return scopes;
    }

    /**
     * Batch-retrieves metadata for multiple scopes in a single operation.
     *
     * This method is optimized for hot-reload invalidation scenarios where
     * you need metadata for a set of scopes (e.g., from getInvalidationSet).
     * It reduces overhead by performing a single pass through the scope IDs
     * rather than calling getScopeMetadata repeatedly.
     *
     * @param scopeIds - Iterable of scope IDs to retrieve metadata for
     * @returns Map of scope IDs to their metadata (omits scopes that don't exist)
     */
    public getBatchScopeMetadata(scopeIds: Iterable<string>): Map<string, ScopeDetails> {
        const results = new Map<string, ScopeDetails>();

        for (const scopeId of scopeIds) {
            if (!scopeId) {
                continue;
            }

            const scope = this.scopesById.get(scopeId);
            if (!scope) {
                continue;
            }

            results.set(scopeId, {
                scopeId: scope.id,
                scopeKind: scope.kind,
                name: scope.metadata.name,
                path: scope.metadata.path,
                start: scope.metadata.start ? Core.cloneLocation(scope.metadata.start) : undefined,
                end: scope.metadata.end ? Core.cloneLocation(scope.metadata.end) : undefined
            });
        }

        return results;
    }

    /**
     * Efficiently checks if any of the given symbols have modifications in scopes
     * newer than the specified timestamp.
     *
     * This method is optimized for hot-reload invalidation scenarios where you need
     * to quickly determine if a symbol has changed without allocating occurrence arrays.
     * It performs early-exit checks and avoids unnecessary object creation.
     *
     * Use case: Before triggering a full hot-reload, check if any of the symbols
     * referenced by a module have actually changed since the last reload.
     *
     * @param symbols - Set or iterable of symbol names to check for modifications
     * @param sinceTimestamp - Only consider scopes modified after this timestamp
     * @returns Map of symbol names to arrays of scope IDs where they were modified
     */
    public getModifiedSymbolScopes(
        symbols: ReadonlySet<string> | Iterable<string>,
        sinceTimestamp: number
    ): Map<string, string[]> {
        if (!this.enabled) {
            return new Map();
        }

        // Use a capability probe rather than `instanceof Set` so that cross-realm
        // Sets, ReadonlySet wrappers, and other Set-like collaborators are accepted
        // without breaking the Liskov Substitution Principle.
        const symbolSet: ReadonlySet<string> = Core.isSetLike(symbols) ? symbols : new Set(symbols);
        if (symbolSet.size === 0) {
            return new Map();
        }

        const results = new Map<string, string[]>();

        for (const symbol of symbolSet) {
            const scopeSummaryMap = this.symbolToScopesIndex.get(symbol);
            if (!scopeSummaryMap || scopeSummaryMap.size === 0) {
                continue;
            }

            const modifiedScopes: string[] = [];

            for (const scopeId of scopeSummaryMap.keys()) {
                const scope = this.scopesById.get(scopeId);
                if (!scope) {
                    continue;
                }

                if (scope.lastModifiedTimestamp <= sinceTimestamp) {
                    continue;
                }

                const entry = scope.occurrences.get(symbol);
                if (!entry) {
                    continue;
                }

                if (entry.declarations.length > 0 || entry.references.length > 0) {
                    modifiedScopes.push(scopeId);
                }
            }

            if (modifiedScopes.length > 0) {
                modifiedScopes.sort();
                results.set(symbol, modifiedScopes);
            }
        }

        return results;
    }

    /**
     * Checks if a specific scope contains any declarations or references for the given symbol.
     *
     * This is a lightweight check that avoids allocating occurrence arrays, making it
     * suitable for fast hot-reload decision paths where you only need a yes/no answer.
     *
     * @param scopeId - Scope ID to check
     * @param symbol - Symbol name to look for
     * @returns True if the scope has any occurrences of the symbol, false otherwise
     */
    public scopeHasSymbol(scopeId: string | null | undefined, symbol: string | null | undefined): boolean {
        if (!scopeId || !symbol || !this.enabled) {
            return false;
        }

        const scope = this.scopesById.get(scopeId);
        if (!scope) {
            return false;
        }

        const entry = scope.occurrences.get(symbol);
        if (!entry) {
            return false;
        }

        return entry.declarations.length > 0 || entry.references.length > 0;
    }

    /**
     * Removes all scopes registered for the given file path—including their
     * descendant scopes—from every internal index.
     *
     * Call this before re-analysing a changed file so that stale declaration
     * and occurrence data does not accumulate. The typical hot-reload workflow
     * is:
     * 1. Determine which files changed (e.g. via `getChangedFilePaths`).
     * 2. Call `getImpactedFilePaths` to expand the change set to all
     *    transitively-impacted files.
     * 3. Call `clearScopesForPath` for each impacted path.
     * 4. Re-analyse the impacted files to register fresh scopes.
     *
     * @param path - File path whose scopes should be removed.
     * @returns The total number of scopes removed (path-level + descendants).
     */
    public clearScopesForPath(path: string | null | undefined): number {
        if (!path || typeof path !== "string" || path.length === 0) {
            return 0;
        }

        const trackedPath = this.normalizeTrackedPath(path);
        const rootScopeIds = this.pathToScopesIndex.get(trackedPath);
        if (!rootScopeIds || rootScopeIds.size === 0) {
            return 0;
        }

        // Collect all scope IDs to remove: path-level scopes + all their descendants.
        // Copy root IDs first so iteration is not affected by later deletions.
        const scopeIdsToRemove = new Set<string>(rootScopeIds);
        for (const scopeId of rootScopeIds) {
            for (const descId of this.getDescendantScopeIds(scopeId)) {
                scopeIdsToRemove.add(descId);
            }
        }
        const declaredNamesToInvalidate = new Set<string>();
        const pathsToRecompute = new Set<string>();

        for (const scopeId of scopeIdsToRemove) {
            const scope = this.scopesById.get(scopeId);
            if (!scope) {
                continue;
            }

            // Fully invalidate identifier-resolution cache for every declared symbol,
            // since any scope in the tracker could have cached a lookup that resolved
            // to a declaration in this scope.
            for (const name of scope.symbolMetadata.keys()) {
                declaredNamesToInvalidate.add(name);
                const scopeSummaryMap = this.symbolToScopesIndex.get(name);
                if (scopeSummaryMap) {
                    scopeSummaryMap.delete(scopeId);
                    if (scopeSummaryMap.size === 0) {
                        this.symbolToScopesIndex.delete(name);
                    }
                }
            }

            // Remove from symbolToScopesIndex for symbols that are only referenced
            // (not declared) in this scope.
            for (const name of scope.occurrences.keys()) {
                if (!scope.symbolMetadata.has(name)) {
                    const scopeSummaryMap = this.symbolToScopesIndex.get(name);
                    if (scopeSummaryMap) {
                        scopeSummaryMap.delete(scopeId);
                        if (scopeSummaryMap.size === 0) {
                            this.symbolToScopesIndex.delete(name);
                        }
                    }
                }
            }

            // Unlink from parent's children only when the parent itself is not
            // also being removed (avoids redundant work for intermediate scopes).
            if (scope.parent && !scopeIdsToRemove.has(scope.parent.id)) {
                const siblings = this.scopeChildrenIndex.get(scope.parent.id);
                if (siblings) {
                    siblings.delete(scopeId);
                    if (siblings.size === 0) {
                        this.scopeChildrenIndex.delete(scope.parent.id);
                    }
                }
            }

            // Remove own children-index entry.
            this.scopeChildrenIndex.delete(scopeId);

            // Remove from path index (covers both the requested path and any
            // descendant scopes that carry their own path metadata).
            const scopePath = scope.metadata.path;
            if (scopePath) {
                const trackedScopePath = this.normalizeTrackedPath(scopePath);
                pathsToRecompute.add(trackedScopePath);
                const scopeSet = this.pathToScopesIndex.get(trackedScopePath);
                if (scopeSet) {
                    scopeSet.delete(scopeId);
                    if (scopeSet.size === 0) {
                        this.pathToScopesIndex.delete(trackedScopePath);
                    }
                }
            }

            this.scopesById.delete(scopeId);

            if (this.rootScope?.id === scopeId) {
                this.rootScope = null;
            }
        }

        for (const name of declaredNamesToInvalidate) {
            this.identifierCache.invalidate(name);
        }

        for (const pathToRecompute of pathsToRecompute) {
            this.recomputePathLastModified(pathToRecompute);
        }

        // The lookup cache is keyed on identifier names resolved at a specific
        // stack depth; clearing it conservatively ensures no stale hits remain.
        this.lookupCache.clear();

        return scopeIdsToRemove.size;
    }

    /**
     * Returns the complete set of file paths that require re-analysis when the
     * given file paths change.
     *
     * Expands each changed path to its transitive set of dependent scopes and
     * collects the file path recorded in each dependent scope's metadata.
     * This gives callers a single flat set of paths to clear and re-analyse
     * rather than requiring them to navigate the scope graph manually.
     * Returned paths are normalized to forward-slash separators to prevent
     * duplicate work when callers provide mixed slash conventions.
     *
     * Scopes without a `path` in their metadata (e.g. anonymous blocks) are
     * silently skipped—only named file scopes contribute to the result.
     *
     * @param changedPaths - Iterable of file paths that have changed.
     * @returns Set of file paths that need re-analysis, including the changed
     *          paths themselves when they have registered scopes.
     */
    public getImpactedFilePaths(changedPaths: Iterable<string>): Set<string> {
        const result = new Set<string>();
        const seenTrackedPaths = new Set<string>();
        const transitiveDependentsCache = new Map<
            string,
            Array<{ dependentScopeId: string; dependentScopeKind: string; depth: number }>
        >();

        for (const filePath of changedPaths) {
            if (!filePath || typeof filePath !== "string" || filePath.length === 0) {
                continue;
            }

            const trackedPath = this.normalizeTrackedPath(filePath);
            if (seenTrackedPaths.has(trackedPath)) {
                continue;
            }
            seenTrackedPaths.add(trackedPath);

            const scopeIds = this.pathToScopesIndex.get(trackedPath);
            if (!scopeIds || scopeIds.size === 0) {
                continue;
            }

            // Include the changed file itself with normalized separators.
            result.add(trackedPath);

            for (const scopeId of scopeIds) {
                let transitiveDeps = transitiveDependentsCache.get(scopeId);
                if (!transitiveDeps) {
                    transitiveDeps = this.getTransitiveDependents(scopeId);
                    transitiveDependentsCache.set(scopeId, transitiveDeps);
                }

                for (const dep of transitiveDeps) {
                    const depScope = this.scopesById.get(dep.dependentScopeId);
                    const depPath = depScope?.metadata.path;
                    if (depPath) {
                        result.add(this.normalizeTrackedPath(depPath));
                    }
                }
            }
        }

        return result;
    }

    /**
     * Collects unique, non-empty paths from an iterable and normalises them
     * to a consistent form for internal path-index lookups.
     *
     * @returns Map of normalisedPath → originalPath with duplicates removed.
     */
    private collectNormalisedInputPaths(paths: Iterable<string>): Map<string, string> {
        const inputPaths = new Map<string, string>();
        for (const p of paths) {
            if (p && typeof p === "string" && p.length > 0) {
                const normalised = this.normalizeTrackedPath(p);
                if (!inputPaths.has(normalised)) {
                    inputPaths.set(normalised, p);
                }
            }
        }
        return inputPaths;
    }

    /**
     * Inspects a single symbol occurrence within a scope and records a
     * directed dependency edge when the symbol resolves to a declaration in a
     * different path that is also present in the input set.
     *
     * Called for every `(name, entry)` pair where `entry.references.length > 0`.
     */
    private recordCrossPathDependencyEdge(
        name: string,
        scopeId: string,
        scope: Scope,
        normalisedPath: string,
        inputPaths: Map<string, string>,
        edges: Map<string, Set<string>>,
        inDegree: Map<string, number>
    ): void {
        // Skip symbols declared locally — they don't create a cross-file edge.
        if (scope.symbolMetadata.has(name)) {
            return;
        }

        const declaringId = this.resolveDeclaringScopeId(name, scopeId);
        if (!declaringId || declaringId === scopeId) {
            return;
        }

        const declaringPath = this.scopesById.get(declaringId)?.metadata.path;
        if (!declaringPath) {
            return;
        }

        const normDeclaringPath = this.normalizeTrackedPath(declaringPath);
        if (normDeclaringPath === normalisedPath || !inputPaths.has(normDeclaringPath)) {
            // Dependency is outside the input set or points back to self — skip.
            return;
        }

        // normalisedPath depends on normDeclaringPath; add the directed edge.
        const outEdges = edges.get(normDeclaringPath);
        if (outEdges && !outEdges.has(normalisedPath)) {
            outEdges.add(normalisedPath);
            inDegree.set(normalisedPath, (inDegree.get(normalisedPath) ?? 0) + 1);
        }
    }

    /**
     * Scans all scopes registered under `normalisedPath` and adds directed
     * dependency edges for every cross-path symbol reference found.
     */
    private populatePathEdgesFromScopes(
        normalisedPath: string,
        inputPaths: Map<string, string>,
        edges: Map<string, Set<string>>,
        inDegree: Map<string, number>
    ): void {
        const scopeIds = this.pathToScopesIndex.get(normalisedPath);
        if (!scopeIds || scopeIds.size === 0) {
            return;
        }

        for (const scopeId of scopeIds) {
            const scope = this.scopesById.get(scopeId);
            if (!scope) {
                continue;
            }

            for (const [name, entry] of scope.occurrences) {
                if (entry.references.length === 0) {
                    continue;
                }
                this.recordCrossPathDependencyEdge(name, scopeId, scope, normalisedPath, inputPaths, edges, inDegree);
            }
        }
    }

    /**
     * Builds a directed path-level dependency graph over the given input paths.
     *
     * @returns `edges` (dependency → Set of dependents) and `inDegree`
     *          (path → number of dependencies within the input set).
     */
    private buildPathLevelDependencyGraph(inputPaths: Map<string, string>): {
        edges: Map<string, Set<string>>;
        inDegree: Map<string, number>;
    } {
        const edges = new Map<string, Set<string>>();
        const inDegree = new Map<string, number>();
        for (const normalisedPath of inputPaths.keys()) {
            inDegree.set(normalisedPath, 0);
            edges.set(normalisedPath, new Set());
        }

        if (!this.enabled) {
            return { edges, inDegree };
        }

        for (const normalisedPath of inputPaths.keys()) {
            this.populatePathEdgesFromScopes(normalisedPath, inputPaths, edges, inDegree);
        }
        return { edges, inDegree };
    }

    /**
     * Decrements in-degrees for all paths that depend on `current`, and
     * appends any newly zero-in-degree paths to `queue` in lexicographic order.
     */
    private advanceTopologicalWave(
        current: string,
        edges: Map<string, Set<string>>,
        inDegree: Map<string, number>,
        queue: string[]
    ): void {
        const dependents = edges.get(current);
        if (!dependents) {
            return;
        }

        const newlyReady: string[] = [];
        for (const dep of dependents) {
            const newDegree = (inDegree.get(dep) ?? 1) - 1;
            inDegree.set(dep, newDegree);
            if (newDegree === 0) {
                newlyReady.push(dep);
            }
        }
        // Sort within the new wave for deterministic output.
        newlyReady.sort();
        for (const p of newlyReady) {
            queue.push(p);
        }
    }

    /**
     * Applies Kahn's topological sort to the dependency graph and returns the
     * ordered array of original (non-normalised) paths.
     *
     * Paths that remain in the graph after the sort (i.e. part of a cycle) are
     * appended in lexicographic order.
     */
    private topologicallySortPaths(
        inputPaths: Map<string, string>,
        edges: Map<string, Set<string>>,
        inDegree: Map<string, number>
    ): string[] {
        // Seed queue with zero-in-degree nodes in lexicographic order.
        const queue: string[] = [];
        for (const [normalisedPath, degree] of inDegree) {
            if (degree === 0) {
                queue.push(normalisedPath);
            }
        }
        queue.sort();

        const result: string[] = [];
        let queueIndex = 0;
        while (queueIndex < queue.length) {
            const current = queue[queueIndex];
            queueIndex += 1;
            const original = inputPaths.get(current);
            if (original !== undefined) {
                result.push(original);
            }
            this.advanceTopologicalWave(current, edges, inDegree, queue);
        }

        // Append any cycle members in lexicographic order.
        const cycleNodes: string[] = [];
        for (const [normalisedPath, degree] of inDegree) {
            if (degree > 0) {
                const original = inputPaths.get(normalisedPath);
                if (original !== undefined) {
                    cycleNodes.push(original);
                }
            }
        }
        cycleNodes.sort();
        result.push(...cycleNodes);

        return result;
    }

    /**
     * Sorts a collection of file paths into dependency order for re-analysis.
     *
     * Paths whose scopes have no dependencies on other paths in the collection
     * are placed first (topological order). Paths that depend on others are
     * placed after their dependencies, ensuring that when callers re-analyse
     * each path in the returned order the declarations of a path's dependencies
     * are always registered before the dependents are processed.
     *
     * **Must be called before `clearScopesForPath`**: scope metadata is
     * consumed to compute the path-level dependency graph, so sorting must
     * happen while the current (possibly stale) scopes are still registered.
     *
     * Cycles in the dependency graph are handled gracefully: after all acyclic
     * nodes are emitted, any remaining cycle members are appended in
     * lexicographic order to produce a deterministic result.
     *
     * Paths with no registered scopes (not yet indexed) carry no dependency
     * information and are treated as independent — they appear first among
     * zero-in-degree nodes in lexicographic order.
     *
     * @param paths - Paths to sort, typically the result of `getImpactedFilePaths`.
     * @returns Array of paths ordered so that dependencies precede dependents.
     */
    public sortPathsForReanalysis(paths: Iterable<string>): string[] {
        const inputPaths = this.collectNormalisedInputPaths(paths);
        if (inputPaths.size === 0) {
            return [];
        }
        const { edges, inDegree } = this.buildPathLevelDependencyGraph(inputPaths);
        return this.topologicallySortPaths(inputPaths, edges, inDegree);
    }
}

export default ScopeTracker;
