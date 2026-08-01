/**
 * Project metadata mutation pipeline for the GML refactor bridge.
 *
 * This module owns the logic that rewrites GameMaker project metadata files
 * (`.yy`, `.yyp`, and `.resource_order`) when a resource is renamed.  The
 * pipeline maintains its own caches for parsed metadata documents, source
 * text, and per-edit mutable document state so that multiple
 * `WorkspaceEdit` plans can be assembled from the same bridge without
 * leaking intermediate state between them.
 *
 * Splitting this concern out of {@link ./semantic-bridge.ts} keeps the
 * bridge's public role (ProjectIndex → refactor engine adapter) free of
 * metadata-mutation state and makes the mutation pipeline independently
 * testable.  The `GmlSemanticBridge` delegates to a
 * {@link ProjectMetadataMutationContext} instance while preserving its
 * public surface and behaviour.
 */

import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";

import { pathExistsSync } from "../../shared/path-exists.js";
import { resolveRenamedSoundFileName } from "./resource-sidecar-renames.js";

type ResourceAssetReferenceRecord = {
    propertyPath: string;
    targetPath: string;
};

type ResourceMetadataRecord = {
    assetReferences: Array<ResourceAssetReferenceRecord>;
    path: string;
};

export type ProjectMetadataReferenceIndex = {
    manifestMetadataRecords: Array<ResourceMetadataRecord>;
    metadataRecordsByPath: Map<string, ResourceMetadataRecord>;
    referencingMetadataRecordsByLowerTargetPath: Map<string, Array<ResourceMetadataRecord>>;
    referencingMetadataRecordsByTargetPath: Map<string, Array<ResourceMetadataRecord>>;
};

type MutableProjectMetadataDocument = {
    parsed: Record<string, unknown>;
    rawContent: string;
};

export type SemanticResourceRecord = {
    name?: string;
    path?: string;
    resourceType?: string;
};

type ProjectMetadataStringMutation = {
    propertyPath: string;
    value: string;
};

const normalizedMetadataReferenceTargetPathCache = new Map<string, string>();

export function isResourceAssetReferenceRecord(value: unknown): value is ResourceAssetReferenceRecord {
    if (!Core.isObjectLike(value)) {
        return false;
    }
    const reference = value as Record<string, unknown>;

    return typeof reference.propertyPath === "string" && typeof reference.targetPath === "string";
}

