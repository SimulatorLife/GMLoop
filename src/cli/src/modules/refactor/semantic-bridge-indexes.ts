/**
 * Index building/caching collaborator for {@link GmlSemanticBridge}.
 *
 * Owns the derived lookup structures (`SemanticBridgeIndexes` and
 * `ScriptResourceIndexes`) that the bridge builds once per project-index
 * generation and reuses across many queries. Extracted from the bridge so the
 * "build and cache derived maps from the semantic project index" concern is
 * testable and readable independent of symbol resolution, occurrence
 * collection, and naming-target discovery.
 */

import { Core } from "@gmloop/core";

import type {
    IndexedSymbolLookupEntry,
    IndexedUnresolvedFileReference,
    ScriptCallableDeclaration,
    ScriptCallableDeclarationEntry,
    ScriptResourceIndexes,
    SemanticBridgeIndexes,
    SemanticFileRecord,
    SemanticIdentifierCollections,
    SemanticIdentifierEntry,
    SemanticResourceRecord,
    SemanticScriptCallRecord
} from "./semantic-bridge-shared.js";

/** Narrow view of {@link GmlSemanticBridge} that the index manager needs to build its caches. */
export interface SemanticBridgeIndexManagerHost {
    getIdentifiers(): SemanticIdentifierCollections;
    getProjectIndex(): Record<string, unknown>;
    getResources(): Record<string, SemanticResourceRecord>;
    generateResourceScipId(resource: SemanticResourceRecord): string;
    generateScipId(entry: SemanticIdentifierEntry, nestedName?: string): string;
}

export class SemanticBridgeIndexManager {
    private indexes: SemanticBridgeIndexes | null = null;
    private scriptResourceIndexes: ScriptResourceIndexes | null = null;

    constructor(private readonly host: SemanticBridgeIndexManagerHost) {}

    /** Drop all cached indexes. Call after the underlying project index changes. */
    invalidate(): void {
        this.indexes = null;
        this.scriptResourceIndexes = null;
    }

    getIndexes(): SemanticBridgeIndexes {
        const existingIndexes = this.indexes;
        if (existingIndexes) {
            return existingIndexes;
        }

        const createdIndexes = this.buildIndexes();
        this.indexes = createdIndexes;
        return createdIndexes;
    }

    getScriptResourceIndexes(): ScriptResourceIndexes {
        const existingIndexes = this.scriptResourceIndexes;
        if (existingIndexes !== null) {
            return existingIndexes;
        }

        const scriptCallableDeclarationsByResourcePath = new Map<string, Array<ScriptCallableDeclarationEntry>>();
        const scriptEntriesByResourcePath = new Map<string, Array<SemanticIdentifierEntry>>();

        for (const entry of Object.values(this.host.getIdentifiers().scripts ?? {})) {
            if (!Core.isNonEmptyString(entry.resourcePath)) {
                continue;
            }

            const resourceEntries = scriptEntriesByResourcePath.get(entry.resourcePath);
            if (resourceEntries) {
                resourceEntries.push(entry);
            } else {
                scriptEntriesByResourcePath.set(entry.resourcePath, [entry]);
            }

            for (const declaration of entry.declarations ?? []) {
                if (
                    declaration.isSynthetic === true ||
                    typeof declaration.name !== "string" ||
                    typeof declaration.filePath !== "string"
                ) {
                    continue;
                }

                const resourceDeclarations = scriptCallableDeclarationsByResourcePath.get(entry.resourcePath) ?? [];
                resourceDeclarations.push({
                    entry,
                    declaration: declaration as ScriptCallableDeclaration
                });
                scriptCallableDeclarationsByResourcePath.set(entry.resourcePath, resourceDeclarations);
            }
        }

        const createdIndexes = {
            scriptCallableDeclarationsByResourcePath,
            scriptEntriesByResourcePath
        };
        this.scriptResourceIndexes = createdIndexes;
        return createdIndexes;
    }

