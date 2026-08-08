/**
 * Shared types and pure helper functions used by {@link GmlSemanticBridge} and
 * its collaborator classes (index cache, source text cache, workspace overlay,
 * occurrence collector, naming-convention target collector).
 *
 * Keeping these in a single module avoids circular imports between the
 * collaborator files while letting each collaborator depend only on the
 * shapes it actually needs.
 */

import { Core } from "@gmloop/core";
import type { OccurrenceKindValue } from "@gmloop/refactor";

export type SemanticResourceRecord = {
    name?: string;
    path?: string;
    resourceType?: string;
};

export type SemanticIdentifierEntry = {
    declarationKinds?: Array<unknown>;
    declarations?: Array<Record<string, unknown>>;
    enumName?: string;
    identifierId?: string;
    key?: string;
    name?: string;
    references?: Array<Record<string, unknown>>;
    resourcePath?: string;
    scopeId?: string;
};

export type SemanticFileRecord = {
    declarations?: Array<Record<string, unknown>>;
    references?: Array<Record<string, unknown>>;
};

export type SemanticIdentifierCollections = {
    enumMembers?: Record<string, SemanticIdentifierEntry>;
    constructorStaticMembers?: Record<string, SemanticIdentifierEntry>;
    enums?: Record<string, SemanticIdentifierEntry>;
    globalVariables?: Record<string, SemanticIdentifierEntry>;
    instanceVariables?: Record<string, SemanticIdentifierEntry>;
    macros?: Record<string, SemanticIdentifierEntry>;
    scripts?: Record<string, SemanticIdentifierEntry>;
    localVariables?: Record<string, SemanticIdentifierEntry>;
    structVariables?: Record<string, SemanticIdentifierEntry>;
};

export type SemanticScopeRecord = {
    kind?: string;
};

export type SemanticScriptCallRecord = {
    from?: {
        filePath?: string;
        scopeId?: string;
    };
    location?: {
        end?: {
            index?: number;
        };
        start?: {
            index?: number;
        };
    };
    target?: {
        name?: string;
    };
};

export type MaybePromise<T> = T | Promise<T>;

export type SymbolLookupResult = {
    name: string;
};

export type SymbolOccurrence = {
    end: number;
    kind?: "definition" | "reference";
    path: string;
    scopeId?: string;
    start: number;
};

/** Minimal shape of a reference record within a semantic identifier entry's `references` array. */
export type SemanticEntryReferenceRecord = {
    end?: { index?: number };
    filePath?: unknown;
    location?: { end?: { index?: number }; start?: { index?: number } };
    scopeId?: unknown;
    start?: { index?: number };
};

export type FileSymbol = {
    id: string;
};

export type DependentSymbol = {
    filePath: string;
    symbolId: string;
};

export type BridgeNamingConventionCategory =
    | "resource"
    | "scriptResourceName"
    | "objectResourceName"
    | "roomResourceName"
    | "spriteResourceName"
    | "audioResourceName"
    | "timelineResourceName"
    | "shaderResourceName"
    | "fontResourceName"
    | "pathResourceName"
    | "animationCurveResourceName"
    | "sequenceResourceName"
    | "tilesetResourceName"
    | "particleSystemResourceName"
    | "noteResourceName"
    | "extensionResourceName"
    | "localVariable"
    | "staticVariable"
    | "globalVariable"
    | "instanceVariable"
    | "argument"
    | "catchArgument"
    | "loopIndexVariable"
    | "function"
    | "constructorFunction"
    | "structDeclaration"
    | "enum"
    | "enumMember"
    | "macro";

export type BridgeNamingConventionTarget = {
    category: BridgeNamingConventionCategory;
    name: string;
    occurrences: Array<SymbolOccurrence>;
    path: string;
    scopeId: string | null;
    symbolId: string | null;
};

export type IndexedSymbolLookupEntry = {
    name: string;
    scopeId?: string;
};

export type IndexedUnresolvedFileReference = {
    filePath: string;
    reference: Record<string, unknown>;
};

export type ScriptCallableDeclaration = Record<string, unknown> & {
    filePath: string;
    name: string;
};