export function normalizeResourceMetadataRecord(value: unknown): ResourceMetadataRecord | null {
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

export function normalizeMetadataReferenceTargetPath(targetPath: string): string {
    const cachedNormalizedPath = normalizedMetadataReferenceTargetPathCache.get(targetPath);
    if (cachedNormalizedPath !== undefined) {
        return cachedNormalizedPath;
    }

    const normalizedPath = targetPath.replaceAll("\\", "/").toLowerCase();
    normalizedMetadataReferenceTargetPathCache.set(targetPath, normalizedPath);
    return normalizedPath;
}

export function metadataReferenceTargetMatchesNormalizedPath(
    candidatePath: string,
    normalizedTargetPath: string
): boolean {
    return normalizeMetadataReferenceTargetPath(candidatePath) === normalizedTargetPath;
}

export function appendProjectMetadataStringMutation(
    stringMutations: Array<ProjectMetadataStringMutation>,
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

export function updateRoomInstanceCreationOrderSelfPaths({
    parsed,
    normalizedOldResourcePath,
    newResourcePath,
    stringMutations
}: {
    parsed: Record<string, unknown>;
    normalizedOldResourcePath: string;
    newResourcePath: string;
    stringMutations: Array<ProjectMetadataStringMutation>;
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

export function requiresMetadataResourcePathOrderNormalization(rawContent: string): boolean {
    const resourceTypeIndex = rawContent.indexOf('"resourceType"');
    const resourcePathIndex = rawContent.indexOf('"resourcePath"');
    if (resourceTypeIndex === -1 || resourcePathIndex === -1) {
        return false;
    }

    return resourceTypeIndex > resourcePathIndex;
}

export function getProjectResourceOrderPath(projectRoot: string): string {
    return `${path.basename(path.resolve(projectRoot))}.resource_order`;
}

/**
 * Mutable workspace edit interface used by the metadata mutation pipeline.
 *
 * Matches the `WorkspaceEdit` shape produced by
 * {@link ./semantic-bridge.ts}'s `createWorkspaceEdit` factory.  Defined
 * structurally so this module does not need to import any private types
 * from the bridge file.
 */
type MutableWorkspaceEdit = {
    addMetadataEdit(path: string, content: string): void;
    addMetadataObjectEdit?(path: string, document: Record<string, unknown>): void;
};

/**
 * Resources lookup callback that the mutation context uses to enumerate
 * the current set of project resources when (re)building the metadata
 * reference index.  Decoupled from the bridge so the context can be
 * constructed and tested in isolation.
 */
export type ProjectResourcesLookup = () => Record<string, SemanticResourceRecord>;

/**
 * Encapsulates the metadata-mutation state and pipeline that
 * `GmlSemanticBridge` previously owned in-line.
 *
 * The context holds three layers of caching:
 *
 * 1. **Project metadata** — parsed `.yy`/`.yyp`/`.resource_order`
 *    documents keyed by their project-relative path.  Populated lazily
 *    on first rename and reused across `WorkspaceEdit` plans.
 * 2. **Staged metadata** — `WorkspaceEdit`-batched metadata rewrites
 *    staged for inclusion in subsequent rename plans via
 *    {@link stageMetadataEdit}.  Cleared by {@link clear}.
 * 3. **Per-edit mutable documents** — `WorkspaceEdit`-keyed snapshots of
 *    the parsed document that allow successive `addResourceMetadataEdits`
 *    calls to compose without re-reading the file or re-parsing prior
 *    edits.
 *
 * The context is the sole owner of these caches.  The bridge treats it
 * as an opaque collaborator and only asks it to perform the mutation
 * steps the bridge used to perform itself.
 */
export class ProjectMetadataMutationContext {
    private readonly parsedProjectMetadataByPath = new Map<string, Record<string, unknown>>();
    private readonly projectMetadataSourceByPath = new Map<string, string>();
    private readonly stagedMetadataContents = new Map<string, string>();
    private readonly stagedParsedMetadata = new Map<string, Record<string, unknown>>();
    private readonly stagedMetadataParseFailures = new Set<string>();
    private readonly generatedMetadataDocumentsByPath = new Map<
        string,
        { content: string; document: Record<string, unknown> }
    >();
    private readonly latestBatchMetadataDocumentsByEdit = new WeakMap<
        MutableWorkspaceEdit,
        { documents: Map<string, Record<string, unknown>>; metadataObjectCount: number }
    >();
    private readonly mutableProjectMetadataDocumentsByEdit = new WeakMap<
        MutableWorkspaceEdit,
        Map<string, MutableProjectMetadataDocument | null>
    >();
    private projectMetadataReferenceIndex: ProjectMetadataReferenceIndex | null = null;

    constructor(
        private readonly projectRoot: string,
        private readonly getResources: ProjectResourcesLookup
    ) {}

    /**
     * Reset every cache owned by this context.  Called when the bridge
     * receives a new `ProjectIndex` so the mutation pipeline never
     * carries stale parsed documents across project revisions.
     */
    clear(): void {
        this.projectMetadataReferenceIndex = null;
        this.projectMetadataSourceByPath.clear();
        this.parsedProjectMetadataByPath.clear();
        this.stagedMetadataContents.clear();
        this.stagedParsedMetadata.clear();
        this.stagedMetadataParseFailures.clear();
        this.generatedMetadataDocumentsByPath.clear();
    }

    /**
     * Stage a metadata rewrite from a planned workspace edit so that
     * subsequent rename planning can build on the already-planned
     * metadata state.
     */
    stageMetadataEdit(edit: { content: string; path: string }): void {
        if (typeof edit.path !== "string" || typeof edit.content !== "string") {
            return;
        }

        this.stagedMetadataContents.set(edit.path, edit.content);
        const generatedMetadataDocument = this.generatedMetadataDocumentsByPath.get(edit.path);
        if (generatedMetadataDocument?.content === edit.content) {
            this.stagedParsedMetadata.set(edit.path, generatedMetadataDocument.document);
        } else {
            this.stagedParsedMetadata.delete(edit.path);
        }
        this.stagedMetadataParseFailures.delete(edit.path);
    }

    /**
     * Build (or return the cached) reference index that maps every
     * project metadata path to the set of asset references it owns.
     */
    getProjectMetadataReferenceIndex(): ProjectMetadataReferenceIndex {
        const existingIndex = this.projectMetadataReferenceIndex;
        if (existingIndex !== null) {
            return existingIndex;
        }

        const manifestMetadataRecords: Array<ResourceMetadataRecord> = [];
        const metadataRecordsByPath = new Map<string, ResourceMetadataRecord>();
        const referencingMetadataRecordsByLowerTargetPath = new Map<string, Array<ResourceMetadataRecord>>();
        const referencingMetadataRecordsByTargetPath = new Map<string, Array<ResourceMetadataRecord>>();

        for (const resourceRecord of Object.values(this.getResources())) {
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

        const createdIndex: ProjectMetadataReferenceIndex = {
            manifestMetadataRecords,
            metadataRecordsByPath,
            referencingMetadataRecordsByLowerTargetPath,
            referencingMetadataRecordsByTargetPath
        };
        this.projectMetadataReferenceIndex = createdIndex;
        return createdIndex;
    }

    /**
     * Load and cache the parsed metadata document for a single resource,
     * without entering the per-edit mutable snapshot lifecycle used by
     * {@link addResourceMetadataEdits}.
     */
    loadResourceMetadataDocumentForRename(resourcePath: string): Record<string, unknown> {
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

    /**
     * Enumerate every metadata record that could plausibly contain a
     * reference to `resourcePath`, including the direct resource record,
     * the project manifest, and all records that mention the resource as
     * an asset reference.
     */
    listResourceMetadataMutationCandidates(resourcePath: string): Array<ResourceMetadataRecord> {
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

    /**
     * Collect the latest batch of metadata document objects from a
     * `WorkspaceEdit`, caching the result per edit so repeated calls
     * during a single planning pass remain cheap.
     */
    private collectLatestBatchMetadataDocuments(edit: MutableWorkspaceEdit): Map<string, Record<string, unknown>> {
        const metadataObjectCount = (edit as { metadataObjects?: Array<unknown> }).metadataObjects?.length ?? 0;
        const cachedEntry = this.latestBatchMetadataDocumentsByEdit.get(edit);
        if (cachedEntry && cachedEntry.metadataObjectCount === metadataObjectCount) {
            return cachedEntry.documents;
        }

        const latestBatchMetadataDocuments = new Map<string, Record<string, unknown>>();

        for (const metadataObject of (
            edit as { metadataObjects?: Array<{ document: Record<string, unknown>; path: string }> }
        ).metadataObjects ?? []) {
            latestBatchMetadataDocuments.set(metadataObject.path, metadataObject.document);
        }

        this.latestBatchMetadataDocumentsByEdit.set(edit, {
            documents: latestBatchMetadataDocuments,
            metadataObjectCount
        });
        return latestBatchMetadataDocuments;
    }

    /**
     * Resolve (or create) the mutable snapshot of a metadata document
     * associated with the given `WorkspaceEdit`.  The snapshot is
     * isolated from other edits so that composing successive rename
     * plans does not mutate the underlying parsed cache.
     */
    private loadMutableProjectMetadataDocument(
        edit: MutableWorkspaceEdit,
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

    /**
     * Compose every metadata rewrite required to rename a resource.
     *
     * Walks each candidate metadata record produced by
     * {@link listResourceMetadataMutationCandidates}, mutates the per-edit
     * snapshot of the parsed document, then emits a final canonical
     * representation back onto the `WorkspaceEdit`.  This method is the
     * public entry point that the bridge uses to materialise rename
     * edits.
     */
    addResourceMetadataEdits(
        edit: MutableWorkspaceEdit,
        resource: SemanticResourceRecord,
        oldName: string,
        newName: string,
        currentResourcePath: string
    ): void {
        if (!resource?.path) {
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
            const stringMutations: Array<ProjectMetadataStringMutation> = [];

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
        stringMutations: Array<ProjectMetadataStringMutation>
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
        edit: MutableWorkspaceEdit,
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
        const stringMutations: Array<ProjectMetadataStringMutation> = [];

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
}