    private buildIndexes(): SemanticBridgeIndexes {
        const identifiers = this.host.getIdentifiers();
        const resources = this.host.getResources();
        const projectIndex = this.host.getProjectIndex();
        const entriesByIdentifierId = new Map<string, SemanticIdentifierEntry>();
        const entriesByRelatedName = new Map<string, Set<SemanticIdentifierEntry>>();
        const entriesByScipId = new Map<string, SemanticIdentifierEntry>();
        const exactResolveSymbolIds = new Map<string, string>();
        const lowerResolveSymbolIds = new Map<string, string>();
        const resourcesByExactName = new Map<string, SemanticResourceRecord>();
        const resourcesByLowerName = new Map<string, SemanticResourceRecord>();
        const scriptCallsByTargetName = new Map<string, Array<SemanticScriptCallRecord>>();
        const symbolLookupsByExactName = new Map<string, Array<IndexedSymbolLookupEntry>>();
        const unresolvedReferencesByExactName = new Map<string, Array<IndexedUnresolvedFileReference>>();
        const priorityCollections: Array<keyof SemanticIdentifierCollections> = [
            "scripts",
            "macros",
            "globalVariables",
            "enums",
            "enumMembers",
            "constructorStaticMembers",
            "instanceVariables",
            "localVariables",
            "structVariables"
        ];

        const appendRelatedEntry = (name: string, entry: SemanticIdentifierEntry): void => {
            if (!Core.isNonEmptyString(name)) {
                return;
            }

            const existingEntries = entriesByRelatedName.get(name);
            if (existingEntries) {
                existingEntries.add(entry);
                return;
            }

            entriesByRelatedName.set(name, new Set([entry]));
        };

        const appendLookupEntry = (name: string, scopeId?: string): void => {
            if (!Core.isNonEmptyString(name)) {
                return;
            }

            const existingEntries = symbolLookupsByExactName.get(name);
            if (!existingEntries) {
                symbolLookupsByExactName.set(name, [{ name, scopeId }]);
                return;
            }

            if (!existingEntries.some((entry) => entry.scopeId === scopeId)) {
                existingEntries.push({ name, scopeId });
            }
        };

        const registerResolveSymbolId = (name: string, symbolId: string): void => {
            if (!Core.isNonEmptyString(name) || !Core.isNonEmptyString(symbolId)) {
                return;
            }

            if (!exactResolveSymbolIds.has(name)) {
                exactResolveSymbolIds.set(name, symbolId);
            }

            const lowerName = name.toLowerCase();
            if (!lowerResolveSymbolIds.has(lowerName)) {
                lowerResolveSymbolIds.set(lowerName, symbolId);
            }
        };

        const indexEntry = (entry: SemanticIdentifierEntry): void => {
            if (Core.isNonEmptyString(entry.identifierId)) {
                entriesByIdentifierId.set(entry.identifierId, entry);
            }

            if (Core.isNonEmptyString(entry.name)) {
                const entryScipId = this.host.generateScipId(entry);
                appendRelatedEntry(entry.name, entry);
                appendLookupEntry(entry.name, entry.scopeId);
                registerResolveSymbolId(entry.name, entryScipId);
                entriesByScipId.set(entryScipId, entry);
            }

            for (const declaration of entry.declarations ?? []) {
                if (typeof declaration.name !== "string") {
                    continue;
                }

                const declarationScopeId =
                    typeof declaration.scopeId === "string" ? declaration.scopeId : entry.scopeId;
                const declarationScipId = this.host.generateScipId(entry, declaration.name);
                appendRelatedEntry(declaration.name, entry);
                appendLookupEntry(declaration.name, declarationScopeId);
                registerResolveSymbolId(declaration.name, declarationScipId);
                entriesByScipId.set(declarationScipId, entry);
            }

            for (const reference of entry.references ?? []) {
                if (typeof reference.targetName === "string") {
                    appendRelatedEntry(reference.targetName, entry);
                }

                if (typeof reference.name === "string") {
                    appendRelatedEntry(reference.name, entry);
                }
            }
        };

        const appendUnresolvedReference = (
            name: string | null,
            filePath: string,
            reference: Record<string, unknown>
        ): void => {
            if (!Core.isNonEmptyString(name)) {
                return;
            }

            const existingReferences = unresolvedReferencesByExactName.get(name);
            if (existingReferences) {
                existingReferences.push({
                    filePath,
                    reference
                });
                return;
            }

            unresolvedReferencesByExactName.set(name, [
                {
                    filePath,
                    reference
                }
            ]);
        };

        for (const collectionName of priorityCollections) {
            const collection = identifiers[collectionName];
            if (!collection) {
                continue;
            }

            for (const entry of Object.values(collection)) {
                indexEntry(entry);
            }
        }

        for (const [resourcePath, resource] of Object.entries(resources)) {
            if (!Core.isNonEmptyString(resource?.name)) {
                continue;
            }

            const resourceScipId = this.host.generateResourceScipId(resource);
            resourcesByExactName.set(resource.name, resource);
            resourcesByLowerName.set(resource.name.toLowerCase(), resource);
            appendLookupEntry(resource.name);
            registerResolveSymbolId(resource.name, resourceScipId);

            if (!Core.isNonEmptyString(resource.path)) {
                resource.path = resourcePath;
            }
        }

        const relationships = projectIndex.relationships as
            { scriptCalls?: Array<SemanticScriptCallRecord> } | undefined;
        for (const call of relationships?.scriptCalls ?? []) {
            const targetName = call.target?.name;
            if (!Core.isNonEmptyString(targetName)) {
                continue;
            }

            const existingCalls = scriptCallsByTargetName.get(targetName);
            if (existingCalls) {
                existingCalls.push(call);
            } else {
                scriptCallsByTargetName.set(targetName, [call]);
            }
        }

        for (const [filePath, fileRecord] of Object.entries(projectIndex.files ?? {})) {
            const typedFileRecord = fileRecord as SemanticFileRecord;

            // Index local declarations for scope-aware lookups
            for (const declaration of typedFileRecord.declarations ?? []) {
                if (declaration && typeof declaration.name === "string") {
                    const declarationScopeId = typeof declaration.scopeId === "string" ? declaration.scopeId : null;
                    appendLookupEntry(declaration.name, declarationScopeId);
                }
            }

            for (const reference of typedFileRecord.references ?? []) {
                if (!Core.isObjectLike(reference) || Core.isObjectLike(reference.declaration)) {
                    continue;
                }

                const referenceTargetName = typeof reference.targetName === "string" ? reference.targetName : null;
                const referenceName = typeof reference.name === "string" ? reference.name : null;
                appendUnresolvedReference(referenceTargetName, filePath, reference);
                if (referenceTargetName !== referenceName) {
                    appendUnresolvedReference(referenceName, filePath, reference);
                }
            }
        }

        return {
            entriesByIdentifierId,
            entriesByRelatedName,
            entriesByScipId,
            exactResolveSymbolIds,
            lowerResolveSymbolIds,
            resourcesByExactName,
            resourcesByLowerName,
            scriptCallsByTargetName,
            symbolLookupsByExactName,
            unresolvedReferencesByExactName
        };
    }
}
