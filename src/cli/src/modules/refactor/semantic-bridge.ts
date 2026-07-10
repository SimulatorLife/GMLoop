import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";
import {
    type OccurrenceKindValue,
    readExclusiveSemanticLocationIndex,
    readSemanticLocationIndex,
    WORKSPACE_EDIT_REVISION_TOKEN
} from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";

import { pathExistsSync } from "../../shared/path-exists.js";
import {
    createSyntheticResourceEntry as makeSyntheticResourceEntry,
    generateIdentifierEntryScipId,
    generateResourceScipId,
    mapResourceTypeToScipKind,
    matchesSymbolIdSet
} from "./bridge-scip-id-generators.js";
import { listConstructorRuntimeTypeReferenceRecords } from "./constructor-runtime-type-references.js";
import { GmlIdentifierOccurrenceIndex } from "./gml-identifier-occurrence-index.js";
import { isRefactorOwnerMetadataPath, isRefactorResourcePath } from "./gml-resource-path.js";
import { collectImplicitInstanceVariableTargets } from "./implicit-instance-variable-targets.js";
import {
    listMacroDeclarationReferenceRecords,
    listMacroExpansionDependencies
} from "./macro-expansion-dependencies.js";
import { ParsedLocalNamingCategoryResolver } from "./parsed-local-naming-categories.js";
import { collectResourceSidecarRenames, resolveRenamedSoundFileName } from "./resource-sidecar-renames.js";

type ResourceAssetReferenceRecord = {
    propertyPath: string;
    targetPath: string;
};

type ResourceMetadataRecord = {
    assetReferences: Array<ResourceAssetReferenceRecord>;
    path: string;
};

type ProjectMetadataReferenceIndex = {
    manifestMetadataRecords: Array<ResourceMetadataRecord>;
    metadataRecordsByPath: Map<string, ResourceMetadataRecord>;
    referencingMetadataRecordsByLowerTargetPath: Map<string, Array<ResourceMetadataRecord>>;
    referencingMetadataRecordsByTargetPath: Map<string, Array<ResourceMetadataRecord>>;
};
type MutableProjectMetadataDocument = {
    parsed: Record<string, unknown>;
    rawContent: string;
};

type SemanticResourceRecord = {
    name?: string;
    path?: string;
    resourceType?: string;
};