export type ScriptCallableDeclarationEntry = {
    declaration: ScriptCallableDeclaration;
    entry: SemanticIdentifierEntry;
};

export type ScriptResourceIndexes = {
    scriptCallableDeclarationsByResourcePath: Map<string, Array<ScriptCallableDeclarationEntry>>;
    scriptEntriesByResourcePath: Map<string, Array<SemanticIdentifierEntry>>;
};

export type SemanticBridgeIndexes = {
    entriesByIdentifierId: Map<string, SemanticIdentifierEntry>;
    entriesByRelatedName: Map<string, Set<SemanticIdentifierEntry>>;
    entriesByScipId: Map<string, SemanticIdentifierEntry>;
    exactResolveSymbolIds: Map<string, string>;
    lowerResolveSymbolIds: Map<string, string>;
    resourcesByExactName: Map<string, SemanticResourceRecord>;
    resourcesByLowerName: Map<string, SemanticResourceRecord>;
    scriptCallsByTargetName: Map<string, Array<SemanticScriptCallRecord>>;
    symbolLookupsByExactName: Map<string, Array<IndexedSymbolLookupEntry>>;
    unresolvedReferencesByExactName: Map<string, Array<IndexedUnresolvedFileReference>>;
};

export function toExclusiveEndIndex(endIndex: number): number {
    // The semantic index stores end offsets as the final character position.
    // Refactor text edits use one-past-the-end (exclusive) indexes.
    return endIndex + 1;
}

export function resolveOccurrenceEndIndex(endIndex: unknown): number | null {
    return typeof endIndex === "number" ? toExclusiveEndIndex(endIndex) : null;
}

export function isIdentifierBoundary(character: string | undefined): boolean {
    return character === undefined || !/[A-Za-z0-9_]/u.test(character);
}

export function isIdentifierTokenAt(sourceText: string, startIndex: number, identifierName: string): boolean {
    if (startIndex < 0 || identifierName.length === 0) {
        return false;
    }

    const endIndex = startIndex + identifierName.length;
    return (
        sourceText.slice(startIndex, endIndex) === identifierName &&
        isIdentifierBoundary(sourceText[startIndex - 1]) &&
        isIdentifierBoundary(sourceText[endIndex])
    );
}

export function createIdentifierTokenOccurrence(parameters: {
    sourceText: string | null;
    filePath: string;
    name: string;
    startIndex: number | null;
    endIndex: number | null;
    scopeId: unknown;
    kind: OccurrenceKindValue;
}): SymbolOccurrence | null {
    if (parameters.startIndex === null) {
        return null;
    }

    if (parameters.sourceText === null) {
        if (parameters.endIndex === null || parameters.endIndex <= parameters.startIndex) {
            return null;
        }
        return {
            path: parameters.filePath,
            start: parameters.startIndex,
            end: parameters.endIndex,
            scopeId: typeof parameters.scopeId === "string" ? parameters.scopeId : undefined,
            kind: parameters.kind
        };
    }

    if (!isIdentifierTokenAt(parameters.sourceText, parameters.startIndex, parameters.name)) {
        return null;
    }
    return {
        path: parameters.filePath,
        start: parameters.startIndex,
        end: parameters.startIndex + parameters.name.length,
        scopeId: typeof parameters.scopeId === "string" ? parameters.scopeId : undefined,
        kind: parameters.kind
    };
}

/**
 * Extract position data from a semantic entry reference record and push a validated
 * reference occurrence onto the accumulator. Silently skips records with missing or
 * invalid location data.
 */
export function pushEntryReferenceOccurrence(
    ref: SemanticEntryReferenceRecord,
    occurrences: Array<SymbolOccurrence>
): void {
    const start = ref.start?.index ?? ref.location?.start?.index ?? 0;
    const end = resolveOccurrenceEndIndex(ref.end?.index ?? ref.location?.end?.index);
    const filePath = typeof ref.filePath === "string" ? ref.filePath : "";

    if (!Core.isNonEmptyString(filePath) || end === null || end <= start) {
        return;
    }

    occurrences.push({
        path: filePath,
        start,
        end,
        scopeId: typeof ref.scopeId === "string" ? ref.scopeId : undefined,
        kind: "reference"
    });
}
