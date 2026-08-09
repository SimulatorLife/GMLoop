import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import { locateObjectReference, locateSpriteReference, type ResourceReference } from "./room-resource-helpers.js";

/**
 * Parameters for updating refactor-safe GameMaker object metadata.
 *
 * Every field is optional and independently applied: omit a field to leave
 * the corresponding object property unchanged. Pass `null` for
 * `parentObjectName` or `spriteName` to clear an existing reference.
 */
export interface UpdateObjectPropertiesRequest {
    dryRun?: boolean;
    objectName: string;
    parentObjectName?: string | null;
    persistent?: boolean;
    projectRoot: string;
    solid?: boolean;
    spriteName?: string | null;
    visible?: boolean;
}

/**
 * Summary returned after an object property mutation.
 */
export interface ObjectPropertyMutationResult {
    action: "update";
    changed: boolean;
    dryRun: boolean;
    objectName: string;
    objectPath: string;
    parentObjectName: string | null;
    persistent: boolean;
    solid: boolean;
    spriteName: string | null;
    visible: boolean;
    warnings: Array<string>;
    writtenPaths: Array<string>;
}

function readObjectReferenceField(objectDocument: Record<string, unknown>, fieldName: string): string | null {
    const reference = objectDocument[fieldName];
    if (!Core.isObjectLike(reference)) {
        return null;
    }
    return Core.getNonEmptyString((reference as Record<string, unknown>).name);
}

function readObjectBooleanField(objectDocument: Record<string, unknown>, fieldName: string): boolean {
    return objectDocument[fieldName] === true;
}

async function writeObjectDocumentIfApplying(
    dryRun: boolean,
    objectAbsolutePath: string,
    objectDocument: Record<string, unknown>
): Promise<void> {
    if (dryRun) {
        return;
    }

    await writeFile(
        objectAbsolutePath,
        `${Core.stringifyProjectMetadataDocument(objectDocument, objectAbsolutePath)}\n`,
        "utf8"
    );
}

/**
 * Update refactor-safe GameMaker object properties such as sprite, parent
 * object, visibility, solidity, and persistence.
 *
 * @param request - Object property update request.
 * @returns Summary of the planned or applied object metadata mutation.
 */
export async function updateObjectProperties(
    request: UpdateObjectPropertiesRequest
): Promise<ObjectPropertyMutationResult> {
    if (
        request.spriteName === undefined &&
        request.parentObjectName === undefined &&
        request.visible === undefined &&
        request.solid === undefined &&
        request.persistent === undefined
    ) {
        throw new TypeError(
            "Object update requires at least one of --sprite, --parent, --visible, --solid, or --persistent."
        );
    }

    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);
    const objectReference = locateObjectReference(manifestResources, request.objectName);
    const objectAbsolutePath = path.join(projectRoot, Core.fromPosixPath(objectReference.path));
    const objectDocument = await readProjectMetadataDocument(objectAbsolutePath);

    const previousSpriteName = readObjectReferenceField(objectDocument, "spriteId");
    const previousParentObjectName = readObjectReferenceField(objectDocument, "parentObjectId");
    const previousVisible = readObjectBooleanField(objectDocument, "visible");
    const previousSolid = readObjectBooleanField(objectDocument, "solid");
    const previousPersistent = readObjectBooleanField(objectDocument, "persistent");

    let nextSpriteReference: ResourceReference | null = null;
    if (request.spriteName !== undefined && request.spriteName !== null) {
        nextSpriteReference = locateSpriteReference(manifestResources, request.spriteName);
    }
    let nextParentReference: ResourceReference | null = null;
    if (request.parentObjectName !== undefined && request.parentObjectName !== null) {
        nextParentReference = locateObjectReference(manifestResources, request.parentObjectName);
    }

    if (request.spriteName !== undefined) {
        objectDocument.spriteId = nextSpriteReference;
    }
    if (request.parentObjectName !== undefined) {
        objectDocument.parentObjectId = nextParentReference;
    }
    if (request.visible !== undefined) {
        objectDocument.visible = request.visible;
    }
    if (request.solid !== undefined) {
        objectDocument.solid = request.solid;
    }
    if (request.persistent !== undefined) {
        objectDocument.persistent = request.persistent;
    }

    const nextSpriteName = request.spriteName === undefined ? previousSpriteName : (nextSpriteReference?.name ?? null);
    const nextParentObjectName =
        request.parentObjectName === undefined ? previousParentObjectName : (nextParentReference?.name ?? null);
    const nextVisible = request.visible ?? previousVisible;
    const nextSolid = request.solid ?? previousSolid;
    const nextPersistent = request.persistent ?? previousPersistent;

    const changed =
        nextSpriteName !== previousSpriteName ||
        nextParentObjectName !== previousParentObjectName ||
        nextVisible !== previousVisible ||
        nextSolid !== previousSolid ||
        nextPersistent !== previousPersistent;

    const dryRun = request.dryRun !== false;
    await writeObjectDocumentIfApplying(dryRun, objectAbsolutePath, objectDocument);

    return {
        action: "update",
        changed,
        dryRun,
        objectName: objectReference.name,
        objectPath: objectReference.path,
        parentObjectName: nextParentObjectName,
        persistent: nextPersistent,
        solid: nextSolid,
        spriteName: nextSpriteName,
        visible: nextVisible,
        warnings: [],
        writtenPaths: [objectReference.path]
    };
}