type SemanticIdentifierEntry = {
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

type SemanticFileRecord = {
    declarations?: Array<Record<string, unknown>>;
    references?: Array<Record<string, unknown>>;
};

type SemanticIdentifierCollections = {
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

type SemanticScopeRecord = {
    kind?: string;
};

type SemanticScriptCallRecord = {
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

type MaybePromise<T> = T | Promise<T>;

type SymbolLookupResult = {
    name: string;
};

type SymbolOccurrence = {
    end: number;
    kind?: "definition" | "reference";
    path: string;
    scopeId?: string;
    start: number;
};

/** Minimal shape of a reference record within a semantic identifier entry's `references` array. */
type SemanticEntryReferenceRecord = {
    end?: { index?: number };
    filePath?: unknown;
    location?: { end?: { index?: number }; start?: { index?: number } };
    scopeId?: unknown;
    start?: { index?: number };
};

type FileSymbol = {
    id: string;
};

type DependentSymbol = {
    filePath: string;
    symbolId: string;
};

type BridgeNamingConventionCategory =
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

type BridgeNamingConventionTarget = {
    category: BridgeNamingConventionCategory;
    name: string;
    occurrences: Array<SymbolOccurrence>;
    path: string;
    scopeId: string | null;
    symbolId: string | null;
};

type WorkspaceEdit = {
    addEdit: (path: string, start: number, end: number, newText: string) => void;
    addFileRename: (oldPath: string, newPath: string) => void;
    addMetadataEdit: (path: string, content: string) => void;
    addMetadataObjectEdit?: (path: string, document: Record<string, unknown>) => void;
    edits: Array<{ end: number; newText: string; path: string; start: number }>;
    fileRenames: Array<{ newPath: string; oldPath: string }>;
    metadataEdits: Array<{ content: string; path: string }>;
    metadataObjects?: Array<{ document: Record<string, unknown>; path: string }>;
    groupByFile: () => BridgeGroupedTextEdits;
    hasChanges: () => boolean;
    collectChangedFilePaths: () => ReadonlySet<string>;
    [WORKSPACE_EDIT_REVISION_TOKEN]: () => number;
};

type BridgeTextEdit = {
    end: number;
    newText: string;
    start: number;
};

type BridgeGroupedTextEdits = Map<string, Array<BridgeTextEdit>>;
type NamingTargetPathPredicate = (candidatePath: string | null | undefined) => boolean;
type NamingTargetSink = (target: BridgeNamingConventionTarget) => void;
type IndexedSymbolLookupEntry = {
    name: string;
    scopeId?: string;
};
type IndexedUnresolvedFileReference = {
    filePath: string;
    reference: Record<string, unknown>;
};
type SemanticGapReferenceCandidate = {
    filePath: string;
    isBareCall: boolean;
    isProperty: boolean;
    reference: Record<string, unknown> | null;
    start: number;
    end: number;
};
type ScriptCallableDeclaration = Record<string, unknown> & {
    filePath: string;
    name: string;
};
type ScriptCallableDeclarationEntry = {
    declaration: ScriptCallableDeclaration;
    entry: SemanticIdentifierEntry;
};
type ScriptResourceIndexes = {
    scriptCallableDeclarationsByResourcePath: Map<string, Array<ScriptCallableDeclarationEntry>>;
    scriptEntriesByResourcePath: Map<string, Array<SemanticIdentifierEntry>>;
};
type SemanticBridgeIndexes = {
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
type LocalReferenceIndex = Map<string, Array<SymbolOccurrence>>;

const SCRIPT_CALLABLE_NAMING_CATEGORIES: ReadonlyArray<BridgeNamingConventionCategory> = [
    "constructorFunction",
    "function",
    "structDeclaration"
];
const RESOURCE_NAMING_CATEGORIES: ReadonlyArray<BridgeNamingConventionCategory> = [
    "animationCurveResourceName",
    "audioResourceName",
    "constructorFunction",
    "extensionResourceName",
    "fontResourceName",
    "noteResourceName",
    "objectResourceName",
    "particleSystemResourceName",
    "pathResourceName",
    "roomResourceName",
    "scriptResourceName",
    "sequenceResourceName",
    "shaderResourceName",
    "spriteResourceName",
    "structDeclaration",
    "tilesetResourceName",
    "timelineResourceName"
];
const LOCAL_NAMING_CATEGORIES: ReadonlyArray<BridgeNamingConventionCategory> = [
    "argument",
    "catchArgument",
    "localVariable",
    "loopIndexVariable",
    "staticVariable"
];
const GLOBAL_AND_INSTANCE_NAMING_CATEGORIES: ReadonlyArray<BridgeNamingConventionCategory> = [
    "globalVariable",
    "instanceVariable"
];

function includesAnyRequestedNamingCategory(
    requestedCategories: ReadonlySet<BridgeNamingConventionCategory> | null,
    categories: ReadonlyArray<BridgeNamingConventionCategory>
): boolean {
    return requestedCategories === null || categories.some((category) => requestedCategories.has(category));
}

function normalizeNamingTargetQueryPath(projectRoot: string, candidatePath: string): string {
    const normalizedCandidatePath = candidatePath.replaceAll("\\", "/");
    const normalizedProjectRoot = path.resolve(projectRoot).replaceAll("\\", "/");
    const absoluteCandidatePath = path.isAbsolute(normalizedCandidatePath)
        ? normalizedCandidatePath
        : path.resolve(projectRoot, normalizedCandidatePath).replaceAll("\\", "/");

    if (
        absoluteCandidatePath === normalizedProjectRoot ||
        absoluteCandidatePath.startsWith(`${normalizedProjectRoot}/`)
    ) {
        return path.posix.relative(normalizedProjectRoot, absoluteCandidatePath);
    }

    return normalizedCandidatePath;
}

function createNamingTargetPathPredicate(
    projectRoot: string,
    filePaths?: Array<string>
): (candidatePath: string | null | undefined) => boolean {
    if (filePaths === undefined || filePaths.length === 0) {
        return (candidatePath: string | null | undefined): boolean => Core.isNonEmptyString(candidatePath);
    }

    const normalizedIncludedPaths = new Set(
        filePaths.filter(Core.isNonEmptyString).map((filePath) => normalizeNamingTargetQueryPath(projectRoot, filePath))
    );
    const selectedOwnerDirectories = new Set(
        [...normalizedIncludedPaths]
            .filter((candidatePath) => isRefactorResourcePath(candidatePath))
            .map((candidatePath) => path.posix.dirname(candidatePath))
    );
    const candidatePathMatches = new Map<string, boolean>();

    return (candidatePath: string | null | undefined): boolean => {
        if (!Core.isNonEmptyString(candidatePath)) {
            return false;
        }

        const cachedMatch = candidatePathMatches.get(candidatePath);
        if (cachedMatch !== undefined) {
            return cachedMatch;
        }

        const normalizedCandidatePath = normalizeNamingTargetQueryPath(projectRoot, candidatePath);
        if (normalizedIncludedPaths.has(normalizedCandidatePath)) {
            candidatePathMatches.set(candidatePath, true);
            return true;
        }

        const matches =
            isRefactorOwnerMetadataPath(normalizedCandidatePath) &&
            selectedOwnerDirectories.has(path.posix.dirname(normalizedCandidatePath));
        candidatePathMatches.set(candidatePath, matches);
        return matches;
    };
}

function toExclusiveEndIndex(endIndex: number): number {
    // The semantic index stores end offsets as the final character position.
    // Refactor text edits use one-past-the-end (exclusive) indexes.
    return endIndex + 1;
}

function resolveOccurrenceEndIndex(endIndex: unknown): number | null {
    return typeof endIndex === "number" ? toExclusiveEndIndex(endIndex) : null;
}

function isIdentifierBoundary(character: string | undefined): boolean {
    return character === undefined || !/[A-Za-z0-9_]/u.test(character);
}

function isIdentifierTokenAt(sourceText: string, startIndex: number, identifierName: string): boolean {
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

function escapeRegExpLiteral(value: string): string {
    return value.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
}

function createIdentifierTokenOccurrence(parameters: {
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
function pushEntryReferenceOccurrence(ref: SemanticEntryReferenceRecord, occurrences: Array<SymbolOccurrence>): void {
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

function createWorkspaceEdit(): WorkspaceEdit {
    let revision = 0;

    const workspace = {
        edits: [] as Array<{ end: number; newText: string; path: string; start: number }>,
        fileRenames: [] as Array<{ newPath: string; oldPath: string }>,
        metadataEdits: [] as Array<{ content: string; path: string }>,
        metadataObjects: [] as Array<{ document: Record<string, unknown>; path: string }>,
        addEdit(filePath: string, start: number, end: number, newText: string) {
            workspace.edits.push({ path: filePath, start, end, newText });
            revision += 1;
        },
        addFileRename(oldPath: string, newPath: string) {
            workspace.fileRenames.push({ oldPath, newPath });
            revision += 1;
        },
        addMetadataEdit(filePath: string, content: string) {
            workspace.metadataEdits.push({ path: filePath, content });
            revision += 1;
        },
        addMetadataObjectEdit(filePath: string, document: Record<string, unknown>) {
            workspace.metadataObjects.push({ path: filePath, document });
            revision += 1;
        },
        groupByFile() {
            const grouped: BridgeGroupedTextEdits = new Map();
            for (const edit of workspace.edits) {
                const fileEdits = grouped.get(edit.path) ?? [];
                fileEdits.push({
                    start: edit.start,
                    end: edit.end,
                    newText: edit.newText
                });
                grouped.set(edit.path, fileEdits);
            }

            for (const [groupPath, fileEdits] of grouped.entries()) {
                grouped.set(
                    groupPath,
                    fileEdits.toSorted((left, right) => right.start - left.start)
                );
            }

            return grouped;
        },
        hasChanges() {
            return workspace.edits.length > 0 || workspace.metadataEdits.length > 0 || workspace.fileRenames.length > 0;
        },
        collectChangedFilePaths() {
            const paths = new Set<string>();
            for (const edit of workspace.edits) {
                paths.add(edit.path);
            }
            for (const metadataEdit of workspace.metadataEdits) {
                paths.add(metadataEdit.path);
            }
            for (const fileRename of workspace.fileRenames) {
                paths.add(fileRename.oldPath);
                paths.add(fileRename.newPath);
            }
            return paths;
        },
        [WORKSPACE_EDIT_REVISION_TOKEN]() {
            return revision;
        }
    };

    return workspace satisfies WorkspaceEdit;
}

function isResourceAssetReferenceRecord(value: unknown): value is ResourceAssetReferenceRecord {
    if (!Core.isObjectLike(value)) {
        return false;
    }
    const reference = value as Record<string, unknown>;

    return typeof reference.propertyPath === "string" && typeof reference.targetPath === "string";
}

function normalizeResourceMetadataRecord(value: unknown): ResourceMetadataRecord | null {
    if (!Core.isObjectLike(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;

    if (typeof record.path !== "string") {
        return null;
    }

    if (!Array.isArray(record.assetReferences)) {
        return {
            assetReferences: [],
            path: record.path
        };
    }

    return {
        assetReferences: record.assetReferences.filter((reference) => isResourceAssetReferenceRecord(reference)),
        path: record.path
    };
}

const normalizedMetadataReferenceTargetPathCache = new Map<string, string>();

function normalizeMetadataReferenceTargetPath(targetPath: string): string {
    const cachedNormalizedPath = normalizedMetadataReferenceTargetPathCache.get(targetPath);
    if (cachedNormalizedPath !== undefined) {
        return cachedNormalizedPath;
    }

    const normalizedPath = targetPath.replaceAll("\\", "/").toLowerCase();
    normalizedMetadataReferenceTargetPathCache.set(targetPath, normalizedPath);
    return normalizedPath;
}

function metadataReferenceTargetMatchesNormalizedPath(candidatePath: string, normalizedTargetPath: string): boolean {
    return normalizeMetadataReferenceTargetPath(candidatePath) === normalizedTargetPath;
}

function appendProjectMetadataStringMutation(
    stringMutations: Array<{ propertyPath: string; value: string }>,
    propertyPath: string,
    value: string
): void {
    const existingMutation = stringMutations.find((candidate) => candidate.propertyPath === propertyPath);
    if (existingMutation) {
        existingMutation.value = value;
        return;
    }

    stringMutations.push({
        propertyPath,
        value
    });
}

function updateRoomInstanceCreationOrderSelfPaths({
    parsed,
    normalizedOldResourcePath,
    newResourcePath,
    stringMutations
}: {
    parsed: Record<string, unknown>;
    normalizedOldResourcePath: string;
    newResourcePath: string;
    stringMutations: Array<{ propertyPath: string; value: string }>;
}): boolean {
    const instanceCreationOrder = parsed.instanceCreationOrder;
    if (!Array.isArray(instanceCreationOrder)) {
        return false;
    }

    let changed = false;
    for (const [index, orderEntry] of instanceCreationOrder.entries()) {
        if (!Core.isObjectLike(orderEntry)) {
            continue;
        }

        const orderEntryRecord = orderEntry as Record<string, unknown>;
        const currentPath = Core.getNonEmptyString(orderEntryRecord.path);
        if (!currentPath) {
            continue;
        }

        if (!metadataReferenceTargetMatchesNormalizedPath(currentPath, normalizedOldResourcePath)) {
            continue;
        }

        if (currentPath === newResourcePath) {
            continue;
        }

        orderEntryRecord.path = newResourcePath;
        appendProjectMetadataStringMutation(stringMutations, `instanceCreationOrder.${index}.path`, newResourcePath);
        changed = true;
    }

    return changed;
}

function requiresMetadataResourcePathOrderNormalization(rawContent: string): boolean {
    const resourceTypeIndex = rawContent.indexOf('"resourceType"');
    const resourcePathIndex = rawContent.indexOf('"resourcePath"');
    if (resourceTypeIndex === -1 || resourcePathIndex === -1) {
        return false;
    }

    return resourceTypeIndex > resourcePathIndex;
}

function getProjectResourceOrderPath(projectRoot: string): string {
    return `${path.basename(path.resolve(projectRoot))}.resource_order`;
}

/**
 * Semantic bridge that adapts @gmloop/semantic ProjectIndex to the refactor engine.
 */
export class GmlSemanticBridge {
    private readonly declarationKindsByEntry = new WeakMap<SemanticIdentifierEntry, ReadonlySet<string>>();
    private readonly localNamingCategoryResolver: ParsedLocalNamingCategoryResolver;
    private projectIndex: Record<string, unknown>;
    private projectRoot: string;
    private readonly parsedProjectMetadataByPath = new Map<string, Record<string, unknown>>();
    private readonly projectMetadataSourceByPath = new Map<string, string>();
    private readonly scriptCallableDeclarationsByEntry = new WeakMap<
        SemanticIdentifierEntry,
        ReadonlyArray<ScriptCallableDeclaration>
    >();
    private readonly stagedFileRenames: Array<{ newPath: string; oldPath: string }> = [];
    private readonly stagedMetadataContents = new Map<string, string>();
    private readonly stagedParsedMetadata = new Map<string, Record<string, unknown>>();
    private readonly stagedMetadataParseFailures = new Set<string>();
    private readonly generatedMetadataDocumentsByPath = new Map<
        string,
        { content: string; document: Record<string, unknown> }
    >();
    private readonly sourceTextByPath = new Map<string, string | null>();
    private readonly diskIdentifierOccurrenceIndexesByFilePath = new Map<string, GmlIdentifierOccurrenceIndex | null>();
    private diskOccurrencesBySymbolName: Map<string, Array<SymbolOccurrence>> | null = null;
    private constructorRuntimeTypeReferencesByExactName: Map<
        string,
        Array<Pick<SymbolOccurrence, "end" | "path" | "start">>
    > | null = null;
    private enumNames: ReadonlySet<string> | null = null;
    private scriptNames: ReadonlySet<string> | null = null;
    private macroNames: ReadonlySet<string> | null = null;
    private indexes: SemanticBridgeIndexes | null = null;
    private projectMetadataReferenceIndex: ProjectMetadataReferenceIndex | null = null;
    private macroBodyReferencesByExactName: Map<
        string,
        Array<Pick<SymbolOccurrence, "end" | "path" | "start">>
    > | null = null;
    private scriptResourceIndexes: ScriptResourceIndexes | null = null;
    private readonly localReferenceOccurrencesByFilePath = new Map<string, LocalReferenceIndex>();
    private readonly latestBatchMetadataDocumentsByEdit = new WeakMap<
        WorkspaceEdit,
        { documents: Map<string, Record<string, unknown>>; metadataObjectCount: number }
    >();
    private readonly mutableProjectMetadataDocumentsByEdit = new WeakMap<
        WorkspaceEdit,
        Map<string, MutableProjectMetadataDocument | null>
    >();

    private readFile: ((filePath: string) => Promise<string> | string) | null = null;

    constructor(
        projectIndex: unknown,
        projectRoot: string = process.cwd(),
        readFile?: ((filePath: string) => Promise<string> | string) | null
    ) {
        this.projectIndex = Core.isObjectLike(projectIndex) ? (projectIndex as Record<string, unknown>) : {};
        this.projectRoot = projectRoot;
        this.localNamingCategoryResolver = new ParsedLocalNamingCategoryResolver(projectRoot);
        if (readFile) {
            this.readFile = readFile;
        }
    }

    public setReadFile(readFile: (filePath: string) => Promise<string> | string): void {
        this.readFile = readFile;
    }

    /**
     * Update the underlying project index in place. Useful after codemod passes
     * when the engine updates the project tree to evaluate the next sequence.
     */
    updateProjectIndex(projectIndex: unknown): void {
        this.projectIndex = Core.isObjectLike(projectIndex) ? (projectIndex as Record<string, unknown>) : {};
        this.indexes = null;
        this.projectMetadataReferenceIndex = null;
        this.projectMetadataSourceByPath.clear();
        this.parsedProjectMetadataByPath.clear();
        this.sourceTextByPath.clear();
        this.diskIdentifierOccurrenceIndexesByFilePath.clear();
        this.diskOccurrencesBySymbolName = null;
        this.localReferenceOccurrencesByFilePath.clear();
        this.localNamingCategoryResolver.clear();
        this.constructorRuntimeTypeReferencesByExactName = null;
        this.enumNames = null;
        this.scriptNames = null;
        this.macroNames = null;
        this.macroBodyReferencesByExactName = null;
        this.scriptResourceIndexes = null;
        this.clearWorkspaceOverlay();
    }

    /**
     * Reset the staged workspace overlay used while composing batch rename plans.
     */
    clearWorkspaceOverlay(): void {
        this.stagedFileRenames.length = 0;
        this.stagedMetadataContents.clear();
        this.stagedParsedMetadata.clear();
        this.stagedMetadataParseFailures.clear();
        this.generatedMetadataDocumentsByPath.clear();
    }

    /**
     * Stage metadata rewrites from a planned workspace edit so subsequent rename
     * planning can build on the already-planned metadata state.
     */
    stageWorkspaceEdit(workspace: {
        fileRenames?: Array<{ newPath: string; oldPath: string }>;
        metadataEdits?: Array<{ content: string; path: string }>;
    }): void {
        if (Array.isArray(workspace.fileRenames)) {
            for (const fileRename of workspace.fileRenames) {
                if (typeof fileRename.oldPath !== "string" || typeof fileRename.newPath !== "string") {
                    continue;
                }

                this.stagedFileRenames.push({
                    oldPath: fileRename.oldPath,
                    newPath: fileRename.newPath
                });
            }
        }

        if (!Array.isArray(workspace.metadataEdits)) {
            return;
        }

        for (const metadataEdit of workspace.metadataEdits) {
            if (typeof metadataEdit.path !== "string" || typeof metadataEdit.content !== "string") {
                continue;
            }

            this.stagedMetadataContents.set(metadataEdit.path, metadataEdit.content);
            const generatedMetadataDocument = this.generatedMetadataDocumentsByPath.get(metadataEdit.path);
            if (generatedMetadataDocument?.content === metadataEdit.content) {
                this.stagedParsedMetadata.set(metadataEdit.path, generatedMetadataDocument.document);
            } else {
                this.stagedParsedMetadata.delete(metadataEdit.path);
            }
            this.stagedMetadataParseFailures.delete(metadataEdit.path);
        }
    }

    canPlanRenameBatchWithoutWorkspaceOverlay(renames: ReadonlyArray<{ newName: string; symbolId: string }>): boolean {
        return renames.every((rename) => rename.symbolId.startsWith("gml/script/"));
    }

    private getStagedParsedMetadata(metadataPath: string): Record<string, unknown> | null {
        const cachedParsedMetadata = this.stagedParsedMetadata.get(metadataPath);
        if (cachedParsedMetadata !== undefined) {
            return cachedParsedMetadata;
        }

        if (this.stagedMetadataParseFailures.has(metadataPath)) {
            return null;
        }

        const stagedMetadataContent = this.stagedMetadataContents.get(metadataPath);
        if (stagedMetadataContent === undefined) {
            return null;
        }

        try {
            const absolutePath = path.resolve(this.projectRoot, metadataPath);
            const parsed = Core.parseProjectMetadataDocumentForMutation(stagedMetadataContent, absolutePath).document;
            this.stagedParsedMetadata.set(metadataPath, parsed);
            return parsed;
        } catch {
            this.stagedMetadataParseFailures.add(metadataPath);
            return null;
        }
    }

    private resolveWorkspaceOverlayPath(candidatePath: string): string {
        let resolvedPath = candidatePath;

        for (const fileRename of this.stagedFileRenames) {
            if (resolvedPath === fileRename.oldPath) {
                resolvedPath = fileRename.newPath;
                continue;
            }

            if (!resolvedPath.startsWith(`${fileRename.oldPath}/`)) {
                continue;
            }

            resolvedPath = `${fileRename.newPath}${resolvedPath.slice(fileRename.oldPath.length)}`;
        }

        return resolvedPath;
    }

    private resolveWorkspaceSourcePath(candidatePath: string): string {
        let resolvedPath = candidatePath;

        for (let index = this.stagedFileRenames.length - 1; index >= 0; index -= 1) {
            const fileRename = this.stagedFileRenames[index];
            if (!fileRename) {
                continue;
            }

            if (resolvedPath === fileRename.newPath) {
                resolvedPath = fileRename.oldPath;
                continue;
            }

            if (!resolvedPath.startsWith(`${fileRename.newPath}/`)) {
                continue;
            }

            resolvedPath = `${fileRename.oldPath}${resolvedPath.slice(fileRename.newPath.length)}`;
        }

        return resolvedPath;
    }

    private doesWorkspaceFilePathExist(candidatePath: string): boolean {
        const absoluteCandidatePath = path.resolve(this.projectRoot, candidatePath);
        if (pathExistsSync(absoluteCandidatePath)) {
            return true;
        }

        const sourcePath = this.resolveWorkspaceSourcePath(candidatePath);
        if (sourcePath === candidatePath) {
            return false;
        }

        const absoluteSourcePath = path.resolve(this.projectRoot, sourcePath);
        return pathExistsSync(absoluteSourcePath);
    }

    /**
     * Check whether a directory path exists in the effective workspace view.
     * This considers both on-disk paths and staged rename overlays so batch
     * rename planning can treat already-staged destinations as existing.
     */
    private doesWorkspaceDirectoryPathExist(candidatePath: string): boolean {
        const absoluteCandidatePath = path.resolve(this.projectRoot, candidatePath);
        if (pathExistsSync(absoluteCandidatePath, (stat) => stat.isDirectory())) {
            return true;
        }

        const sourcePath = this.resolveWorkspaceSourcePath(candidatePath);
        if (sourcePath === candidatePath) {
            return false;
        }

        const absoluteSourcePath = path.resolve(this.projectRoot, sourcePath);
        return pathExistsSync(absoluteSourcePath, (stat) => stat.isDirectory());
    }

    private listWorkspaceDirectoryEntries(candidatePath: string): Array<string> {
        const absoluteCandidatePath = path.resolve(this.projectRoot, candidatePath);
        if (pathExistsSync(absoluteCandidatePath, (stat) => stat.isDirectory())) {
            return fs.readdirSync(absoluteCandidatePath);
        }

        const sourcePath = this.resolveWorkspaceSourcePath(candidatePath);
        if (sourcePath === candidatePath) {
            return [];
        }

        const absoluteSourcePath = path.resolve(this.projectRoot, sourcePath);
        if (!pathExistsSync(absoluteSourcePath, (stat) => stat.isDirectory())) {
            return [];
        }

        return fs.readdirSync(absoluteSourcePath);
    }

    /**
     * Get the resources map from the project index.
     */
    private get resources(): Record<string, SemanticResourceRecord> {
        return (this.projectIndex.resources ?? {}) as Record<string, SemanticResourceRecord>;
    }

    /**
     * Get the identifiers map, handling structural differences in the project index.
     */
    private get identifiers(): SemanticIdentifierCollections {
        return this.projectIndex.identifiers ?? this.projectIndex.identifierCollections ?? {};
    }

    private getIndexes(): SemanticBridgeIndexes {
        const existingIndexes = this.indexes;
        if (existingIndexes) {
            return existingIndexes;
        }

        const createdIndexes = this.buildIndexes();
        this.indexes = createdIndexes;
        return createdIndexes;
    }

    private buildIndexes(): SemanticBridgeIndexes {
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
                const entryScipId = this.generateScipId(entry);
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
                const declarationScipId = this.generateScipId(entry, declaration.name);
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
            const collection = this.identifiers[collectionName];
            if (!collection) {
                continue;
            }

            for (const entry of Object.values(collection)) {
                indexEntry(entry);
            }
        }

        for (const [resourcePath, resource] of Object.entries(this.resources)) {
            if (!Core.isNonEmptyString(resource?.name)) {
                continue;
            }

            const resourceScipId = this.generateResourceScipId(resource);
            resourcesByExactName.set(resource.name, resource);
            resourcesByLowerName.set(resource.name.toLowerCase(), resource);
            appendLookupEntry(resource.name);
            registerResolveSymbolId(resource.name, resourceScipId);

            if (!Core.isNonEmptyString(resource.path)) {
                resource.path = resourcePath;
            }
        }

        const relationships = this.projectIndex.relationships as
            | { scriptCalls?: Array<SemanticScriptCallRecord> }
            | undefined;
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

        for (const [filePath, fileRecord] of Object.entries(this.projectIndex.files ?? {})) {
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

    private getScriptResourceIndexes(): ScriptResourceIndexes {
        const existingIndexes = this.scriptResourceIndexes;
        if (existingIndexes !== null) {
            return existingIndexes;
        }

        const scriptCallableDeclarationsByResourcePath = new Map<string, Array<ScriptCallableDeclarationEntry>>();
        const scriptEntriesByResourcePath = new Map<string, Array<SemanticIdentifierEntry>>();

        for (const entry of Object.values(this.identifiers.scripts ?? {})) {
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

    /**
     * Check if a symbol exists in the project index.
     */
    hasSymbol(symbolId: string): boolean {
        return Boolean(this.findSymbolInCollections(symbolId));
    }

    /**
     * Try to find the most appropriate symbol ID for a given name.
     * Searches all collections and returns a SCIP-style symbol ID.
     */
    resolveSymbolId(name: string): string | null {
        const indexes = this.getIndexes();
        return indexes.exactResolveSymbolIds.get(name) ?? indexes.lowerResolveSymbolIds.get(name.toLowerCase()) ?? null;
    }

    /**
     * Find all occurrences of a symbol by its base name.
     */
    getSymbolOccurrences(symbolName: string, symbolId: string | null = null): Array<SymbolOccurrence> {
        const occurrences: Array<SymbolOccurrence> = [];
        const symbolEntry = Core.isNonEmptyString(symbolId) ? this.findSymbolInCollections(symbolId) : null;
        if (symbolEntry) {
            this.collectOccurrencesFromExactSymbolEntry(symbolEntry, symbolName, symbolId, occurrences);
        } else if (!this.isResourceSymbolId(symbolId)) {
            const candidateEntries = this.getIndexes().entriesByRelatedName.get(symbolName);
            if (candidateEntries) {
                for (const entry of candidateEntries) {
                    this.collectOccurrencesFromEntry(entry, symbolName, symbolId, occurrences);
                }
            }
        }

        // 2. Search through general relationships for any script calls that matched the name
        // but weren't resolved to a specific identifier entry (useful for modern GML functions)
        if (!this.isIndependentMultiFunctionScriptResourceSymbolId(symbolId)) {
            this.collectOccurrencesFromRelationships(symbolName, occurrences);
        }

        this.collectUnresolvedProjectFileReferenceOccurrences(symbolName, symbolId, occurrences);
        if (this.shouldCollectUnresolvedProjectFileReferences(symbolEntry, symbolId)) {
            this.collectMacroBodyReferenceOccurrences(symbolName, occurrences);
        }
        if (this.shouldCollectConstructorRuntimeTypeReferences(symbolEntry, symbolId)) {
            this.collectConstructorRuntimeTypeReferenceOccurrences(symbolName, occurrences);
        }

        // Fallback to file-system scanning for resource renames. Synthetic
        // resource declarations in `.yy` files count as occurrences, but they
        // are not enough to update cross-file code references such as
        // `instance_create_depth(..., oCamera)`. We always run this fallback
        // for resources because semantic index references can be incomplete.
        if (this.shouldCollectDiskOccurrences(symbolName, symbolId)) {
            this.collectOccurrencesFromGmlFiles(symbolName, occurrences);
        }

        return this.deduplicateOccurrences(this.normalizeSourceBackedGmlOccurrences(symbolName, occurrences));
    }

    checkSemanticGaps(symbolName: string, symbolKind?: string | null): Array<{ message: string; path?: string }> {
        const isGlobalSymbol =
            this.findResourceByName(symbolName) !== null ||
            this.getEnumNames().has(symbolName) ||
            this.getMacroNames().has(symbolName) ||
            this.getScriptNames().has(symbolName);

        if (isGlobalSymbol) {
            return [];
        }

        const NON_PROPERTY_SYMBOL_KINDS = new Set([
            "script",
            "scripts",
            "object",
            "objects",
            "sprite",
            "sprites",
            "sound",
            "sounds",
            "room",
            "rooms",
            "path",
            "paths",
            "curve",
            "curves",
            "sequence",
            "sequences",
            "shader",
            "shaders",
            "font",
            "fonts",
            "timeline",
            "timelines",
            "tileset",
            "tilesets",
            "particlesystem",
            "particlesystems",
            "note",
            "notes",
            "extension",
            "extensions",
            "macro",
            "enum",
            "enum-member"
        ]);

        const gaps: Array<{ message: string; path?: string }> = [];
        const candidates = this.collectSemanticGapReferenceCandidates(symbolName);

        for (const candidate of candidates) {
            if (candidate.isProperty && this.isKnownEnumMemberReference(candidate.filePath, candidate.start)) {
                continue;
            }

            if (
                this.isResolvedConstructorStaticMemberReference(
                    symbolName,
                    candidate.filePath,
                    candidate.start,
                    candidate.end
                )
            ) {
                continue;
            }

            if (candidate.isProperty && symbolKind && NON_PROPERTY_SYMBOL_KINDS.has(symbolKind)) {
                continue;
            }

            if (candidate.isProperty || candidate.isBareCall) {
                const typeLabel = candidate.isProperty ? "property access" : "bare call";
                gaps.push({
                    message: `Unresolved same-name ${typeLabel} '${symbolName}' in ${candidate.filePath} at position ${candidate.start}-${candidate.end}`,
                    path: candidate.filePath
                });
            }
        }

        return gaps;
    }

    private collectSemanticGapReferenceCandidates(symbolName: string): Array<SemanticGapReferenceCandidate> {
        const candidatesByKey = new Map<string, SemanticGapReferenceCandidate>();
        const addCandidate = (candidate: SemanticGapReferenceCandidate): void => {
            const key = `${candidate.filePath}:${candidate.start}:${candidate.end}`;
            const existingCandidate = candidatesByKey.get(key);
            if (existingCandidate === undefined) {
                candidatesByKey.set(key, candidate);
                return;
            }

            existingCandidate.isBareCall ||= candidate.isBareCall;
            existingCandidate.isProperty ||= candidate.isProperty;
            existingCandidate.reference ??= candidate.reference;
        };

        for (const candidate of this.collectIndexedSemanticGapReferenceCandidates(symbolName)) {
            addCandidate(candidate);
        }

        for (const candidate of this.collectSourceSemanticGapReferenceCandidates(symbolName)) {
            addCandidate(candidate);
        }

        return [...candidatesByKey.values()].sort(
            (left, right) =>
                left.filePath.localeCompare(right.filePath) || left.start - right.start || left.end - right.end
        );
    }

    private collectIndexedSemanticGapReferenceCandidates(symbolName: string): Array<SemanticGapReferenceCandidate> {
        const candidates: Array<SemanticGapReferenceCandidate> = [];

        for (const unresolvedReference of this.getIndexes().unresolvedReferencesByExactName.get(symbolName) ?? []) {
            const candidate = this.createIndexedSemanticGapReferenceCandidate(
                symbolName,
                unresolvedReference.filePath,
                unresolvedReference.reference
            );
            if (candidate !== null) {
                candidates.push(candidate);
            }
        }

        for (const [filePath, fileRecord] of Object.entries(this.projectIndex.files ?? {})) {
            const typedFileRecord = fileRecord as SemanticFileRecord;
            for (const reference of typedFileRecord.references ?? []) {
                if (!Core.isObjectLike(reference)) {
                    continue;
                }

                const referenceName = typeof reference.name === "string" ? reference.name : null;
                const targetName = typeof reference.targetName === "string" ? reference.targetName : null;
                if (referenceName !== symbolName && targetName !== symbolName) {
                    continue;
                }

                const candidate = this.createIndexedSemanticGapReferenceCandidate(symbolName, filePath, reference);
                if (candidate !== null) {
                    candidates.push(candidate);
                }
            }
        }

        return candidates;
    }

    private createIndexedSemanticGapReferenceCandidate(
        symbolName: string,
        filePath: string,
        reference: Record<string, unknown>
    ): SemanticGapReferenceCandidate | null {
        const start = readSemanticLocationIndex(reference.start);
        const end = readExclusiveSemanticLocationIndex(reference.end);
        if (start === null || end === null || end <= start) {
            return null;
        }

        const sourceText = this.readProjectSourceText(filePath);
        if (sourceText !== null && (end > sourceText.length || !isIdentifierTokenAt(sourceText, start, symbolName))) {
            return null;
        }

        const classifications = Core.asArray(reference.classifications);
        const isProperty = classifications.includes("property") || this.isPropertyReferenceSourceMatch(filePath, start);
        const isBareCall = this.isBareCallReferenceSourceMatch(filePath, start, end);

        if (!isProperty && !isBareCall) {
            return null;
        }

        return {
            filePath,
            isBareCall,
            isProperty,
            reference,
            start,
            end
        };
    }

    private collectSourceSemanticGapReferenceCandidates(symbolName: string): Array<SemanticGapReferenceCandidate> {
        const candidates: Array<SemanticGapReferenceCandidate> = [];

        for (const filePath of Object.keys(this.projectIndex.files ?? {})) {
            const sourceText = this.readProjectSourceText(filePath);
            if (sourceText === null) {
                continue;
            }

            this.collectSourceSemanticGapReferenceCandidatesFromFile({
                candidates,
                filePath,
                sourceText,
                symbolName
            });
        }

        return candidates;
    }

    private collectSourceSemanticGapReferenceCandidatesFromFile(parameters: {
        candidates: Array<SemanticGapReferenceCandidate>;
        filePath: string;
        sourceText: string;
        symbolName: string;
    }): void {
        const scanState = Core.createStringCommentScanState();
        const sourceLength = parameters.sourceText.length;
        let index = 0;

        while (index < sourceLength) {
            const scannedIndex = Core.advanceStringCommentScan(
                parameters.sourceText,
                sourceLength,
                index,
                scanState,
                true
            );
            if (scannedIndex !== index) {
                index = scannedIndex;
                continue;
            }

            if (!isIdentifierTokenAt(parameters.sourceText, index, parameters.symbolName)) {
                index += 1;
                continue;
            }

            const end = index + parameters.symbolName.length;
            const isProperty = this.isPropertyReferenceSourceMatch(parameters.filePath, index);
            const isBareCall = this.isBareCallReferenceSourceMatch(parameters.filePath, index, end);
            if (isProperty || isBareCall) {
                parameters.candidates.push({
                    filePath: parameters.filePath,
                    isBareCall,
                    isProperty,
                    reference: null,
                    start: index,
                    end
                });
            }

            index = end;
        }
    }

    private collectMacroBodyReferenceOccurrences(symbolName: string, occurrences: Array<SymbolOccurrence>): void {
        for (const reference of this.getMacroBodyReferencesByExactName().get(symbolName) ?? []) {
            occurrences.push({
                path: reference.path,
                start: reference.start,
                end: reference.end,
                kind: "reference"
            });
        }
    }

    private getMacroBodyReferencesByExactName(): Map<string, Array<Pick<SymbolOccurrence, "end" | "path" | "start">>> {
        if (this.macroBodyReferencesByExactName !== null) {
            return this.macroBodyReferencesByExactName;
        }

        const referencesByExactName = new Map<string, Array<Pick<SymbolOccurrence, "end" | "path" | "start">>>();

        for (const record of listMacroDeclarationReferenceRecords({
            macros: this.identifiers.macros ?? {},
            projectRoot: this.projectRoot
        })) {
            for (const reference of record.references) {
                const existingReferences = referencesByExactName.get(reference.name) ?? [];
                existingReferences.push({
                    path: record.path,
                    start: reference.start,
                    end: reference.end
                });
                referencesByExactName.set(reference.name, existingReferences);
            }
        }

        this.macroBodyReferencesByExactName = referencesByExactName;
        return referencesByExactName;
    }

    private collectConstructorRuntimeTypeReferenceOccurrences(
        symbolName: string,
        occurrences: Array<SymbolOccurrence>
    ): void {
        for (const reference of this.getConstructorRuntimeTypeReferencesByExactName().get(symbolName) ?? []) {
            occurrences.push({
                path: reference.path,
                start: reference.start,
                end: reference.end,
                kind: "reference"
            });
        }
    }

    private getConstructorRuntimeTypeReferencesByExactName(): Map<
        string,
        Array<Pick<SymbolOccurrence, "end" | "path" | "start">>
    > {
        if (this.constructorRuntimeTypeReferencesByExactName !== null) {
            return this.constructorRuntimeTypeReferencesByExactName;
        }

        const referencesByExactName = new Map<string, Array<Pick<SymbolOccurrence, "end" | "path" | "start">>>();

        for (const record of listConstructorRuntimeTypeReferenceRecords({
            files: (this.projectIndex.files ?? {}) as Record<string, SemanticFileRecord>,
            projectRoot: this.projectRoot
        })) {
            for (const reference of record.references) {
                const existingReferences = referencesByExactName.get(reference.name) ?? [];
                existingReferences.push({
                    path: record.path,
                    start: reference.start,
                    end: reference.end
                });
                referencesByExactName.set(reference.name, existingReferences);
            }
        }

        this.constructorRuntimeTypeReferencesByExactName = referencesByExactName;
        return referencesByExactName;
    }

    private collectOccurrencesFromExactSymbolEntry(
        entry: SemanticIdentifierEntry,
        symbolName: string,
        symbolId: string,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (symbolId.startsWith("gml/scripts/")) {
            const resource = this.findResourceBySymbol(entry, symbolId);
            if (resource?.resourceType === "GMScript") {
                const coupledDeclarations = this.getScriptCallableDeclarationsForResource(resource.path).filter(
                    ({ declaration }) => declaration.name === symbolName
                );

                if (coupledDeclarations.length === 1) {
                    const coupledDeclaration = coupledDeclarations[0];
                    const category = this.getScriptCallableNamingCategory(
                        coupledDeclaration.entry,
                        coupledDeclaration.declaration,
                        true,
                        this.extractDeclarationKinds(coupledDeclaration.entry)
                    );
                    if (category !== "constructorFunction" && category !== "structDeclaration") {
                        this.collectOccurrencesFromEntry(coupledDeclaration.entry, symbolName, symbolId, occurrences);
                    }
                }

                return;
            }
        }

        this.collectOccurrencesFromEntry(entry, symbolName, symbolId, occurrences);
    }

    private shouldCollectDiskOccurrences(symbolName: string, symbolId: string | null): boolean {
        if (!Core.isNonEmptyString(symbolName)) {
            return false;
        }

        if (this.isIndependentMultiFunctionScriptResourceSymbolId(symbolId)) {
            return false;
        }

        if (this.isResourceSymbolId(symbolId)) {
            const resource = this.findResourceByName(symbolId.slice(symbolId.lastIndexOf("/") + 1));
            return resource !== null && this.shouldResourceRenameCollectDiskOccurrences(resource);
        }

        const resource = this.findResourceByName(symbolName, true);
        if (resource === null) {
            return false;
        }

        return this.shouldResourceRenameCollectDiskOccurrences(resource);
    }

    private shouldCollectConstructorRuntimeTypeReferences(entry: unknown, symbolId: string | null): boolean {
        if (Core.isNonEmptyString(symbolId) && symbolId.startsWith("gml/scripts/")) {
            return false;
        }

        if (!Core.isObjectLike(entry)) {
            return false;
        }

        const declarationKinds = this.extractDeclarationKinds(entry);
        return declarationKinds.has("constructor") || declarationKinds.has("struct");
    }

    private shouldCollectUnresolvedProjectFileReferences(
        entry: unknown,
        symbolId: string
    ): entry is SemanticIdentifierEntry {
        if (!Core.isNonEmptyString(symbolId)) {
            return false;
        }

        if (!Core.isObjectLike(entry)) {
            if (
                symbolId.startsWith("gml/enum/") ||
                symbolId.startsWith("gml/macro/") ||
                symbolId.startsWith("gml/var/")
            ) {
                return true;
            }
            return false;
        }

        const typedEntry = entry as { identifierId?: unknown };

        if (symbolId.startsWith("gml/enum/") || symbolId.startsWith("gml/macro/") || symbolId.startsWith("gml/var/")) {
            return true;
        }

        return (
            typeof typedEntry.identifierId === "string" &&
            (typedEntry.identifierId.startsWith("enum:") ||
                typedEntry.identifierId.startsWith("macro:") ||
                typedEntry.identifierId.startsWith("instance:"))
        );
    }

    /**
     * Get additional edits (like file renames) for a symbol.
     */
    getAdditionalSymbolEdits(symbolId: string, newName: string): WorkspaceEdit | null {
        const entry = this.findSymbolInCollections(symbolId);
        if (!entry) return null;

        // Check if this is a resource rename (based on kind or path)
        const resource = this.findResourceBySymbol(entry, symbolId);
        if (!resource) return null;

        const edit = createWorkspaceEdit();
        const oldName = entry.name;
        const oldPath = resource.path;
        const currentResourcePath = this.resolveWorkspaceOverlayPath(oldPath);

        // Typical GM structure: objects/oPlayer/oPlayer.yy
        const resourceDir = path.posix.dirname(currentResourcePath);
        const resourceDirName = path.posix.basename(resourceDir);
        const parentDir = path.posix.dirname(resourceDir);
        const shouldRenameResourceDirectory = resourceDirName === oldName;
        const renamedResourceDirectoryPath = path.posix.join(parentDir, newName);
        const destinationDirectoryExists =
            shouldRenameResourceDirectory && this.doesWorkspaceDirectoryPathExist(renamedResourceDirectoryPath);
        const fileRenameDestinationDir = destinationDirectoryExists ? renamedResourceDirectoryPath : resourceDir;
        const resourceMetadataDocument = this.loadResourceMetadataDocumentForRename(currentResourcePath);

        // 1. Rename files inside the directory that match the old name.
        // We do this BEFORE renaming the directory because GameMaker assets keep
        // the file basename in sync with the enclosing folder name (e.g., `obj.yy`
        // lives under `objects/obj/`). If we rename the folder first, subsequent
        // file renames would resolve against a path that no longer exists, and
        // we risk emitting a WorkspaceEdit that can't be applied cleanly. Keeping
        // the on-disk paths stable until the inner files are updated prevents
        // partial refactors and aligns with the refactor flow described in
        // docs/hot-reload.md (see the refactor pipeline section).
        const extensionsToRename = [".yy"];
        if (resource.resourceType === "GMScript") {
            extensionsToRename.push(".gml");
        } else if (resource.resourceType === "GMShader") {
            extensionsToRename.push(".fsh", ".vsh");
        }

        const primaryRenamedPaths: Array<string> = [];
        for (const ext of extensionsToRename) {
            const oldFilePath = ext === ".yy" ? currentResourcePath : path.posix.join(resourceDir, `${oldName}${ext}`);
            const newFilePath = path.posix.join(fileRenameDestinationDir, `${newName}${ext}`);
            primaryRenamedPaths.push(oldFilePath);

            // Later batch plans may target a path introduced by an earlier staged
            // folder rename. Accept either the current staged destination or the
            // corresponding on-disk source path that will become that destination.
            if (this.doesWorkspaceFilePathExist(oldFilePath) && oldFilePath !== newFilePath) {
                edit.addFileRename(oldFilePath, newFilePath);
            }
        }

        for (const sidecarRename of collectResourceSidecarRenames({
            resourceType: resource.resourceType,
            metadataDocument: resourceMetadataDocument,
            currentResourcePath,
            oldName,
            newName,
            fileRenameDestinationDir,
            primaryRenamedPaths,
            doesWorkspaceFilePathExist: (candidatePath) => this.doesWorkspaceFilePathExist(candidatePath),
            doesWorkspaceDirectoryPathExist: (candidatePath) => this.doesWorkspaceDirectoryPathExist(candidatePath),
            listWorkspaceDirectoryEntries: (candidatePath) => this.listWorkspaceDirectoryEntries(candidatePath)
        })) {
            edit.addFileRename(sidecarRename.oldPath, sidecarRename.newPath);
        }

        // 2. Rename the directory itself if it matches the resource name.
        if (shouldRenameResourceDirectory && !destinationDirectoryExists) {
            edit.addFileRename(resourceDir, renamedResourceDirectoryPath);
        }

        this.addResourceMetadataEdits(edit, resource, oldName, newName, currentResourcePath);

        return edit;
    }

    private getProjectMetadataReferenceIndex(): ProjectMetadataReferenceIndex {
        const existingIndex = this.projectMetadataReferenceIndex;
        if (existingIndex !== null) {
            return existingIndex;
        }

        const manifestMetadataRecords: Array<ResourceMetadataRecord> = [];
        const metadataRecordsByPath = new Map<string, ResourceMetadataRecord>();
        const referencingMetadataRecordsByLowerTargetPath = new Map<string, Array<ResourceMetadataRecord>>();
        const referencingMetadataRecordsByTargetPath = new Map<string, Array<ResourceMetadataRecord>>();

        for (const resourceRecord of Object.values(this.resources)) {
            const metadataRecord = normalizeResourceMetadataRecord(resourceRecord);
            if (metadataRecord === null) {
                continue;
            }

            metadataRecordsByPath.set(metadataRecord.path, metadataRecord);
            if (Semantic.isProjectManifestPath(metadataRecord.path)) {
                manifestMetadataRecords.push(metadataRecord);
            }

            for (const assetReference of metadataRecord.assetReferences) {
                const referencedMetadataRecords =
                    referencingMetadataRecordsByTargetPath.get(assetReference.targetPath) ?? [];
                referencedMetadataRecords.push(metadataRecord);
                referencingMetadataRecordsByTargetPath.set(assetReference.targetPath, referencedMetadataRecords);

                const lowerTargetPath = normalizeMetadataReferenceTargetPath(assetReference.targetPath);
                const lowerReferencedMetadataRecords =
                    referencingMetadataRecordsByLowerTargetPath.get(lowerTargetPath) ?? [];
                lowerReferencedMetadataRecords.push(metadataRecord);
                referencingMetadataRecordsByLowerTargetPath.set(lowerTargetPath, lowerReferencedMetadataRecords);
            }
        }

        const createdIndex = {
            manifestMetadataRecords,
            metadataRecordsByPath,
            referencingMetadataRecordsByLowerTargetPath,
            referencingMetadataRecordsByTargetPath
        };
        this.projectMetadataReferenceIndex = createdIndex;
        return createdIndex;
    }

    private loadResourceMetadataDocumentForRename(resourcePath: string): Record<string, unknown> {
        const existingDocument = this.parsedProjectMetadataByPath.get(resourcePath);
        if (existingDocument !== undefined) {
            return existingDocument;
        }

        const absolutePath = path.resolve(this.projectRoot, resourcePath);
        if (!pathExistsSync(absolutePath)) {
            return {};
        }

        try {
            const rawContent = fs.readFileSync(absolutePath, "utf8");
            const parsed = Core.parseProjectMetadataDocumentForMutation(rawContent, absolutePath).document;
            this.projectMetadataSourceByPath.set(resourcePath, rawContent);
            this.parsedProjectMetadataByPath.set(resourcePath, parsed);
            return parsed;
        } catch {
            return {};
        }
    }

    private listResourceMetadataMutationCandidates(resourcePath: string): Array<ResourceMetadataRecord> {
        const {
            manifestMetadataRecords,
            metadataRecordsByPath,
            referencingMetadataRecordsByLowerTargetPath,
            referencingMetadataRecordsByTargetPath
        } = this.getProjectMetadataReferenceIndex();
        const candidatesByPath = new Map<string, ResourceMetadataRecord>();

        const directMetadataRecord = metadataRecordsByPath.get(resourcePath);
        if (directMetadataRecord) {
            candidatesByPath.set(directMetadataRecord.path, directMetadataRecord);
        }

        for (const manifestMetadataRecord of manifestMetadataRecords) {
            candidatesByPath.set(manifestMetadataRecord.path, manifestMetadataRecord);
        }

        for (const referencingMetadataRecord of referencingMetadataRecordsByTargetPath.get(resourcePath) ?? []) {
            candidatesByPath.set(referencingMetadataRecord.path, referencingMetadataRecord);
        }

        const lowerResourcePath = normalizeMetadataReferenceTargetPath(resourcePath);
        for (const referencingMetadataRecord of referencingMetadataRecordsByLowerTargetPath.get(lowerResourcePath) ??
            []) {
            candidatesByPath.set(referencingMetadataRecord.path, referencingMetadataRecord);
        }

        return [...candidatesByPath.values()];
    }

    private collectLatestBatchMetadataDocuments(edit: WorkspaceEdit): Map<string, Record<string, unknown>> {
        const metadataObjectCount = edit.metadataObjects?.length ?? 0;
        const cachedEntry = this.latestBatchMetadataDocumentsByEdit.get(edit);
        if (cachedEntry && cachedEntry.metadataObjectCount === metadataObjectCount) {
            return cachedEntry.documents;
        }

        const latestBatchMetadataDocuments = new Map<string, Record<string, unknown>>();

        for (const metadataObject of edit.metadataObjects ?? []) {
            latestBatchMetadataDocuments.set(metadataObject.path, metadataObject.document);
        }

        this.latestBatchMetadataDocumentsByEdit.set(edit, {
            documents: latestBatchMetadataDocuments,
            metadataObjectCount
        });
        return latestBatchMetadataDocuments;
    }

    private loadMutableProjectMetadataDocument(
        edit: WorkspaceEdit,
        metadataPath: string,
        latestBatchMetadataDocuments: ReadonlyMap<string, Record<string, unknown>>
    ): MutableProjectMetadataDocument | null {
        const cachedMutableDocuments = this.mutableProjectMetadataDocumentsByEdit.get(edit);
        if (cachedMutableDocuments) {
            const cachedDocument = cachedMutableDocuments.get(metadataPath);
            if (cachedDocument !== undefined) {
                return cachedDocument;
            }
        }
        const mutableDocumentsByPath =
            cachedMutableDocuments ?? new Map<string, MutableProjectMetadataDocument | null>();

        const latestBatchMetadataDocument = latestBatchMetadataDocuments.get(metadataPath);
        if (latestBatchMetadataDocument !== undefined) {
            const loadedDocument: MutableProjectMetadataDocument = {
                parsed: structuredClone(latestBatchMetadataDocument),
                rawContent: Core.stringifyProjectMetadataDocument(latestBatchMetadataDocument, metadataPath)
            };
            mutableDocumentsByPath.set(metadataPath, loadedDocument);
            this.mutableProjectMetadataDocumentsByEdit.set(edit, mutableDocumentsByPath);
            return loadedDocument;
        }

        const stagedParsedMetadata = this.getStagedParsedMetadata(metadataPath);
        if (stagedParsedMetadata !== null) {
            const loadedDocument: MutableProjectMetadataDocument = {
                parsed: structuredClone(stagedParsedMetadata),
                rawContent:
                    this.stagedMetadataContents.get(metadataPath) ??
                    Core.stringifyProjectMetadataDocument(stagedParsedMetadata, metadataPath)
            };
            mutableDocumentsByPath.set(metadataPath, loadedDocument);
            this.mutableProjectMetadataDocumentsByEdit.set(edit, mutableDocumentsByPath);
            return loadedDocument;
        }

        const cachedParsedMetadata = this.parsedProjectMetadataByPath.get(metadataPath);
        const cachedSourceText = this.projectMetadataSourceByPath.get(metadataPath);
        if (cachedParsedMetadata !== undefined && cachedSourceText !== undefined) {
            const loadedDocument: MutableProjectMetadataDocument = {
                parsed: structuredClone(cachedParsedMetadata),
                rawContent: cachedSourceText
            };
            mutableDocumentsByPath.set(metadataPath, loadedDocument);
            this.mutableProjectMetadataDocumentsByEdit.set(edit, mutableDocumentsByPath);
            return loadedDocument;
        }

        const absolutePath = path.resolve(this.projectRoot, metadataPath);
        if (!pathExistsSync(absolutePath)) {
            mutableDocumentsByPath.set(metadataPath, null);
            this.mutableProjectMetadataDocumentsByEdit.set(edit, mutableDocumentsByPath);
            return null;
        }

        try {
            const rawContent = fs.readFileSync(absolutePath, "utf8");
            const parsed = Core.parseProjectMetadataDocumentForMutation(rawContent, absolutePath).document;
            this.projectMetadataSourceByPath.set(metadataPath, rawContent);
            this.parsedProjectMetadataByPath.set(metadataPath, parsed);
            const loadedDocument: MutableProjectMetadataDocument = {
                parsed: structuredClone(parsed),
                rawContent
            };
            mutableDocumentsByPath.set(metadataPath, loadedDocument);
            this.mutableProjectMetadataDocumentsByEdit.set(edit, mutableDocumentsByPath);
            return loadedDocument;
        } catch {
            mutableDocumentsByPath.set(metadataPath, null);
            this.mutableProjectMetadataDocumentsByEdit.set(edit, mutableDocumentsByPath);
            return null;
        }
    }

    private addResourceMetadataEdits(
        edit: WorkspaceEdit,
        resource: SemanticResourceRecord,
        oldName: string,
        newName: string,
        currentResourcePath: string
    ): void {
        const resources = this.resources;
        if (!resources || !resource?.path) {
            return;
        }
        const normalizedResourcePath = normalizeMetadataReferenceTargetPath(resource.path);

        const resourceDirName = path.posix.basename(path.posix.dirname(currentResourcePath));
        const newResourceDir =
            resourceDirName === oldName
                ? path.posix.join(path.posix.dirname(path.posix.dirname(currentResourcePath)), newName)
                : path.posix.dirname(currentResourcePath);
        const newResourcePath = path.posix.join(newResourceDir, `${newName}.yy`);
        const latestBatchMetadataDocuments = this.collectLatestBatchMetadataDocuments(edit);

        for (const resourceEntry of this.listResourceMetadataMutationCandidates(resource.path)) {
            const loadedMetadataDocument = this.loadMutableProjectMetadataDocument(
                edit,
                resourceEntry.path,
                latestBatchMetadataDocuments
            );
            if (loadedMetadataDocument === null) {
                continue;
            }

            const { parsed, rawContent } = loadedMetadataDocument;
            const oldResourcePathLiteral = JSON.stringify(currentResourcePath);
            const newResourcePathLiteral = JSON.stringify(newResourcePath);
            const shouldApplyRawResourcePathFallback = oldResourcePathLiteral !== newResourcePathLiteral;

            let changed = false;
            const stringMutations: Array<{ propertyPath: string; value: string }> = [];

            if (resourceEntry.path === resource.path) {
                if (typeof parsed["%Name"] === "string" && parsed["%Name"] !== newName) {
                    parsed["%Name"] = newName;
                    appendProjectMetadataStringMutation(stringMutations, "%Name", newName);
                    changed = true;
                }

                if (parsed.name !== newName) {
                    parsed.name = newName;
                    appendProjectMetadataStringMutation(stringMutations, "name", newName);
                    changed = true;
                }

                if (Object.hasOwn(parsed, "resourcePath")) {
                    const parsedResourcePath = typeof parsed.resourcePath === "string" ? parsed.resourcePath : null;
                    if (parsedResourcePath !== newResourcePath) {
                        parsed.resourcePath = newResourcePath;
                        appendProjectMetadataStringMutation(stringMutations, "resourcePath", newResourcePath);
                        changed = true;
                    }
                }

                changed =
                    this.updateResourceSoundFileMetadata(
                        parsed,
                        resource.resourceType,
                        oldName,
                        newName,
                        stringMutations
                    ) || changed;

                const roomInstanceCreationOrderUpdated = updateRoomInstanceCreationOrderSelfPaths({
                    parsed,
                    normalizedOldResourcePath: normalizeMetadataReferenceTargetPath(currentResourcePath),
                    newResourcePath,
                    stringMutations
                });
                if (roomInstanceCreationOrderUpdated) {
                    changed = true;
                }
            }

            // Ensure project manifest entries are updated directly in addition to
            // transform-by-asset-reference, in case the asset reference map is stale or
            // misses this resource path. This prevents stale old entries from remaining
            // in the resources list and causing GameMaker to crash on load.
            if (Semantic.isProjectManifestPath(resourceEntry.path) && Array.isArray(parsed.resources)) {
                for (const [resourceIndex, manifestEntry] of parsed.resources.entries()) {
                    if (!Core.isObjectLike(manifestEntry)) {
                        continue;
                    }

                    const idNode = manifestEntry.id;
                    if (!Core.isObjectLike(idNode)) {
                        continue;
                    }

                    const entryPath = typeof idNode.path === "string" ? idNode.path : null;
                    if (
                        !Core.isNonEmptyString(entryPath) ||
                        !metadataReferenceTargetMatchesNormalizedPath(entryPath, normalizedResourcePath)
                    ) {
                        continue;
                    }

                    if (idNode.name !== newName) {
                        idNode.name = newName;
                        appendProjectMetadataStringMutation(
                            stringMutations,
                            `resources.${resourceIndex}.id.name`,
                            newName
                        );
                        changed = true;
                    }

                    if (entryPath !== newResourcePath) {
                        idNode.path = newResourcePath;
                        appendProjectMetadataStringMutation(
                            stringMutations,
                            `resources.${resourceIndex}.id.path`,
                            newResourcePath
                        );
                        changed = true;
                    }
                }
            }

            for (const reference of resourceEntry.assetReferences) {
                if (!metadataReferenceTargetMatchesNormalizedPath(reference.targetPath, normalizedResourcePath)) {
                    continue;
                }

                // Skip secondary index-based mutations on the .yyp `resources` array.
                // The path-matching loop above is the authoritative update path: it finds
                // each matching entry by scanning for matching `id.path` values and
                // mutates `id.name` / `id.path` directly on the parsed object. Those
                // mutations are then recorded as string mutations and applied to the raw
                // text so the final output stays consistent.  By contrast, the
                // asset-reference map may contain stale index-based paths such as
                // `resources.N.name` that point to the same logical entry. Applying
                // both updates would write the same fields twice and risk the string
                // mutation list getting out of sync with the already-mutated parsed
                // object, producing a corrupted .yyp.  Skipping here keeps the two
                // update mechanisms from colliding.
                if (
                    Semantic.isProjectManifestPath(resourceEntry.path) &&
                    reference.propertyPath.startsWith("resources.")
                ) {
                    continue;
                }

                const existingValue = Core.getProjectMetadataValueAtPath(parsed, reference.propertyPath);
                const existingReferenceName = Core.isObjectLike(existingValue)
                    ? Core.getNonEmptyString((existingValue as Record<string, unknown>).name)
                    : null;
                const replacementReferenceName =
                    existingReferenceName && existingReferenceName === oldName ? newName : null;
                const updated = Core.updateProjectMetadataReferenceByPath({
                    document: parsed,
                    propertyPath: reference.propertyPath,
                    newResourcePath,
                    newName: replacementReferenceName
                });
                if (updated) {
                    if (Core.isObjectLike(existingValue)) {
                        appendProjectMetadataStringMutation(
                            stringMutations,
                            `${reference.propertyPath}.path`,
                            newResourcePath
                        );
                        if (replacementReferenceName) {
                            appendProjectMetadataStringMutation(
                                stringMutations,
                                `${reference.propertyPath}.name`,
                                replacementReferenceName
                            );
                        }
                    } else if (typeof existingValue === "string") {
                        appendProjectMetadataStringMutation(stringMutations, reference.propertyPath, newResourcePath);
                    }

                    changed = true;
                }
            }
            // Guard the expensive whole-document fallback scan behind the
            // "no structured changes" branch. In the common rename path we
            // already mutated parsed fields above, so scanning the full raw
            // metadata text for every candidate (especially MyGame.yyp) is
            // redundant and dominates runtime on large projects.
            if (!changed && (!shouldApplyRawResourcePathFallback || !rawContent.includes(oldResourcePathLiteral))) {
                continue;
            }

            const shouldNormalizeResourcePathOrdering = requiresMetadataResourcePathOrderNormalization(rawContent);
            let canonicalContent = shouldNormalizeResourcePathOrdering
                ? Core.stringifyProjectMetadataDocument(parsed, resourceEntry.path)
                : (Core.applyProjectMetadataStringMutations(rawContent, stringMutations) ??
                  Core.stringifyProjectMetadataDocument(parsed, resourceEntry.path));
            if (
                shouldApplyRawResourcePathFallback &&
                !shouldNormalizeResourcePathOrdering &&
                canonicalContent.includes(oldResourcePathLiteral)
            ) {
                canonicalContent = canonicalContent.replaceAll(oldResourcePathLiteral, newResourcePathLiteral);
            }

            if (canonicalContent === rawContent) {
                continue;
            }

            edit.addMetadataEdit(resourceEntry.path, canonicalContent);
            this.generatedMetadataDocumentsByPath.set(resourceEntry.path, {
                content: canonicalContent,
                document: parsed
            });
            if (edit.addMetadataObjectEdit) {
                edit.addMetadataObjectEdit(resourceEntry.path, parsed);
            }
            loadedMetadataDocument.rawContent = canonicalContent;
        }

        this.addResourceOrderMetadataEdit(edit, resource, newName, newResourcePath, latestBatchMetadataDocuments);
    }

    private updateResourceSoundFileMetadata(
        parsed: Record<string, unknown>,
        resourceType: string | undefined,
        oldName: string,
        newName: string,
        stringMutations: Array<{ propertyPath: string; value: string }>
    ): boolean {
        if (resourceType !== "GMSound") {
            return false;
        }

        const currentSoundFile = Core.getNonEmptyString(parsed.soundFile);
        const renamedSoundFile = resolveRenamedSoundFileName(currentSoundFile, newName);
        if (!renamedSoundFile || currentSoundFile === renamedSoundFile) {
            return false;
        }

        parsed.soundFile = renamedSoundFile;
        appendProjectMetadataStringMutation(stringMutations, "soundFile", renamedSoundFile);
        return true;
    }

    private addResourceOrderMetadataEdit(
        edit: WorkspaceEdit,
        resource: SemanticResourceRecord,
        newName: string,
        newResourcePath: string,
        latestBatchMetadataDocuments: ReadonlyMap<string, Record<string, unknown>>
    ): void {
        const normalizedResourcePath = normalizeMetadataReferenceTargetPath(resource.path ?? "");
        const resourceOrderPath = getProjectResourceOrderPath(this.projectRoot);
        const loadedMetadataDocument = this.loadMutableProjectMetadataDocument(
            edit,
            resourceOrderPath,
            latestBatchMetadataDocuments
        );
        if (loadedMetadataDocument === null) {
            return;
        }

        const { parsed, rawContent } = loadedMetadataDocument;
        const resourceOrderSettings = parsed.ResourceOrderSettings;
        if (!Array.isArray(resourceOrderSettings)) {
            return;
        }

        let changed = false;
        const stringMutations: Array<{ propertyPath: string; value: string }> = [];

        for (const [resourceOrderIndex, resourceOrderEntry] of resourceOrderSettings.entries()) {
            if (!Core.isObjectLike(resourceOrderEntry)) {
                continue;
            }

            const entryPath = typeof resourceOrderEntry.path === "string" ? resourceOrderEntry.path : null;
            if (
                !Core.isNonEmptyString(entryPath) ||
                !metadataReferenceTargetMatchesNormalizedPath(entryPath, normalizedResourcePath)
            ) {
                continue;
            }

            if (resourceOrderEntry.name !== newName) {
                resourceOrderEntry.name = newName;
                appendProjectMetadataStringMutation(
                    stringMutations,
                    `ResourceOrderSettings.${resourceOrderIndex}.name`,
                    newName
                );
                changed = true;
            }

            if (entryPath !== newResourcePath) {
                resourceOrderEntry.path = newResourcePath;
                appendProjectMetadataStringMutation(
                    stringMutations,
                    `ResourceOrderSettings.${resourceOrderIndex}.path`,
                    newResourcePath
                );
                changed = true;
            }
        }

        if (!changed) {
            return;
        }

        const canonicalContent =
            Core.applyProjectMetadataStringMutations(rawContent, stringMutations) ??
            Core.stringifyProjectMetadataDocument(parsed, resourceOrderPath);

        if (canonicalContent === rawContent) {
            return;
        }

        edit.addMetadataEdit(resourceOrderPath, canonicalContent);
        this.generatedMetadataDocumentsByPath.set(resourceOrderPath, {
            content: canonicalContent,
            document: parsed
        });
        if (edit.addMetadataObjectEdit) {
            edit.addMetadataObjectEdit(resourceOrderPath, parsed);
        }
        loadedMetadataDocument.rawContent = canonicalContent;
    }

    private findResourceBySymbol(entry: any, symbolId: string): any {
        const match = symbolId.match(/^gml\/([^/]+)\/(.+)$/);
        if (!match) {
            return null;
        }

        const kind = match[1];
        const name = match[2];
        if (
            ![
                "objects",
                "sprites",
                "sounds",
                "rooms",
                "paths",
                "curves",
                "sequences",
                "scripts",
                "shaders",
                "fonts",
                "timelines",
                "tilesets",
                "particlesystems",
                "notes",
                "extensions"
            ].includes(kind)
        ) {
            return null;
        }

        if (entry.resourcePath) {
            const resource = this.resources[entry.resourcePath];
            if (resource) {
                return resource;
            }
        }

        return this.findResourceByName(name);
    }

    private collectOccurrencesFromGmlFiles(symbolName: string, occurrences: Array<SymbolOccurrence>): void {
        const diskOccurrencesBySymbolName = this.getDiskOccurrencesBySymbolName();
        if (diskOccurrencesBySymbolName === null) {
            return;
        }

        occurrences.push(...(diskOccurrencesBySymbolName.get(symbolName) ?? []));
    }

    private getDiskOccurrencesBySymbolName(): Map<string, Array<SymbolOccurrence>> | null {
        if (this.diskOccurrencesBySymbolName !== null) {
            return this.diskOccurrencesBySymbolName;
        }

        const files = this.projectIndex.files;
        if (!Core.isObjectLike(files)) {
            return null;
        }

        const diskOccurrencesBySymbolName = new Map<string, Array<SymbolOccurrence>>();
        for (const filePath of Object.keys(files)) {
            if (!filePath.endsWith(".gml")) {
                continue;
            }

            this.appendDiskOccurrencesForFile(filePath, diskOccurrencesBySymbolName);
        }

        this.diskOccurrencesBySymbolName = diskOccurrencesBySymbolName;
        return diskOccurrencesBySymbolName;
    }

    private appendDiskOccurrencesForFile(
        filePath: string,
        diskOccurrencesBySymbolName: Map<string, Array<SymbolOccurrence>>
    ): void {
        const identifierOccurrenceIndex = this.getDiskIdentifierOccurrenceIndex(filePath);
        if (identifierOccurrenceIndex === null) {
            return;
        }

        identifierOccurrenceIndex.forEachOccurrencesByIdentifierName((identifierName, hits) => {
            if (hits.length === 0) {
                return;
            }

            const occurrencesForName = diskOccurrencesBySymbolName.get(identifierName) ?? [];
            for (const hit of hits) {
                occurrencesForName.push({
                    path: filePath,
                    start: hit.start,
                    end: hit.end,
                    kind: "reference"
                });
            }

            diskOccurrencesBySymbolName.set(identifierName, occurrencesForName);
        });
    }

    private getDiskIdentifierOccurrenceIndex(filePath: string): GmlIdentifierOccurrenceIndex | null {
        if (this.diskIdentifierOccurrenceIndexesByFilePath.has(filePath)) {
            return this.diskIdentifierOccurrenceIndexesByFilePath.get(filePath) ?? null;
        }

        try {
            const absolutePath = path.resolve(this.projectRoot, filePath);
            if (!pathExistsSync(absolutePath)) {
                this.diskIdentifierOccurrenceIndexesByFilePath.set(filePath, null);
                return null;
            }
            const content = fs.readFileSync(absolutePath, "utf8");
            const index = GmlIdentifierOccurrenceIndex.fromSourceText(content);
            this.diskIdentifierOccurrenceIndexesByFilePath.set(filePath, index);
            return index;
        } catch {
            this.diskIdentifierOccurrenceIndexesByFilePath.set(filePath, null);
            return null;
        }
    }

    /**
     * Collect occurrences from an entry.
     */
    private collectOccurrencesFromEntry(
        entry: any,
        symbolName: string,
        symbolId: string | null,
        occurrences: Array<SymbolOccurrence>
    ): void {
        const skipEntryOccurrences = this.isIndependentMultiFunctionScriptResourceSymbol(entry, symbolId);
        if (skipEntryOccurrences) {
            return;
        }

        // Case A: The entry contains declaration(s) matching the target name.
        // This takes priority over the entry-level name so multi-function script
        // entries can rename individual declarations independently.
        let matchedDeclaration = false;
        if (Array.isArray(entry.declarations)) {
            for (const decl of entry.declarations) {
                if (decl.name === symbolName) {
                    matchedDeclaration = true;
                    const end = resolveOccurrenceEndIndex(decl.end?.index);
                    if (end === null) {
                        continue;
                    }

                    occurrences.push({
                        path: decl.filePath,
                        start: decl.start?.index ?? 0,
                        end,
                        scopeId: decl.scopeId,
                        kind: "definition"
                    });
                }
            }
        }

        if (matchedDeclaration) {
            if (Array.isArray(entry.references)) {
                for (const ref of entry.references) {
                    if (ref.targetName !== symbolName && ref.name !== symbolName) {
                        continue;
                    }

                    this.collectEntryReferenceOccurrence(entry, ref, occurrences);
                }
            }

            this.collectSelfMemberInstanceVariableOccurrences(entry, symbolName, occurrences);
            this.collectUnresolvedEnumMemberOccurrences(entry, occurrences);
            this.collectEnumMemberMetadataOccurrences(entry, occurrences);
            return;
        }
        // Case B: The entry name itself matches (e.g. macro name, enum name, or script resource name)
        if (entry.name === symbolName) {
            this.collectAllFromEntry(entry, occurrences);
            this.collectSelfMemberInstanceVariableOccurrences(entry, symbolName, occurrences);
            return;
        }

        // Case C: The entry has references that match the target name.
        if (Array.isArray(entry.references)) {
            for (const ref of entry.references) {
                if (ref.targetName === symbolName) {
                    this.collectEntryReferenceOccurrence(entry, ref, occurrences);
                }
            }
        }
    }

    private collectEntryReferenceOccurrence(
        entry: SemanticIdentifierEntry,
        ref: SemanticEntryReferenceRecord,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (
            entry.identifierId?.startsWith("enum-member:") !== true ||
            !Core.isNonEmptyString(entry.name) ||
            !Core.isNonEmptyString(entry.enumName)
        ) {
            pushEntryReferenceOccurrence(ref, occurrences);
            return;
        }

        const start = ref.start?.index ?? ref.location?.start?.index ?? 0;
        const end = resolveOccurrenceEndIndex(ref.end?.index ?? ref.location?.end?.index);
        const filePath = typeof ref.filePath === "string" ? ref.filePath : "";
        if (!Core.isNonEmptyString(filePath) || end === null || end <= start) {
            return;
        }

        const exactRange = this.resolveEnumMemberReferenceRange({
            filePath,
            startIndex: start,
            endIndex: end,
            enumName: entry.enumName,
            memberName: entry.name
        });
        if (exactRange === null) {
            return;
        }

        occurrences.push({
            path: filePath,
            start: exactRange.start,
            end: exactRange.end,
            scopeId: typeof ref.scopeId === "string" ? ref.scopeId : undefined,
            kind: "reference"
        });
    }

    /**
     * Collect occurrences from project relationships (script calls).
     */
    private collectOccurrencesFromRelationships(symbolName: string, occurrences: Array<SymbolOccurrence>): void {
        for (const call of this.getIndexes().scriptCallsByTargetName.get(symbolName) ?? []) {
            const start = call.location?.start?.index ?? 0;
            const end = resolveOccurrenceEndIndex(call.location?.end?.index);
            const filePath = call.from?.filePath ?? "";

            if (!Core.isNonEmptyString(filePath) || end === null || end <= start) {
                continue;
            }

            occurrences.push({
                path: filePath,
                start,
                end,
                scopeId: call.from?.scopeId,
                kind: "reference"
            });
        }
    }

    private collectUnresolvedProjectFileReferenceOccurrences(
        symbolName: string,
        symbolId: string | null,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (!Core.isNonEmptyString(symbolId) || !Core.isNonEmptyString(symbolName)) {
            return;
        }

        const symbolEntry = this.findSymbolInCollections(symbolId);
        if (!this.shouldCollectUnresolvedProjectFileReferences(symbolEntry, symbolId)) {
            return;
        }

        for (const unresolvedReference of this.getIndexes().unresolvedReferencesByExactName.get(symbolName) ?? []) {
            const typedReference = unresolvedReference.reference as {
                classifications?: Array<unknown>;
                end?: { index?: number };
                location?: { end?: { index?: number }; start?: { index?: number } };
                scopeId?: unknown;
                start?: { index?: number };
            };
            const start = typedReference.start?.index ?? typedReference.location?.start?.index ?? 0;
            const end = resolveOccurrenceEndIndex(typedReference.end?.index ?? typedReference.location?.end?.index);
            if (!Core.isNonEmptyString(unresolvedReference.filePath) || end === null || end <= start) {
                continue;
            }

            const classifications = Core.asArray(typedReference.classifications);
            if (
                classifications.includes("property") &&
                this.isKnownEnumMemberReference(unresolvedReference.filePath, start)
            ) {
                continue;
            }

            if (this.isResolvedConstructorStaticMemberReference(symbolName, unresolvedReference.filePath, start, end)) {
                continue;
            }

            occurrences.push({
                path: unresolvedReference.filePath,
                start,
                end,
                scopeId: typeof typedReference.scopeId === "string" ? typedReference.scopeId : undefined,
                kind: "reference"
            });
        }
    }

    /**
     * Collect all declarations and references from an entry into the occurrences array.
     */
    private collectAllFromEntry(entry: any, occurrences: Array<SymbolOccurrence>): void {
        // Add declarations
        if (Array.isArray(entry.declarations)) {
            for (const decl of entry.declarations) {
                const end = resolveOccurrenceEndIndex(decl.end?.index);
                if (end === null) {
                    continue;
                }

                occurrences.push({
                    path: decl.filePath,
                    start: decl.start?.index ?? 0,
                    end,
                    scopeId: decl.scopeId,
                    kind: "definition"
                });
            }
        }

        // Add references
        if (Array.isArray(entry.references)) {
            for (const ref of entry.references) {
                this.collectEntryReferenceOccurrence(entry, ref, occurrences);
            }
        }

        this.collectUnresolvedEnumMemberOccurrences(entry, occurrences);
        this.collectEnumMemberMetadataOccurrences(entry, occurrences);
    }

    private collectSelfMemberInstanceVariableOccurrences(
        entry: SemanticIdentifierEntry,
        symbolName: string,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (!this.isInstanceVariableEntry(entry) || !Core.isNonEmptyString(symbolName)) {
            return;
        }

        for (const filePath of this.getEntrySourceFilePaths(entry)) {
            const sourceText = this.readProjectSourceText(filePath);
            if (sourceText === null) {
                continue;
            }

            this.collectSelfMemberOccurrencesFromSource(filePath, sourceText, symbolName, occurrences);
        }
    }

    private isInstanceVariableEntry(entry: SemanticIdentifierEntry): boolean {
        for (const instanceEntry of Object.values(this.identifiers.instanceVariables ?? {})) {
            if (instanceEntry === entry) {
                return true;
            }
        }

        return false;
    }

    private getEntrySourceFilePaths(entry: SemanticIdentifierEntry): Array<string> {
        const filePaths = new Set<string>();
        const declarationFilePath = this.getDeclarationFilePath(entry);
        if (Core.isNonEmptyString(declarationFilePath)) {
            filePaths.add(declarationFilePath);
        }

        for (const declaration of entry.declarations ?? []) {
            if (typeof declaration.filePath === "string") {
                filePaths.add(declaration.filePath);
            }
        }

        for (const reference of entry.references ?? []) {
            if (typeof reference.filePath === "string") {
                filePaths.add(reference.filePath);
            }
        }

        return [...filePaths];
    }

    private collectSelfMemberOccurrencesFromSource(
        filePath: string,
        sourceText: string,
        symbolName: string,
        occurrences: Array<SymbolOccurrence>
    ): void {
        const scanState = Core.createStringCommentScanState();
        const sourceLength = sourceText.length;
        let index = 0;

        while (index < sourceLength) {
            const scannedIndex = Core.advanceStringCommentScan(sourceText, sourceLength, index, scanState, true);
            if (scannedIndex !== index) {
                index = scannedIndex;
                continue;
            }

            if (isIdentifierTokenAt(sourceText, index, symbolName) && this.isSelfMemberNameAt(sourceText, index)) {
                occurrences.push({
                    path: filePath,
                    start: index,
                    end: index + symbolName.length,
                    kind: "reference"
                });
                index += symbolName.length;
                continue;
            }

            index += 1;
        }
    }

    private isSelfMemberNameAt(sourceText: string, memberStartIndex: number): boolean {
        let cursor = memberStartIndex - 1;
        while (cursor >= 0 && /\s/u.test(sourceText[cursor] ?? "")) {
            cursor -= 1;
        }

        if (sourceText[cursor] !== ".") {
            return false;
        }

        cursor -= 1;
        while (cursor >= 0 && /\s/u.test(sourceText[cursor] ?? "")) {
            cursor -= 1;
        }

        const ownerEndIndex = cursor + 1;
        while (cursor >= 0 && /[A-Za-z0-9_]/u.test(sourceText[cursor] ?? "")) {
            cursor -= 1;
        }

        const ownerName = sourceText.slice(cursor + 1, ownerEndIndex);
        return ownerName === "self" && isIdentifierBoundary(sourceText[cursor]);
    }

    private normalizeSourceBackedGmlOccurrences(
        symbolName: string,
        occurrences: Array<SymbolOccurrence>
    ): Array<SymbolOccurrence> {
        if (!Core.isNonEmptyString(symbolName)) {
            return occurrences;
        }

        const normalizedOccurrences: Array<SymbolOccurrence> = [];
        for (const occurrence of occurrences) {
            const normalizedOccurrence = this.normalizeSourceBackedGmlOccurrence(symbolName, occurrence);
            if (normalizedOccurrence !== null) {
                normalizedOccurrences.push(normalizedOccurrence);
            }
        }

        return normalizedOccurrences;
    }

    private normalizeSourceBackedGmlOccurrence(
        symbolName: string,
        occurrence: SymbolOccurrence
    ): SymbolOccurrence | null {
        if (path.extname(occurrence.path).toLowerCase() !== ".gml") {
            return occurrence;
        }

        const sourceText = this.readProjectSourceText(occurrence.path);
        if (sourceText === null) {
            return occurrence;
        }

        if (isIdentifierTokenAt(sourceText, occurrence.start, symbolName)) {
            return {
                ...occurrence,
                end: occurrence.start + symbolName.length
            };
        }

        const nearbyStart = Math.max(0, occurrence.start - symbolName.length);
        const nearbyEnd = Math.min(sourceText.length, occurrence.end + symbolName.length);
        const nearbySource = sourceText.slice(nearbyStart, nearbyEnd);
        const candidateStarts: Array<number> = [];
        let searchOffset = 0;

        while (searchOffset < nearbySource.length) {
            const localStart = nearbySource.indexOf(symbolName, searchOffset);
            if (localStart === -1) {
                break;
            }

            const candidateStart = nearbyStart + localStart;
            if (isIdentifierTokenAt(sourceText, candidateStart, symbolName)) {
                candidateStarts.push(candidateStart);
            }

            searchOffset = localStart + symbolName.length;
        }

        if (candidateStarts.length !== 1) {
            return null;
        }

        const start = candidateStarts[0];
        return {
            ...occurrence,
            start,
            end: start + symbolName.length
        };
    }

    /**
     * Deduplicate occurrences by path and range.
     */
    private deduplicateOccurrences(occurrences: Array<SymbolOccurrence>): Array<SymbolOccurrence> {
        if (occurrences.length <= 1) {
            return occurrences.filter(
                (occurrence) => Core.isNonEmptyString(occurrence.path) && occurrence.end > occurrence.start
            );
        }

        if (occurrences.length <= 8) {
            const deduplicated: Array<SymbolOccurrence> = [];

            for (const occurrence of occurrences) {
                if (!Core.isNonEmptyString(occurrence.path) || occurrence.end <= occurrence.start) {
                    continue;
                }

                const duplicate = deduplicated.find(
                    (candidate) =>
                        candidate.path === occurrence.path &&
                        candidate.start === occurrence.start &&
                        candidate.end === occurrence.end &&
                        candidate.kind === occurrence.kind
                );
                if (!duplicate) {
                    deduplicated.push(occurrence);
                }
            }

            return deduplicated;
        }

        const seen = new Set<string>();
        return occurrences.filter((occ) => {
            if (!Core.isNonEmptyString(occ.path) || occ.end < occ.start) {
                return false;
            }

            const key = `${occ.path}:${occ.start}:${occ.end}:${occ.kind}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    /**
     * Get symbols defined in a specific file.
     */
    getFileSymbols(filePath: string): MaybePromise<Array<FileSymbol>> {
        const symbols: Array<FileSymbol> = [];
        const fileRecord = this.projectIndex.files?.[filePath];

        if (fileRecord && Array.isArray(fileRecord.declarations)) {
            // This is a bit complex as we need to map back to symbol IDs
            // For now, we'll return what we can find
            for (const decl of fileRecord.declarations) {
                if (decl.name) {
                    symbols.push({
                        id: decl.identifierId || `gml/unknown/${decl.name}`
                    });
                }
            }
        }

        return symbols;
    }

    /**
     * Get symbols that depend on the given symbols.
     */
    getDependents(symbolIds: Array<string>): MaybePromise<Array<DependentSymbol>> {
        const dependents: Array<DependentSymbol> = [];

        // This requires traversing references in the index
        const identifiers = this.identifiers;
        if (!identifiers) return dependents;

        const symbolIdSet = new Set(symbolIds);

        // We check which symbols reference any of the target symbolNames.
        // Note: This is an approximation because ProjectIndex maintains two parallel
        // symbol namespaces — `identifierId` (the legacy "kind:name" form) and the
        // SCIP `id` field (the modern "gml/kind/name" form) — and cross-namespace
        // reference resolution is not yet fully consistent in all code paths.
        // WHAT WOULD BREAK: Removing this dual-check (targetName + targetSymbolId)
        // would silently miss dependent symbols that appear under the alternate
        // namespace, causing refactor to produce incomplete rename/update scopes
        // and leaving stale references in user code.
        for (const collectionName of Object.keys(identifiers)) {
            const collection = identifiers[collectionName];
            for (const key of Object.keys(collection)) {
                const entry = collection[key];

                // If this entry references any of our target symbols
                if (Array.isArray(entry.references)) {
                    for (const ref of entry.references) {
                        if (
                            symbolIdSet.has(ref.targetSymbolId) ||
                            (ref.targetName && this.testNameMatch(symbolIdSet, ref.targetName))
                        ) {
                            dependents.push({
                                symbolId: entry.identifierId || key,
                                filePath: entry.resourcePath || ""
                            });
                            break;
                        }
                    }
                }
            }
        }

        return dependents;
    }

    async listNamingConventionTargets(
        filePaths?: Array<string>,
        categories?: ReadonlyArray<BridgeNamingConventionCategory>
    ): Promise<Array<BridgeNamingConventionTarget>> {
        const targets: Array<BridgeNamingConventionTarget> = [];
        const requestedCategories = categories === undefined ? null : new Set(categories);
        const shouldIncludePath = createNamingTargetPathPredicate(this.projectRoot, filePaths);

        // Preload GML source texts in parallel to avoid synchronous fs reads in the loop
        const files = (this.projectIndex.files ?? {}) as Record<string, SemanticFileRecord>;
        const filesToPreload: Array<string> = [];
        for (const [filePath, fileRecord] of Object.entries(files)) {
            const hasSourceBackedLocalDeclarations = (fileRecord?.declarations ?? []).some((declaration) => {
                const classifications = Core.asArray(declaration?.classifications);
                return (
                    (classifications.includes("variable") || classifications.includes("parameter")) &&
                    !classifications.includes("global")
                );
            });
            if (shouldIncludePath(filePath) && hasSourceBackedLocalDeclarations) {
                filesToPreload.push(filePath);
            }
        }
        if (filesToPreload.length > 0) {
            await Core.runInParallel(filesToPreload, async (filePath) => {
                await this.preloadProjectSourceText(filePath);
            });
        }

        const pushTarget = (target: BridgeNamingConventionTarget): void => {
            targets.push(target);
        };

        if (includesAnyRequestedNamingCategory(requestedCategories, RESOURCE_NAMING_CATEGORIES)) {
            this.collectResourceNamingConventionTargets(shouldIncludePath, pushTarget);
        }
        if (includesAnyRequestedNamingCategory(requestedCategories, SCRIPT_CALLABLE_NAMING_CATEGORIES)) {
            this.collectScriptCallableNamingConventionTargets(shouldIncludePath, pushTarget);
        }
        if (requestedCategories === null || requestedCategories.has("macro")) {
            this.collectExactIdentifierNamingTargets(
                this.identifiers.macros ?? {},
                "macro",
                shouldIncludePath,
                pushTarget
            );
        }
        if (requestedCategories === null || requestedCategories.has("enum")) {
            this.collectExactIdentifierNamingTargets(
                this.identifiers.enums ?? {},
                "enum",
                shouldIncludePath,
                pushTarget
            );
        }
        if (requestedCategories === null || requestedCategories.has("enumMember")) {
            this.collectEnumMemberNamingConventionTargets(shouldIncludePath, pushTarget);
        }
        if (includesAnyRequestedNamingCategory(requestedCategories, GLOBAL_AND_INSTANCE_NAMING_CATEGORIES)) {
            this.collectGlobalAndInstanceNamingTargets(shouldIncludePath, pushTarget);
        }
        if (requestedCategories === null || requestedCategories.has("instanceVariable")) {
            this.collectImplicitInstanceNamingTargets(shouldIncludePath, pushTarget);
        }
        if (includesAnyRequestedNamingCategory(requestedCategories, LOCAL_NAMING_CATEGORIES)) {
            this.collectLocalNamingConventionTargets(shouldIncludePath, pushTarget);
        }

        return targets;
    }

    listMacroExpansionDependencies(filePaths?: Array<string>) {
        return listMacroExpansionDependencies({
            files: (this.projectIndex.files ?? {}) as Record<string, SemanticFileRecord>,
            macros: this.identifiers.macros ?? {},
            projectRoot: this.projectRoot,
            selectedFilePaths: filePaths
        });
    }

    private collectResourceNamingConventionTargets(
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        for (const resource of Object.values(this.resources)) {
            if (!resource?.name || !shouldIncludePath(resource.path)) {
                continue;
            }

            if (resource.resourceType === "GMScript" && this.isConstructorBackedScriptResource(resource)) {
                continue;
            }

            const category = this.getResourceNamingCategory(resource);
            if (!category) {
                continue;
            }

            pushTarget({
                category,
                name: resource.name,
                occurrences: [],
                path: resource.path,
                scopeId: null,
                symbolId: this.generateResourceScipId(resource)
            });
        }
    }

    private isConstructorBackedScriptResource(resource: SemanticResourceRecord): boolean {
        if (
            resource.resourceType !== "GMScript" ||
            !Core.isNonEmptyString(resource.path) ||
            !Core.isNonEmptyString(resource.name)
        ) {
            return false;
        }

        const declarations = this.getScriptCallableDeclarationsForResource(resource.path);
        if (declarations.length === 1) {
            const declaration = declarations[0];
            const category = this.getScriptCallableNamingCategory(
                declaration.entry,
                declaration.declaration,
                true,
                this.extractDeclarationKinds(declaration.entry)
            );
            return category === "constructorFunction" || category === "structDeclaration";
        }

        if (declarations.length > 1) {
            return false;
        }

        return this.isConstructorBackedScriptResourceSource(resource);
    }

    private isConstructorBackedScriptResourceSource(resource: SemanticResourceRecord): boolean {
        if (!Core.isNonEmptyString(resource.path) || !Core.isNonEmptyString(resource.name)) {
            return false;
        }

        const scriptPath = resource.path.replace(/\.yy$/iu, ".gml");
        if (scriptPath === resource.path) {
            return false;
        }

        const sourceText = this.readProjectSourceText(scriptPath);
        if (sourceText === null) {
            return false;
        }

        const functionDeclarationPattern = new RegExp(
            String.raw`\bfunction\s+${escapeRegExpLiteral(resource.name)}\s*\(`,
            "u"
        );
        const match = functionDeclarationPattern.exec(sourceText);
        if (match === null) {
            return false;
        }

        const bodyStart = sourceText.indexOf("{", match.index);
        if (bodyStart === -1) {
            return false;
        }

        return /\bconstructor\b/u.test(sourceText.slice(match.index, bodyStart));
    }

    private collectScriptCallableNamingConventionTargets(
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        for (const entry of Object.values(this.identifiers.scripts ?? {})) {
            const callableDeclarations = this.getScriptCallableDeclarations(entry);
            if (callableDeclarations.length === 0) {
                continue;
            }

            const hasSingleCallableDeclaration = callableDeclarations.length === 1;
            const resource =
                typeof entry.resourcePath === "string" ? (this.resources?.[entry.resourcePath] ?? null) : null;
            const isCoupledSingleCallableResource =
                hasSingleCallableDeclaration &&
                resource?.resourceType === "GMScript" &&
                resource?.name === callableDeclarations[0]?.name;
            const entryDeclarationKinds = hasSingleCallableDeclaration ? this.extractDeclarationKinds(entry) : null;

            for (const declaration of callableDeclarations) {
                if (!shouldIncludePath(declaration.filePath)) {
                    continue;
                }

                const category = this.getScriptCallableNamingCategory(
                    entry,
                    declaration,
                    hasSingleCallableDeclaration,
                    entryDeclarationKinds
                );

                if (
                    isCoupledSingleCallableResource &&
                    declaration.name === resource?.name &&
                    category !== "constructorFunction" &&
                    category !== "structDeclaration"
                ) {
                    continue;
                }

                pushTarget({
                    category,
                    name: declaration.name,
                    occurrences: [],
                    path: declaration.filePath,
                    scopeId: entry.scopeId ?? null,
                    symbolId: this.generateScipId(entry, declaration.name)
                });
            }
        }
    }

    private collectExactIdentifierNamingTargets(
        entries: Record<string, SemanticIdentifierEntry>,
        category: BridgeNamingConventionTarget["category"],
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        for (const entry of Object.values(entries)) {
            const declarationFilePath = this.getDeclarationFilePath(entry);
            if (!shouldIncludePath(declarationFilePath) || typeof entry?.name !== "string") {
                continue;
            }

            pushTarget({
                category,
                name: entry.name,
                occurrences: [],
                path: declarationFilePath,
                scopeId: entry.scopeId ?? null,
                symbolId: this.generateScipId(entry)
            });
        }
    }

    private collectEnumMemberNamingConventionTargets(
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        for (const entry of Object.values(this.identifiers.enumMembers ?? {})) {
            const declarationFilePath = this.getDeclarationFilePath(entry);
            if (!shouldIncludePath(declarationFilePath) || typeof entry?.name !== "string") {
                continue;
            }

            pushTarget({
                category: "enumMember",
                name: entry.name,
                occurrences: this.collectEntryOccurrences(entry),
                path: declarationFilePath,
                scopeId: entry.scopeId ?? null,
                symbolId: this.generateScipId(entry)
            });
        }
    }

    private isConstructorStaticMemberIdentifierEntry(entry: SemanticIdentifierEntry): boolean {
        for (const declaration of entry.declarations ?? []) {
            const filePath = typeof declaration.filePath === "string" ? declaration.filePath : null;
            const start = readSemanticLocationIndex(declaration.start);
            const end = readExclusiveSemanticLocationIndex(declaration.end);
            if (
                filePath !== null &&
                start !== null &&
                end !== null &&
                this.isConstructorStaticMemberDeclarationRange(filePath, start, end)
            ) {
                return true;
            }
        }

        return false;
    }

    private isConstructorStaticMemberDeclarationRange(filePath: string, start: number, end: number): boolean {
        for (const entry of Object.values(this.identifiers.constructorStaticMembers ?? {})) {
            for (const declaration of entry.declarations ?? []) {
                if (typeof declaration.filePath !== "string" || declaration.filePath !== filePath) {
                    continue;
                }

                const declarationStart = readSemanticLocationIndex(declaration.start);
                const declarationEnd = readExclusiveSemanticLocationIndex(declaration.end);
                if (declarationStart === start && declarationEnd === end) {
                    return true;
                }
            }
        }

        return false;
    }

    private collectGlobalAndInstanceNamingTargets(
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        const knownShadowableNames = new Set<string>();

        for (const entry of Object.values(this.identifiers.enums ?? {})) {
            if (typeof entry?.name === "string") {
                knownShadowableNames.add(entry.name);
            }
        }
        for (const entry of Object.values(this.identifiers.macros ?? {})) {
            if (typeof entry?.name === "string") {
                knownShadowableNames.add(entry.name);
            }
        }
        for (const entry of Object.values(this.identifiers.scripts ?? {})) {
            for (const declaration of this.getScriptCallableDeclarations(entry)) {
                knownShadowableNames.add(declaration.name);
            }
            if (typeof entry?.name === "string") {
                knownShadowableNames.add(entry.name);
            }
        }
        for (const resource of Object.values(this.resources ?? {})) {
            if (typeof resource?.name === "string") {
                knownShadowableNames.add(resource.name);
            }
        }

        for (const entry of Object.values(this.identifiers.globalVariables ?? {})) {
            const declarationFilePath = this.getDeclarationFilePath(entry);
            const entryName = typeof entry?.name === "string" ? entry.name : entry?.key;
            if (
                !shouldIncludePath(declarationFilePath) ||
                typeof entryName !== "string" ||
                knownShadowableNames.has(entryName) ||
                this.isConstructorStaticMemberIdentifierEntry(entry)
            ) {
                continue;
            }

            pushTarget({
                category: "globalVariable",
                name: entryName,
                occurrences: [],
                path: declarationFilePath,
                scopeId: entry.scopeId ?? null,
                symbolId: this.generateScipId(entry, entryName)
            });
        }

        for (const entry of Object.values(this.identifiers.instanceVariables ?? {})) {
            const declarationFilePath = this.getDeclarationFilePath(entry);
            const entryName = typeof entry?.name === "string" ? entry.name : entry?.key;
            if (
                !shouldIncludePath(declarationFilePath) ||
                typeof entryName !== "string" ||
                knownShadowableNames.has(entryName) ||
                this.isConstructorStaticMemberIdentifierEntry(entry)
            ) {
                continue;
            }

            pushTarget({
                category: "instanceVariable",
                name: entryName,
                occurrences: [],
                path: declarationFilePath,
                scopeId: entry.scopeId ?? null,
                symbolId: this.generateScipId(entry, entryName)
            });
        }
    }

    private collectImplicitInstanceNamingTargets(
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        const knownEnumNames = new Set<string>();
        const knownNamesByObjectDirectory = new Map<string, Set<string>>();
        const knownResourceNames = new Set<string>();

        for (const resource of Object.values(this.resources ?? {})) {
            if (typeof resource?.name === "string") {
                knownResourceNames.add(resource.name.toLowerCase());
            }
        }

        for (const entry of Object.values(this.identifiers.enums ?? {})) {
            if (typeof entry?.name === "string") {
                knownEnumNames.add(entry.name);
            }
        }
        for (const entry of Object.values(this.identifiers.macros ?? {})) {
            if (typeof entry?.name === "string") {
                knownResourceNames.add(entry.name.toLowerCase());
            }
        }
        for (const entry of Object.values(this.identifiers.scripts ?? {})) {
            for (const declaration of this.getScriptCallableDeclarations(entry)) {
                knownResourceNames.add(declaration.name.toLowerCase());
            }
            if (typeof entry?.name === "string") {
                knownResourceNames.add(entry.name.toLowerCase());
            }
        }

        for (const entry of Object.values(this.identifiers.instanceVariables ?? {})) {
            const declarationFilePath = this.getDeclarationFilePath(entry);
            const entryName = typeof entry?.name === "string" ? entry.name : entry?.key;
            if (!shouldIncludePath(declarationFilePath) || typeof entryName !== "string") {
                continue;
            }

            const objectDirectory = path.posix.dirname(declarationFilePath.replaceAll("\\", "/"));
            const knownNames = knownNamesByObjectDirectory.get(objectDirectory) ?? new Set<string>();
            knownNames.add(entryName);
            knownNamesByObjectDirectory.set(objectDirectory, knownNames);
        }

        for (const target of collectImplicitInstanceVariableTargets({
            files: (this.projectIndex.files ?? {}) as Record<string, SemanticFileRecord>,
            isProtectedOccurrenceRange: (filePath, start, end) =>
                this.isConstructorStaticMemberDeclarationRange(filePath, start, end),
            knownEnumNames,
            knownNamesByObjectDirectory,
            knownResourceNames,
            projectRoot: this.projectRoot,
            shouldIncludePath
        })) {
            pushTarget(target);
        }
    }

    private collectLocalNamingConventionTargets(
        shouldIncludePath: NamingTargetPathPredicate,
        pushTarget: NamingTargetSink
    ): void {
        const scopes = (this.projectIndex.scopes ?? {}) as Record<string, SemanticScopeRecord>;
        const files = (this.projectIndex.files ?? {}) as Record<string, SemanticFileRecord>;
        const knownGlobalNames = new Set<string>();
        for (const entry of Object.values(this.identifiers.macros ?? {})) {
            if (typeof entry?.name === "string") {
                knownGlobalNames.add(entry.name);
            }
        }
        for (const entry of Object.values(this.identifiers.enums ?? {})) {
            if (typeof entry?.name === "string") {
                knownGlobalNames.add(entry.name);
            }
        }
        for (const entry of Object.values(this.identifiers.scripts ?? {})) {
            for (const declaration of this.getScriptCallableDeclarations(entry)) {
                knownGlobalNames.add(declaration.name);
            }
            if (typeof entry?.name === "string") {
                knownGlobalNames.add(entry.name);
            }
        }

        for (const [filePath, fileRecord] of Object.entries(files)) {
            const fileDeclarations = fileRecord?.declarations ?? [];
            if (!shouldIncludePath(filePath) || fileDeclarations.length === 0) {
                continue;
            }

            let sourceText: string | null = null;
            let indexedReferenceOccurrences: LocalReferenceIndex | null = null;
            for (const declaration of fileDeclarations) {
                if (!declaration || declaration.isBuiltIn || typeof declaration.name !== "string") {
                    continue;
                }

                if (knownGlobalNames.has(declaration.name)) {
                    continue;
                }

                const classifications = Core.asArray(declaration.classifications);
                if (
                    (!classifications.includes("variable") && !classifications.includes("parameter")) ||
                    classifications.includes("global")
                ) {
                    continue;
                }

                sourceText ??= this.readProjectSourceText(filePath);
                const scopeId = typeof declaration.scopeId === "string" ? declaration.scopeId : null;
                const scopeRecord = scopeId ? scopes[scopeId] : null;
                const category = classifications.includes("parameter")
                    ? scopeRecord?.kind === "catch"
                        ? "catchArgument"
                        : "argument"
                    : this.resolveLocalNamingConventionCategory(filePath, declaration, sourceText);
                indexedReferenceOccurrences ??= this.getLocalReferenceOccurrences(filePath, fileRecord);
                const isConstructorStaticMember =
                    category === "staticVariable" &&
                    this.isConstructorStaticMemberDeclaration(filePath, declaration, sourceText);
                const occurrences = isConstructorStaticMember
                    ? this.collectConstructorStaticMemberOccurrences(filePath, declaration, sourceText)
                    : this.collectLocalOccurrences(filePath, declaration, sourceText, indexedReferenceOccurrences);

                if (occurrences.length === 0) {
                    continue;
                }

                pushTarget({
                    category,
                    name: declaration.name,
                    occurrences,
                    path: filePath,
                    scopeId,
                    symbolId: null
                });
            }
        }
    }

    /**
     * Perform a scope-aware lookup for a name.
     */
    lookup(name: string, scopeId?: string): MaybePromise<SymbolLookupResult | null> {
        for (const entry of this.getIndexes().symbolLookupsByExactName.get(name) ?? []) {
            if (!scopeId || entry.scopeId === scopeId) {
                return { name: entry.name };
            }
        }

        // Also check resources
        const resource = this.findResourceByName(name);
        if (resource) {
            return { name: resource.name };
        }

        return null;
    }

    private findSymbolInCollections(symbolId: string): any {
        const indexes = this.getIndexes();
        const resourceSymbolMatch = symbolId.match(/^gml\/([^/]+)\/(.+)$/);
        if (resourceSymbolMatch && this.isResourceSymbolId(symbolId)) {
            const resource =
                this.findResourceByName(resourceSymbolMatch[2]) ??
                this.findResourceByName(resourceSymbolMatch[2], true);
            return resource === null ? null : this.createSyntheticResourceEntry(resource, symbolId);
        }

        const directEntry = indexes.entriesByIdentifierId.get(symbolId) ?? indexes.entriesByScipId.get(symbolId);
        if (directEntry) {
            return directEntry;
        }

        // 2. Map SCIP-style ID to internal indexer ID and try again
        const scipMatch = symbolId.match(/^gml\/([^/]+)\/(.+)$/);
        if (scipMatch) {
            const kind = scipMatch[1];
            const name = scipMatch[2];

            // Special handling for resource kinds
            if (
                [
                    "objects",
                    "sprites",
                    "sounds",
                    "rooms",
                    "paths",
                    "curves",
                    "sequences",
                    "scripts",
                    "shaders",
                    "fonts",
                    "timelines",
                    "tilesets",
                    "particlesystems",
                    "notes",
                    "extensions"
                ].includes(kind)
            ) {
                const resource = this.findResourceByName(name);
                if (resource) {
                    // Create a synthetic symbol entry for the resource
                    return this.createSyntheticResourceEntry(resource, symbolId);
                }

                return null;
            }

            const resolvedScipId = indexes.exactResolveSymbolIds.get(name);
            if (resolvedScipId) {
                const resolvedEntry = indexes.entriesByScipId.get(resolvedScipId);
                if (resolvedEntry) {
                    return resolvedEntry;
                }
            }

            // 4. Case-insensitive resource fallback for manual ID inputs
            const resourceLower = this.findResourceByName(name, true);
            if (resourceLower) {
                return this.createSyntheticResourceEntry(resourceLower, `gml/${kind}/${resourceLower.name}`);
            }
        }

        return null;
    }

    private getDeclarationFilePath(entry: any): string | null {
        for (const declaration of entry?.declarations ?? []) {
            if (typeof declaration?.filePath === "string") {
                return declaration.filePath;
            }
        }

        if (typeof entry?.resourcePath === "string") {
            return entry.resourcePath;
        }

        return null;
    }

    private getScriptCallableDeclarations(entry: SemanticIdentifierEntry): Array<ScriptCallableDeclaration> {
        const cachedDeclarations = this.scriptCallableDeclarationsByEntry.get(entry);
        if (cachedDeclarations !== undefined) {
            return cachedDeclarations as Array<ScriptCallableDeclaration>;
        }

        const declarations: Array<ScriptCallableDeclaration> = [];

        for (const declaration of entry?.declarations ?? []) {
            if (
                declaration?.isSynthetic === true ||
                typeof declaration?.name !== "string" ||
                typeof declaration?.filePath !== "string"
            ) {
                continue;
            }

            declarations.push(declaration as ScriptCallableDeclaration);
        }

        this.scriptCallableDeclarationsByEntry.set(entry, declarations);
        return declarations;
    }

    private getScriptCallableDeclarationsForResource(resourcePath: string): Array<ScriptCallableDeclarationEntry> {
        return this.getScriptResourceIndexes().scriptCallableDeclarationsByResourcePath.get(resourcePath) ?? [];
    }

    private hasScriptEntryForResource(resourcePath: string): boolean {
        return (this.getScriptResourceIndexes().scriptEntriesByResourcePath.get(resourcePath)?.length ?? 0) > 0;
    }

    private isCoupledSingleFunctionScriptCallable(entry: SemanticIdentifierEntry, declarationName: string): boolean {
        if (typeof entry?.resourcePath !== "string") {
            return false;
        }

        const resource = this.resources?.[entry.resourcePath];
        if (resource?.resourceType !== "GMScript" || resource?.name !== declarationName) {
            return false;
        }

        const declarations = this.getScriptCallableDeclarationsForResource(entry.resourcePath);
        return declarations.length === 1 && declarations[0]?.declaration?.name === declarationName;
    }

    private hasSingleCallableDeclaration(entry: SemanticIdentifierEntry): boolean {
        return this.getScriptCallableDeclarations(entry).length === 1;
    }

    private shouldResourceRenameCollectDiskOccurrences(resource: SemanticResourceRecord): boolean {
        if (resource.resourceType !== "GMScript" || typeof resource.path !== "string") {
            return true;
        }

        if (this.isConstructorBackedScriptResource(resource)) {
            return false;
        }

        const declarations = this.getScriptCallableDeclarationsForResource(resource.path);
        if (
            declarations.length === 1 &&
            typeof resource.name === "string" &&
            declarations[0]?.declaration?.name === resource.name
        ) {
            return true;
        }

        return !this.hasScriptEntryForResource(resource.path);
    }

    private isIndependentMultiFunctionScriptResourceSymbol(
        entry: SemanticIdentifierEntry,
        symbolId: string | null
    ): boolean {
        if (!this.isIndependentMultiFunctionScriptResourceSymbolId(symbolId)) {
            return false;
        }

        return this.getScriptCallableDeclarations(entry).length > 1;
    }

    private isIndependentMultiFunctionScriptResourceSymbolId(symbolId: string | null): boolean {
        if (!Core.isNonEmptyString(symbolId) || !symbolId.startsWith("gml/scripts/")) {
            return false;
        }

        const symbolEntry = this.findSymbolInCollections(symbolId);
        const resource = symbolEntry ? this.findResourceBySymbol(symbolEntry, symbolId) : null;
        if (resource?.resourceType !== "GMScript" || typeof resource.path !== "string") {
            return false;
        }

        const declarations = this.getScriptCallableDeclarationsForResource(resource.path);
        return declarations.length > 1;
    }

    private isResourceSymbolId(symbolId: string | null): symbolId is string {
        if (!Core.isNonEmptyString(symbolId)) {
            return false;
        }

        const match = symbolId.match(/^gml\/([^/]+)\//);
        if (match === null) {
            return false;
        }

        return [
            "objects",
            "sprites",
            "sounds",
            "rooms",
            "paths",
            "curves",
            "sequences",
            "scripts",
            "shaders",
            "fonts",
            "timelines",
            "tilesets",
            "particlesystems",
            "notes",
            "extensions"
        ].includes(match[1]);
    }

    private getScriptCallableNamingCategory(
        entry: SemanticIdentifierEntry,
        declaration: Record<string, unknown>,
        hasSingleCallableDeclaration = this.hasSingleCallableDeclaration(entry),
        entryDeclarationKinds: ReadonlySet<string> | null = null
    ): Extract<BridgeNamingConventionTarget["category"], "constructorFunction" | "structDeclaration" | "function"> {
        const declarationKinds = new Set<string>();

        for (const classification of Core.asArray(declaration.classifications)) {
            if (typeof classification === "string") {
                declarationKinds.add(classification);
            }
        }

        if (declarationKinds.has("constructor")) {
            return "constructorFunction";
        }

        if (declarationKinds.has("struct")) {
            return "structDeclaration";
        }

        if (!hasSingleCallableDeclaration) {
            return "function";
        }

        const entryKinds = entryDeclarationKinds ?? this.extractDeclarationKinds(entry);
        if (entryKinds.has("constructor")) {
            return "constructorFunction";
        }

        if (entryKinds.has("struct")) {
            return "structDeclaration";
        }

        return "function";
    }

    private extractDeclarationKinds(entry: any): Set<string> {
        const cachedDeclarationKinds = this.declarationKindsByEntry.get(entry);
        if (cachedDeclarationKinds !== undefined) {
            return cachedDeclarationKinds as Set<string>;
        }

        const declarationKinds = new Set<string>();

        for (const declaration of entry?.declarations ?? []) {
            for (const classification of Core.asArray(declaration?.classifications)) {
                if (typeof classification === "string") {
                    declarationKinds.add(classification);
                }
            }
        }

        for (const declarationKind of Core.asArray(entry?.declarationKinds)) {
            if (typeof declarationKind === "string") {
                declarationKinds.add(declarationKind);
            }
        }

        this.declarationKindsByEntry.set(entry, declarationKinds);
        return declarationKinds;
    }

    private getResourceNamingCategory(
        resource: SemanticResourceRecord | null | undefined
    ): BridgeNamingConventionTarget["category"] | null {
        const resourceKind = mapResourceTypeToScipKind(resource?.resourceType);
        switch (resourceKind) {
            case "scripts": {
                const declarationCategory = this.getScriptResourceDeclarationNamingCategory(
                    resource?.path,
                    resource?.name
                );
                if (declarationCategory !== null) {
                    return declarationCategory;
                }
                return "scriptResourceName";
            }
            case "objects": {
                return "objectResourceName";
            }
            case "rooms": {
                return "roomResourceName";
            }
            case "sprites": {
                return "spriteResourceName";
            }
            case "sounds": {
                return "audioResourceName";
            }
            case "timelines": {
                return "timelineResourceName";
            }
            case "shaders": {
                return "shaderResourceName";
            }
            case "fonts": {
                return "fontResourceName";
            }
            case "paths": {
                return "pathResourceName";
            }
            case "curves": {
                return "animationCurveResourceName";
            }
            case "sequences": {
                return "sequenceResourceName";
            }
            case "tilesets": {
                return "tilesetResourceName";
            }
            case "particlesystems": {
                return "particleSystemResourceName";
            }
            case "notes": {
                return "noteResourceName";
            }
            case "extensions": {
                return "extensionResourceName";
            }
            default: {
                return null;
            }
        }
    }

    private getScriptResourceDeclarationNamingCategory(
        resourcePath: string | null | undefined,
        resourceName: string | null | undefined
    ): Extract<BridgeNamingConventionTarget["category"], "constructorFunction" | "structDeclaration"> | null {
        if (!Core.isNonEmptyString(resourcePath) || !Core.isNonEmptyString(resourceName)) {
            return null;
        }

        const declarations = this.getScriptCallableDeclarationsForResource(resourcePath);
        if (declarations.length !== 1) {
            return null;
        }

        const [{ declaration, entry }] = declarations;
        if (declaration.name !== resourceName) {
            return null;
        }

        const category = this.getScriptCallableNamingCategory(
            entry,
            declaration,
            true,
            this.extractDeclarationKinds(entry)
        );
        if (category === "constructorFunction" || category === "structDeclaration") {
            return category;
        }

        return null;
    }

    private collectLocalOccurrences(
        filePath: string,
        declaration: any,
        sourceText: string | null,
        indexedReferenceOccurrences: LocalReferenceIndex
    ): Array<SymbolOccurrence> {
        const declarationStartIndex = declaration?.start?.index ?? null;
        const declarationScopeId = declaration?.scopeId ?? null;
        const declarationName = typeof declaration.name === "string" ? declaration.name : "";
        const declarationOccurrence = createIdentifierTokenOccurrence({
            sourceText,
            filePath,
            name: declarationName,
            startIndex: declarationStartIndex,
            endIndex: resolveOccurrenceEndIndex(declaration.end?.index),
            scopeId: declaration.scopeId,
            kind: "definition"
        });
        if (declarationOccurrence === null) {
            return [];
        }
        const occurrences: Array<SymbolOccurrence> = [declarationOccurrence];

        const referenceKey = this.createLocalReferenceKey(declarationName, declarationScopeId, declarationStartIndex);
        occurrences.push(...(indexedReferenceOccurrences.get(referenceKey) ?? []));

        return this.deduplicateOccurrences(occurrences);
    }

    private collectConstructorStaticMemberOccurrences(
        filePath: string,
        declaration: any,
        sourceText: string | null
    ): Array<SymbolOccurrence> {
        const entry = this.findConstructorStaticMemberEntryForDeclaration(filePath, declaration);
        if (entry !== null) {
            return this.collectEntryOccurrences(entry);
        }

        const declarationOccurrence = createIdentifierTokenOccurrence({
            sourceText,
            filePath,
            name: typeof declaration.name === "string" ? declaration.name : "",
            startIndex: declaration?.start?.index ?? null,
            endIndex: resolveOccurrenceEndIndex(declaration.end?.index),
            scopeId: declaration.scopeId,
            kind: "definition"
        });

        return declarationOccurrence === null ? [] : [declarationOccurrence];
    }

    private hasUnresolvedConstructorStaticMemberReferencesOutsideEntry(
        entry: SemanticIdentifierEntry,
        occurrences: ReadonlyArray<SymbolOccurrence>
    ): boolean {
        if (!Core.isNonEmptyString(entry.name)) {
            return false;
        }

        const semanticOccurrenceKeys = new Set(
            occurrences
                .filter((occurrence) => occurrence.kind === "reference")
                .map((occurrence) => `${occurrence.path}:${occurrence.start}:${occurrence.end}`)
        );

        for (const unresolvedReference of this.getIndexes().unresolvedReferencesByExactName.get(entry.name) ?? []) {
            const start = readSemanticLocationIndex(unresolvedReference.reference.start);
            const end = readExclusiveSemanticLocationIndex(unresolvedReference.reference.end);
            if (start === null || end === null || end <= start) {
                continue;
            }

            if (semanticOccurrenceKeys.has(`${unresolvedReference.filePath}:${start}:${end}`)) {
                continue;
            }

            const classifications = Core.asArray(unresolvedReference.reference.classifications);
            if (
                classifications.includes("property") ||
                this.isBareCallReferenceSourceMatch(unresolvedReference.filePath, start, end)
            ) {
                return true;
            }
        }

        return false;
    }

    private isBareCallReferenceSourceMatch(filePath: string, startIndex: number, endIndex: number): boolean {
        const sourceText = this.readProjectSourceText(filePath);
        if (sourceText === null || startIndex < 0 || endIndex <= startIndex || endIndex > sourceText.length) {
            return false;
        }

        let previousCursor = startIndex - 1;
        while (previousCursor >= 0 && /\s/u.test(sourceText[previousCursor] ?? "")) {
            previousCursor -= 1;
        }

        if (previousCursor >= 0 && sourceText[previousCursor] === ".") {
            return false;
        }

        let nextCursor = endIndex;
        while (nextCursor < sourceText.length && /\s/u.test(sourceText[nextCursor] ?? "")) {
            nextCursor += 1;
        }

        return sourceText[nextCursor] === "(";
    }

    private isPropertyReferenceSourceMatch(filePath: string, startIndex: number): boolean {
        const sourceText = this.readProjectSourceText(filePath);
        if (sourceText === null || startIndex <= 0 || startIndex > sourceText.length) {
            return false;
        }

        let previousCursor = startIndex - 1;
        while (previousCursor >= 0 && /\s/u.test(sourceText[previousCursor] ?? "")) {
            previousCursor -= 1;
        }

        return previousCursor >= 0 && sourceText[previousCursor] === ".";
    }

    private findConstructorStaticMemberEntryForDeclaration(
        filePath: string,
        declaration: any
    ): SemanticIdentifierEntry | null {
        const declarationStart = readSemanticLocationIndex(declaration?.start);
        const declarationEnd = readExclusiveSemanticLocationIndex(declaration?.end);
        const declarationName = typeof declaration?.name === "string" ? declaration.name : null;
        if (declarationStart === null || declarationEnd === null || declarationName === null) {
            return null;
        }

        for (const entry of Object.values(this.identifiers.constructorStaticMembers ?? {})) {
            if (entry.name !== declarationName) {
                continue;
            }

            for (const entryDeclaration of entry.declarations ?? []) {
                const entryFilePath = typeof entryDeclaration.filePath === "string" ? entryDeclaration.filePath : "";
                if (entryFilePath !== filePath) {
                    continue;
                }

                const entryStart = readSemanticLocationIndex(entryDeclaration.start);
                const entryEnd = readExclusiveSemanticLocationIndex(entryDeclaration.end);
                if (entryStart === declarationStart && entryEnd === declarationEnd) {
                    return entry;
                }
            }
        }

        return null;
    }

    private createLocalReferenceKey(name: string, scopeId: string | null, startIndex: number | null): string {
        return `${name}:${scopeId ?? ""}:${startIndex ?? -1}`;
    }

    private getLocalReferenceOccurrences(filePath: string, fileRecord: SemanticFileRecord): LocalReferenceIndex {
        const cached = this.localReferenceOccurrencesByFilePath.get(filePath);
        if (cached) {
            return cached;
        }

        const indexedOccurrences: LocalReferenceIndex = new Map();
        const sourceText = this.readProjectSourceText(filePath);
        const constructorStaticFunctionRanges = this.localNamingCategoryResolver.listConstructorStaticFunctionRanges(
            filePath,
            sourceText
        );

        for (const reference of fileRecord.references ?? []) {
            if (!Core.isObjectLike(reference)) {
                continue;
            }

            const referenceDeclaration = Core.isObjectLike(reference.declaration)
                ? (reference.declaration as Record<string, unknown>)
                : null;
            if (referenceDeclaration === null || typeof reference.name !== "string") {
                continue;
            }

            const referenceClassifications = Core.asArray(reference.classifications).filter(
                (classification): classification is string => typeof classification === "string"
            );
            if (
                referenceClassifications.length > 0 &&
                (!referenceClassifications.some(
                    (classification) => classification === "variable" || classification === "parameter"
                ) ||
                    referenceClassifications.some(
                        (classification) =>
                            classification === "enum-member" ||
                            classification === "member" ||
                            classification === "property"
                    ))
            ) {
                continue;
            }

            const startIndex = readSemanticLocationIndex(reference.start);
            const endIndex = readExclusiveSemanticLocationIndex(reference.end);
            if (startIndex === null || endIndex === null) {
                continue;
            }

            if (this.isMemberAccessReference(sourceText, startIndex)) {
                continue;
            }

            const referenceOccurrence = createIdentifierTokenOccurrence({
                sourceText,
                filePath,
                name: reference.name,
                startIndex,
                endIndex,
                scopeId: reference.scopeId,
                kind: "reference"
            });
            if (referenceOccurrence === null) {
                continue;
            }

            const declarationStartIndex = readSemanticLocationIndex(referenceDeclaration.start);
            if (
                declarationStartIndex !== null &&
                this.isOuterLocalReferenceInsideConstructorStaticFunctionRange(
                    constructorStaticFunctionRanges,
                    startIndex,
                    declarationStartIndex
                )
            ) {
                continue;
            }

            const declarationScopeId =
                typeof referenceDeclaration.scopeId === "string" ? referenceDeclaration.scopeId : null;
            const referenceKey = this.createLocalReferenceKey(
                reference.name,
                declarationScopeId,
                declarationStartIndex
            );
            const scopedOccurrences = indexedOccurrences.get(referenceKey) ?? [];
            scopedOccurrences.push(referenceOccurrence);
            indexedOccurrences.set(referenceKey, scopedOccurrences);
        }

        this.localReferenceOccurrencesByFilePath.set(filePath, indexedOccurrences);
        return indexedOccurrences;
    }

    private isOuterLocalReferenceInsideConstructorStaticFunctionRange(
        staticFunctionRanges: ReadonlyArray<{ end: number; start: number }>,
        referenceStartIndex: number,
        declarationStartIndex: number
    ): boolean {
        for (const staticFunctionRange of staticFunctionRanges) {
            const referenceIsInsideStaticFunction =
                referenceStartIndex >= staticFunctionRange.start && referenceStartIndex <= staticFunctionRange.end;
            if (!referenceIsInsideStaticFunction) {
                continue;
            }

            const declarationIsInsideStaticFunction =
                declarationStartIndex >= staticFunctionRange.start && declarationStartIndex <= staticFunctionRange.end;
            if (!declarationIsInsideStaticFunction) {
                return true;
            }
        }

        return false;
    }

    private isMemberAccessReference(sourceText: string | null, startIndex: number): boolean {
        if (sourceText === null || startIndex <= 0) {
            return false;
        }

        for (let cursor = startIndex - 1; cursor >= 0; cursor -= 1) {
            const character = sourceText[cursor];
            if (character === undefined) {
                return false;
            }

            if (!/\s/u.test(character)) {
                return character === ".";
            }
        }

        return false;
    }

    private collectEntryOccurrences(entry: SemanticIdentifierEntry): Array<SymbolOccurrence> {
        const occurrences: Array<SymbolOccurrence> = [];
        const isEnumMemberEntry =
            entry.identifierId?.startsWith("enum-member:") === true &&
            Core.isNonEmptyString(entry.name) &&
            Core.isNonEmptyString(entry.enumName);

        for (const declaration of entry.declarations ?? []) {
            const declarationStart = readSemanticLocationIndex(declaration.start) ?? 0;
            const declarationEnd = readExclusiveSemanticLocationIndex(declaration.end) ?? 0;

            occurrences.push({
                path: typeof declaration.filePath === "string" ? declaration.filePath : "",
                start: declarationStart,
                end: declarationEnd,
                scopeId: typeof declaration.scopeId === "string" ? declaration.scopeId : undefined,
                kind: "definition"
            });
        }

        for (const reference of entry.references ?? []) {
            const referenceLocationRecord = Core.isObjectLike(reference.location)
                ? (reference.location as Record<string, unknown>)
                : null;
            const referenceStart = readSemanticLocationIndex(reference.start) ?? 0;
            const referenceEnd = readExclusiveSemanticLocationIndex(reference.end) ?? 0;
            const locationStart = readSemanticLocationIndex(referenceLocationRecord?.start) ?? 0;
            const locationEnd = readExclusiveSemanticLocationIndex(referenceLocationRecord?.end) ?? 0;
            const rawStart = referenceStart || locationStart;
            const rawEnd = referenceEnd || locationEnd;
            const exactEnumMemberRange = isEnumMemberEntry
                ? this.resolveEnumMemberReferenceRange({
                      filePath: typeof reference.filePath === "string" ? reference.filePath : "",
                      startIndex: rawStart,
                      endIndex: rawEnd,
                      enumName: entry.enumName,
                      memberName: entry.name
                  })
                : null;

            occurrences.push({
                path: typeof reference.filePath === "string" ? reference.filePath : "",
                start: exactEnumMemberRange?.start ?? rawStart,
                end: exactEnumMemberRange?.end ?? rawEnd,
                scopeId: typeof reference.scopeId === "string" ? reference.scopeId : undefined,
                kind: "reference"
            });
        }

        this.collectUnresolvedEnumMemberOccurrences(entry, occurrences);
        this.collectEnumMemberMetadataOccurrences(entry, occurrences);

        return this.deduplicateOccurrences(occurrences);
    }

    private collectEnumMemberMetadataOccurrences(
        entry: SemanticIdentifierEntry,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (!Core.isNonEmptyString(entry.name) || !Core.isNonEmptyString(entry.enumName)) {
            return;
        }

        const enumMemberReferenceText = `${entry.enumName}.${entry.name}`;
        for (const metadataPath of this.listEnumMemberMetadataCandidatePaths()) {
            const absoluteMetadataPath = path.resolve(this.projectRoot, metadataPath);
            if (!pathExistsSync(absoluteMetadataPath)) {
                continue;
            }

            const metadataSource = fs.readFileSync(absoluteMetadataPath, "utf8");
            let searchStart = 0;
            while (searchStart < metadataSource.length) {
                const referenceStart = metadataSource.indexOf(enumMemberReferenceText, searchStart);
                if (referenceStart === -1) {
                    break;
                }

                const referenceEnd = referenceStart + enumMemberReferenceText.length;
                searchStart = referenceEnd;
                if (!isIdentifierBoundary(metadataSource[referenceStart - 1])) {
                    continue;
                }

                if (!isIdentifierBoundary(metadataSource[referenceEnd])) {
                    continue;
                }

                occurrences.push({
                    path: metadataPath,
                    start: referenceStart + entry.enumName.length + 1,
                    end: referenceEnd,
                    kind: "reference"
                });
            }
        }
    }

    private listEnumMemberMetadataCandidatePaths(): Array<string> {
        const candidatePaths = new Set<string>();

        for (const [resourcePath, resource] of Object.entries(this.resources)) {
            if (isRefactorOwnerMetadataPath(resourcePath)) {
                candidatePaths.add(resourcePath);
            }

            if (Core.isNonEmptyString(resource.path) && isRefactorOwnerMetadataPath(resource.path)) {
                candidatePaths.add(resource.path);
            }
        }

        return [...candidatePaths];
    }

    private collectUnresolvedEnumMemberOccurrences(
        entry: SemanticIdentifierEntry,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (!entry.identifierId?.startsWith("enum-member:")) {
            return;
        }

        if (!Core.isNonEmptyString(entry.name) || !Core.isNonEmptyString(entry.enumName)) {
            return;
        }

        for (const unresolvedReference of this.getIndexes().unresolvedReferencesByExactName.get(entry.name) ?? []) {
            const classifications = Core.asArray(unresolvedReference.reference.classifications);
            if (!classifications.includes("property")) {
                continue;
            }

            const start = readSemanticLocationIndex(unresolvedReference.reference.start);
            const end = readExclusiveSemanticLocationIndex(unresolvedReference.reference.end);

            if (start === null || end === null || end <= start) {
                continue;
            }

            const exactRange = this.resolveEnumMemberReferenceRange({
                filePath: unresolvedReference.filePath,
                startIndex: start,
                endIndex: end,
                enumName: entry.enumName,
                memberName: entry.name
            });

            if (exactRange === null) {
                continue;
            }

            occurrences.push({
                path: unresolvedReference.filePath,
                start: exactRange.start,
                end: exactRange.end,
                scopeId:
                    typeof unresolvedReference.reference.scopeId === "string"
                        ? unresolvedReference.reference.scopeId
                        : undefined,
                kind: "reference"
            });
        }

        this.collectProjectFileEnumMemberOccurrences(entry, occurrences);
        this.collectSourceBackedEnumMemberDottedOccurrences(entry, occurrences);
    }

    private collectSourceBackedEnumMemberDottedOccurrences(
        entry: SemanticIdentifierEntry,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (!Core.isNonEmptyString(entry.name) || !Core.isNonEmptyString(entry.enumName)) {
            return;
        }

        for (const filePath of Object.keys(this.projectIndex.files ?? {})) {
            const sourceText = this.readProjectSourceText(filePath);
            if (sourceText === null) {
                continue;
            }

            this.collectDottedEnumMemberOccurrencesFromSource({
                filePath,
                sourceText,
                enumName: entry.enumName,
                memberName: entry.name,
                occurrences
            });
        }
    }

    private collectDottedEnumMemberOccurrencesFromSource(parameters: {
        filePath: string;
        sourceText: string;
        enumName: string;
        memberName: string;
        occurrences: Array<SymbolOccurrence>;
    }): void {
        const scanState = Core.createStringCommentScanState();
        const sourceLength = parameters.sourceText.length;
        let index = 0;

        while (index < sourceLength) {
            const scannedIndex = Core.advanceStringCommentScan(
                parameters.sourceText,
                sourceLength,
                index,
                scanState,
                true
            );
            if (scannedIndex !== index) {
                index = scannedIndex;
                continue;
            }

            if (
                isIdentifierTokenAt(parameters.sourceText, index, parameters.memberName) &&
                this.readDottedReferenceOwnerName(parameters.filePath, index) === parameters.enumName
            ) {
                parameters.occurrences.push({
                    path: parameters.filePath,
                    start: index,
                    end: index + parameters.memberName.length,
                    kind: "reference"
                });
                index += parameters.memberName.length;
                continue;
            }

            index += 1;
        }
    }

    private collectProjectFileEnumMemberOccurrences(
        entry: SemanticIdentifierEntry,
        occurrences: Array<SymbolOccurrence>
    ): void {
        if (!Core.isNonEmptyString(entry.name) || !Core.isNonEmptyString(entry.enumName)) {
            return;
        }

        for (const [filePath, fileRecord] of Object.entries(this.projectIndex.files ?? {})) {
            const typedFileRecord = fileRecord as SemanticFileRecord;
            for (const reference of typedFileRecord.references ?? []) {
                if (!Core.isObjectLike(reference) || reference.name !== entry.name) {
                    continue;
                }

                const classifications = Core.asArray(reference.classifications);
                if (!classifications.includes("property")) {
                    continue;
                }

                const start = readSemanticLocationIndex(reference.start);
                const end = readExclusiveSemanticLocationIndex(reference.end);
                if (start === null || end === null || end <= start) {
                    continue;
                }

                const exactRange = this.resolveEnumMemberReferenceRange({
                    filePath,
                    startIndex: start,
                    endIndex: end,
                    enumName: entry.enumName,
                    memberName: entry.name
                });
                if (exactRange === null) {
                    continue;
                }

                occurrences.push({
                    path: filePath,
                    start: exactRange.start,
                    end: exactRange.end,
                    scopeId: typeof reference.scopeId === "string" ? reference.scopeId : undefined,
                    kind: "reference"
                });
            }
        }
    }

    private resolveEnumMemberReferenceRange(parameters: {
        filePath: string;
        startIndex: number;
        endIndex: number;
        enumName: string;
        memberName: string;
    }): { start: number; end: number } | null {
        const sourceText = this.readProjectSourceText(parameters.filePath);
        if (
            sourceText === null ||
            parameters.startIndex < 0 ||
            parameters.endIndex <= parameters.startIndex ||
            parameters.endIndex > sourceText.length ||
            !Core.isNonEmptyString(parameters.enumName) ||
            !Core.isNonEmptyString(parameters.memberName)
        ) {
            return null;
        }

        const candidateStarts = [parameters.startIndex];
        let searchStart = parameters.startIndex + 1;
        while (searchStart < parameters.endIndex) {
            const candidateStart = sourceText.indexOf(parameters.memberName, searchStart);
            if (candidateStart === -1 || candidateStart >= parameters.endIndex) {
                break;
            }
            candidateStarts.push(candidateStart);
            searchStart = candidateStart + 1;
        }

        for (const candidateStart of candidateStarts) {
            if (
                isIdentifierTokenAt(sourceText, candidateStart, parameters.memberName) &&
                this.readDottedReferenceOwnerName(parameters.filePath, candidateStart) === parameters.enumName
            ) {
                return {
                    start: candidateStart,
                    end: candidateStart + parameters.memberName.length
                };
            }
        }

        return null;
    }

    private isKnownEnumMemberReference(filePath: string, startIndex: number): boolean {
        const ownerName = this.readDottedReferenceOwnerName(filePath, startIndex);
        if (!Core.isNonEmptyString(ownerName)) {
            return false;
        }

        return this.getEnumNames().has(ownerName);
    }

    /**
     * Determine whether an unresolved same-name reference is already recorded
     * as a resolved constructor static member reference in the semantic index.
     *
     * The semantic project index records constructor static member references
     * through receiver-type analysis (e.g. `pos.Sub` resolves to `Vector2.Sub`
     * when `self.pos = new Vector2(...)`). These references also appear in the
     * unresolved file-level reference list because the general file-reference
     * resolution does not yet model constructor receiver types. The bridge must
     * consult the constructor static member collection so that a project-wide
     * rename is not blocked by an unresolved reference that is in fact
     * semantically resolved through constructor-owned receiver facts.
     */
    private isResolvedConstructorStaticMemberReference(
        symbolName: string,
        filePath: string,
        startIndex: number,
        endIndex: number
    ): boolean {
        if (!Core.isNonEmptyString(symbolName)) {
            return false;
        }

        const constructorStaticMembers = this.identifiers.constructorStaticMembers ?? {};
        for (const entry of Object.values(constructorStaticMembers)) {
            if (!entry || typeof entry !== "object") {
                continue;
            }

            if (entry.name !== symbolName) {
                continue;
            }

            for (const reference of entry.references ?? []) {
                if (typeof reference?.filePath !== "string" || reference.filePath !== filePath) {
                    continue;
                }

                const referenceStart = readSemanticLocationIndex(reference.start);
                const referenceEnd = readExclusiveSemanticLocationIndex(reference.end);
                if (referenceStart === null || referenceEnd === null) {
                    continue;
                }

                if (referenceStart === startIndex && referenceEnd === endIndex) {
                    return true;
                }
            }
        }

        return false;
    }

    private readDottedReferenceOwnerName(filePath: string, startIndex: number): string | null {
        const sourceText = this.readProjectSourceText(filePath);
        if (sourceText === null || startIndex <= 0 || startIndex > sourceText.length) {
            return null;
        }

        let cursor = startIndex - 1;
        while (cursor >= 0 && /\s/u.test(sourceText[cursor] ?? "")) {
            cursor -= 1;
        }

        if (cursor < 0 || sourceText[cursor] !== ".") {
            return null;
        }

        cursor -= 1;
        while (cursor >= 0 && /\s/u.test(sourceText[cursor] ?? "")) {
            cursor -= 1;
        }

        const objectEnd = cursor + 1;
        while (cursor >= 0 && /[A-Za-z0-9_]/u.test(sourceText[cursor] ?? "")) {
            cursor -= 1;
        }

        const objectName = sourceText.slice(cursor + 1, objectEnd);
        return objectName.length > 0 ? objectName : null;
    }

    private async preloadProjectSourceText(filePath: string): Promise<void> {
        if (this.sourceTextByPath.has(filePath)) {
            return;
        }

        try {
            const sourceText = this.readFile
                ? await this.readFile(filePath)
                : await fs.promises.readFile(path.resolve(this.projectRoot, filePath), "utf8");
            this.sourceTextByPath.set(filePath, sourceText);
        } catch {
            this.sourceTextByPath.set(filePath, null);
        }
    }

    private readProjectSourceText(filePath: string): string | null {
        if (this.sourceTextByPath.has(filePath)) {
            return this.sourceTextByPath.get(filePath) ?? null;
        }

        const absolutePath = path.resolve(this.projectRoot, filePath);
        if (!pathExistsSync(absolutePath)) {
            this.sourceTextByPath.set(filePath, null);
            return null;
        }

        try {
            const sourceText = fs.readFileSync(absolutePath, "utf8");
            this.sourceTextByPath.set(filePath, sourceText);
            return sourceText;
        } catch {
            this.sourceTextByPath.set(filePath, null);
            return null;
        }
    }

    private resolveLocalNamingConventionCategory(
        filePath: string,
        declaration: Record<string, unknown>,
        sourceText: string | null
    ): Extract<BridgeNamingConventionCategory, "localVariable" | "loopIndexVariable" | "staticVariable"> {
        const startIndex = readSemanticLocationIndex(declaration.start);
        if (typeof declaration.name !== "string" || startIndex === null) {
            return "localVariable";
        }

        return (
            this.localNamingCategoryResolver.resolveCategory(filePath, sourceText, declaration.name, startIndex) ??
            "localVariable"
        );
    }

    private isConstructorStaticMemberDeclaration(
        filePath: string,
        declaration: Record<string, unknown>,
        sourceText: string | null
    ): boolean {
        const startIndex = readSemanticLocationIndex(declaration.start);
        if (typeof declaration.name !== "string" || startIndex === null) {
            return false;
        }

        if (
            !this.localNamingCategoryResolver.isConstructorStaticMember(
                filePath,
                sourceText,
                declaration.name,
                startIndex
            )
        ) {
            return false;
        }

        return true;
    }

    private getEnumNames(): ReadonlySet<string> {
        const cachedEnumNames = this.enumNames;
        if (cachedEnumNames !== null) {
            return cachedEnumNames;
        }

        const enumNames = new Set<string>();
        for (const entry of Object.values(this.identifiers.enums ?? {})) {
            if (typeof entry?.name === "string") {
                enumNames.add(entry.name);
            }
        }

        this.enumNames = enumNames;
        return enumNames;
    }

    private getScriptNames(): ReadonlySet<string> {
        const cachedScriptNames = this.scriptNames;
        if (cachedScriptNames !== null) {
            return cachedScriptNames;
        }

        const scriptNames = new Set<string>();
        for (const entry of Object.values(this.identifiers.scripts ?? {})) {
            if (typeof entry?.name === "string") {
                scriptNames.add(entry.name);
            }
            if (Array.isArray(entry?.declarations)) {
                for (const decl of entry.declarations) {
                    const classifications = Core.asArray(decl.classifications);
                    if (
                        (classifications.includes("script") ||
                            classifications.includes("constructor") ||
                            classifications.includes("function")) &&
                        typeof decl.name === "string"
                    ) {
                        scriptNames.add(decl.name);
                    }
                }
            }
        }

        this.scriptNames = scriptNames;
        return scriptNames;
    }

    private getMacroNames(): ReadonlySet<string> {
        const cachedMacroNames = this.macroNames;
        if (cachedMacroNames !== null) {
            return cachedMacroNames;
        }

        const macroNames = new Set<string>();
        for (const entry of Object.values(this.identifiers.macros ?? {})) {
            if (typeof entry?.name === "string") {
                macroNames.add(entry.name);
            }
        }

        this.macroNames = macroNames;
        return macroNames;
    }

    private findResourceByName(name: string, caseInsensitive = false): any {
        const indexes = this.getIndexes();
        if (caseInsensitive) {
            return indexes.resourcesByLowerName.get(name.toLowerCase()) ?? null;
        }

        return indexes.resourcesByExactName.get(name) ?? null;
    }

    private generateResourceScipId(resource: any): string {
        return generateResourceScipId(resource);
    }

    private createSyntheticResourceEntry(resource: any, symbolId: string): any {
        return makeSyntheticResourceEntry(resource, symbolId);
    }

    private generateScipId(entry: any, nestedName?: string): string {
        return generateIdentifierEntryScipId(entry, nestedName);
    }

    private testNameMatch(symbolIds: Set<string>, name: string): boolean {
        return matchesSymbolIdSet(symbolIds, name);
    }
}
