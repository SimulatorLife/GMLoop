import { randomUUID } from "node:crypto";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    type ProjectManifestEntry,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import {
    assertFiniteCoordinate,
    locateObjectReference,
    locateRoomReference,
    type ResourceReference,
    writeRoomDocumentIfApplying
} from "./room-resource-helpers.js";

const INSTANCE_LAYER_RESOURCE_TYPE = "GMRInstanceLayer";
const ROOM_INSTANCE_RESOURCE_TYPE = "GMRInstance";
const ROOM_INSTANCE_NAME_PREFIX = "inst_";

type RoomInstanceLayerRecord = Record<string, unknown> & {
    instances: Array<unknown>;
};

type LocatedRoomInstance = Readonly<{
    index: number;
    instance: Record<string, unknown>;
}>;

type RoomInstanceMutationContext = Readonly<{
    instanceLayer: RoomInstanceLayerRecord;
    manifestResources: ReadonlyArray<ProjectManifestEntry>;
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
}>;

/**
 * Parameters for adding an object instance to a GameMaker room instance layer.
 */
export interface AddRoomInstanceRequest {
    dryRun?: boolean;
    objectName: string;
    projectRoot: string;
    roomName: string;
    x: number;
    y: number;
}

/**
 * Parameters for moving an existing object instance inside a GameMaker room.
 */
export interface UpdateRoomInstanceRequest {
    dryRun?: boolean;
    instanceId: string;
    projectRoot: string;
    roomName: string;
    x: number;
    y: number;
}

/**
 * Parameters for deleting an existing object instance from a GameMaker room.
 */
export interface DeleteRoomInstanceRequest {
    dryRun?: boolean;
    instanceId: string;
    projectRoot: string;
    roomName: string;
}

/**
 * Parameters for moving an existing object instance to a different instance
 * layer inside a GameMaker room.
 */
export interface MoveRoomInstanceToLayerRequest {
    dryRun?: boolean;
    instanceId: string;
    projectRoot: string;
    roomName: string;
    targetLayerName: string;
}

/**
 * Parameters for inspecting one GameMaker room instance.
 */
export interface InspectRoomInstanceRequest {
    instanceId: string;
    projectRoot: string;
    roomName: string;
}

/**
 * Parameters for listing GameMaker room instances.
 */
export interface ListRoomInstancesRequest {
    projectRoot: string;
    roomName: string;
}

/**
 * Summary returned after a room instance mutation.
 */
export interface RoomInstanceMutationResult {
    action: "add" | "delete" | "move" | "update";
    deletedPaths: Array<string>;
    dryRun: boolean;
    instanceId: string;
    layerName: string;
    objectName: string;
    objectPath: string;
    roomName: string;
    roomPath: string;
    warnings: Array<string>;
    writtenPaths: Array<string>;
    x: number;
    y: number;
}

/**
 * Read-only summary of an object instance placed in a GameMaker room.
 */
export interface RoomInstanceInspectionResult {
    instanceId: string;
    layerName: string;
    objectName: string;
    objectPath: string;
    roomName: string;
    roomPath: string;
    x: number;
    y: number;
}

/**
 * Collect every top-level instance layer declared by a room document,
 * normalizing each layer's `instances` array to a fresh mutable copy so
 * callers can safely splice/push without mutating the parsed document until
 * the mutation is ready to be written.
 */
function findAllInstanceLayers(roomDocument: Record<string, unknown>): Array<RoomInstanceLayerRecord> {
    const layers = Core.asArray(roomDocument.layers);
    const instanceLayers: Array<RoomInstanceLayerRecord> = [];

    for (const layer of layers) {
        if (!Core.isObjectLike(layer)) {
            continue;
        }

        const layerRecord = layer as Record<string, unknown>;
        const resourceType = Core.getNonEmptyString(layerRecord.resourceType);
        if (resourceType !== INSTANCE_LAYER_RESOURCE_TYPE) {
            continue;
        }

        const existingInstances = Core.asArray(layerRecord.instances);
        layerRecord.instances = [...existingInstances];
        instanceLayers.push(layerRecord as RoomInstanceLayerRecord);
    }

    return instanceLayers;
}

function findInstanceLayer(roomDocument: Record<string, unknown>, roomName: string): RoomInstanceLayerRecord {
    const instanceLayer = findAllInstanceLayers(roomDocument)[0];
    if (instanceLayer === undefined) {
        throw new Error(`Room '${roomName}' does not contain a ${INSTANCE_LAYER_RESOURCE_TYPE} layer.`);
    }
    return instanceLayer;
}

function findInstanceLayerByName(
    roomDocument: Record<string, unknown>,
    roomName: string,
    layerName: string
): RoomInstanceLayerRecord {
    const instanceLayer = findAllInstanceLayers(roomDocument).find(
        (layer) =>
            Core.getNonEmptyString(layer.name) === layerName || Core.getNonEmptyString(layer["%Name"]) === layerName
    );
    if (instanceLayer === undefined) {
        throw new Error(`Room '${roomName}' does not contain an instance layer named '${layerName}'.`);
    }
    return instanceLayer;
}

/**
 * Locate an object instance by id across every instance layer in a room,
 * regardless of which layer currently holds it.
 */
function locateRoomInstanceAcrossLayers(
    roomDocument: Record<string, unknown>,
    roomName: string,
    instanceId: string
): Readonly<{ layer: RoomInstanceLayerRecord; located: LocatedRoomInstance }> {
    for (const layer of findAllInstanceLayers(roomDocument)) {
        for (const [index, instance] of layer.instances.entries()) {
            if (!Core.isObjectLike(instance)) {
                continue;
            }
            const instanceRecord = instance as Record<string, unknown>;
            if (getRoomInstanceName(instanceRecord) === instanceId) {
                return Object.freeze({ layer, located: Object.freeze({ index, instance: instanceRecord }) });
            }
        }
    }

    throw new Error(`Could not find room instance '${instanceId}' in room '${roomName}'.`);
}

function createRoomInstance(instanceId: string, objectReference: ResourceReference, x: number, y: number) {
    return {
        $GMRInstance: "v1",
        "%Name": instanceId,
        colour: 4_294_967_295,
        frozen: false,
        hasCreationCode: false,
        ignore: false,
        imageIndex: 0,
        imageSpeed: 1,
        inheritCode: false,
        inCreationOrder: true,
        isDnd: false,
        name: instanceId,
        objectId: {
            name: objectReference.name,
            path: objectReference.path
        },
        properties: [],
        resourceType: ROOM_INSTANCE_RESOURCE_TYPE,
        resourceVersion: "2.0",
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        x,
        y
    };
}

function appendRoomInstanceCreationOrder(
    roomDocument: Record<string, unknown>,
    instanceId: string,
    roomPath: string
): void {
    roomDocument.instanceCreationOrder = [
        ...Core.asArray(roomDocument.instanceCreationOrder),
        {
            name: instanceId,
            path: roomPath
        }
    ];
}

function removeRoomInstanceCreationOrder(roomDocument: Record<string, unknown>, instanceId: string): void {
    roomDocument.instanceCreationOrder = Core.asArray(roomDocument.instanceCreationOrder).filter((entry) => {
        if (!Core.isObjectLike(entry)) {
            return true;
        }
        return Core.getNonEmptyString((entry as Record<string, unknown>).name) !== instanceId;
    });
}

function getRoomInstanceName(instance: Record<string, unknown>): string | null {
    return Core.getNonEmptyString(instance.name) ?? Core.getNonEmptyString(instance["%Name"]);
}

function locateRoomInstance(
    instanceLayer: RoomInstanceLayerRecord,
    roomName: string,
    instanceId: string
): LocatedRoomInstance {
    for (const [index, instance] of instanceLayer.instances.entries()) {
        if (!Core.isObjectLike(instance)) {
            continue;
        }
        const instanceRecord = instance as Record<string, unknown>;
        if (getRoomInstanceName(instanceRecord) === instanceId) {
            return Object.freeze({ index, instance: instanceRecord });
        }
    }

    throw new Error(`Could not find room instance '${instanceId}' in room '${roomName}'.`);
}

function readRoomInstanceCoordinate(instance: Record<string, unknown>, coordinateName: "x" | "y"): number {
    const coordinate = Number(instance[coordinateName]);
    if (!Number.isFinite(coordinate)) {
        throw new TypeError(
            `Room instance '${getRoomInstanceName(instance) ?? "<unnamed>"}' has invalid ${coordinateName} coordinate metadata.`
        );
    }
    return coordinate;
}

function readRoomInstanceObjectReference(instance: Record<string, unknown>, instanceId: string): ResourceReference {
    const objectId = instance.objectId;
    if (!Core.isObjectLike(objectId)) {
        throw new TypeError(`Room instance '${instanceId}' does not contain an objectId reference.`);
    }

    const objectRecord = objectId as Record<string, unknown>;
    const name = Core.getNonEmptyString(objectRecord.name);
    const resourcePath = Core.getNonEmptyString(objectRecord.path);
    if (name === null || resourcePath === null) {
        throw new TypeError(`Room instance '${instanceId}' has incomplete objectId metadata.`);
    }

    return Object.freeze({ name, path: resourcePath });
}

function summarizeRoomInstance(
    context: RoomInstanceMutationContext,
    instance: Record<string, unknown>
): RoomInstanceInspectionResult {
    const instanceId = getRoomInstanceName(instance);
    if (instanceId === null) {
        throw new TypeError(`Room '${context.roomReference.name}' contains an instance without a stable name.`);
    }

    const objectReference = readRoomInstanceObjectReference(instance, instanceId);
    return {
        instanceId,
        layerName: Core.getNonEmptyString(context.instanceLayer.name) ?? "Instances",
        objectName: objectReference.name,
        objectPath: objectReference.path,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        x: readRoomInstanceCoordinate(instance, "x"),
        y: readRoomInstanceCoordinate(instance, "y")
    };
}

async function resolveRoomInstanceMutationContext(
    projectRootInput: string,
    roomName: string
): Promise<RoomInstanceMutationContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);
    const roomReference = locateRoomReference(manifestResources, roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);
    const instanceLayer = findInstanceLayer(roomDocument, roomName);

    return Object.freeze({
        instanceLayer,
        manifestResources,
        projectRoot,
        roomAbsolutePath,
        roomDocument,
        roomReference
    });
}

/**
 * Add an object instance to the first instance layer in a GameMaker room.
 *
 * @param request - Room instance creation request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function addRoomInstance(request: AddRoomInstanceRequest): Promise<RoomInstanceMutationResult> {
    assertFiniteCoordinate(request.x, "x");
    assertFiniteCoordinate(request.y, "y");

    const context = await resolveRoomInstanceMutationContext(request.projectRoot, request.roomName);
    const objectReference = locateObjectReference(context.manifestResources, request.objectName);
    const instanceLayer = context.instanceLayer;
    const instanceId = `${ROOM_INSTANCE_NAME_PREFIX}${randomUUID().replaceAll("-", "")}`;
    const roomInstance = createRoomInstance(instanceId, objectReference, request.x, request.y);

    instanceLayer.instances = [...instanceLayer.instances, roomInstance];
    appendRoomInstanceCreationOrder(context.roomDocument, instanceId, context.roomReference.path);

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "add",
        deletedPaths: [],
        dryRun,
        instanceId,
        layerName: Core.getNonEmptyString(instanceLayer.name) ?? "Instances",
        objectName: objectReference.name,
        objectPath: objectReference.path,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path],
        x: request.x,
        y: request.y
    };
}

/**
 * List object instances from the first instance layer in a GameMaker room.
 *
 * @param request - Room instance listing request.
 * @returns Stable summaries of room instances in layer order.
 */
export async function listRoomInstances(
    request: ListRoomInstancesRequest
): Promise<Array<RoomInstanceInspectionResult>> {
    const context = await resolveRoomInstanceMutationContext(request.projectRoot, request.roomName);
    return context.instanceLayer.instances
        .filter((instance): instance is Record<string, unknown> => Core.isObjectLike(instance))
        .map((instance) => summarizeRoomInstance(context, instance));
}

/**
 * Inspect one object instance from the first instance layer in a GameMaker room.
 *
 * @param request - Room instance inspection request.
 * @returns Stable summary of the requested room instance.
 */
export async function inspectRoomInstance(request: InspectRoomInstanceRequest): Promise<RoomInstanceInspectionResult> {
    const context = await resolveRoomInstanceMutationContext(request.projectRoot, request.roomName);
    const located = locateRoomInstance(context.instanceLayer, context.roomReference.name, request.instanceId);
    return summarizeRoomInstance(context, located.instance);
}

/**
 * Move an existing object instance inside a GameMaker room.
 *
 * @param request - Room instance update request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function updateRoomInstance(request: UpdateRoomInstanceRequest): Promise<RoomInstanceMutationResult> {
    assertFiniteCoordinate(request.x, "x");
    assertFiniteCoordinate(request.y, "y");

    const context = await resolveRoomInstanceMutationContext(request.projectRoot, request.roomName);
    const located = locateRoomInstance(context.instanceLayer, context.roomReference.name, request.instanceId);
    const objectReference = readRoomInstanceObjectReference(located.instance, request.instanceId);

    located.instance.x = request.x;
    located.instance.y = request.y;

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "update",
        deletedPaths: [],
        dryRun,
        instanceId: request.instanceId,
        layerName: Core.getNonEmptyString(context.instanceLayer.name) ?? "Instances",
        objectName: objectReference.name,
        objectPath: objectReference.path,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path],
        x: request.x,
        y: request.y
    };
}

/**
 * Delete an existing object instance from a GameMaker room.
 *
 * @param request - Room instance deletion request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function deleteRoomInstance(request: DeleteRoomInstanceRequest): Promise<RoomInstanceMutationResult> {
    const context = await resolveRoomInstanceMutationContext(request.projectRoot, request.roomName);
    const located = locateRoomInstance(context.instanceLayer, context.roomReference.name, request.instanceId);
    const objectReference = readRoomInstanceObjectReference(located.instance, request.instanceId);
    const x = readRoomInstanceCoordinate(located.instance, "x");
    const y = readRoomInstanceCoordinate(located.instance, "y");

    context.instanceLayer.instances = context.instanceLayer.instances.filter((_, index) => index !== located.index);
    removeRoomInstanceCreationOrder(context.roomDocument, request.instanceId);

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "delete",
        deletedPaths: [],
        dryRun,
        instanceId: request.instanceId,
        layerName: Core.getNonEmptyString(context.instanceLayer.name) ?? "Instances",
        objectName: objectReference.name,
        objectPath: objectReference.path,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path],
        x,
        y
    };
}

/**
 * Move an existing object instance from its current instance layer to a
 * different named instance layer inside the same GameMaker room.
 *
 * @param request - Room instance layer move request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function moveRoomInstanceToLayer(
    request: MoveRoomInstanceToLayerRequest
): Promise<RoomInstanceMutationResult> {
    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const roomReference = locateRoomReference(getManifestResources(manifestDocument), request.roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);

    const { layer: sourceLayer, located } = locateRoomInstanceAcrossLayers(
        roomDocument,
        roomReference.name,
        request.instanceId
    );
    const targetLayer = findInstanceLayerByName(roomDocument, roomReference.name, request.targetLayerName);
    const objectReference = readRoomInstanceObjectReference(located.instance, request.instanceId);
    const x = readRoomInstanceCoordinate(located.instance, "x");
    const y = readRoomInstanceCoordinate(located.instance, "y");
    const targetLayerName = Core.getNonEmptyString(targetLayer.name) ?? request.targetLayerName;
    const changed = sourceLayer !== targetLayer;

    if (changed) {
        sourceLayer.instances = sourceLayer.instances.filter((_, index) => index !== located.index);
        targetLayer.instances = [...targetLayer.instances, located.instance];
    }

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, roomAbsolutePath, roomDocument);

    return {
        action: "move",
        deletedPaths: [],
        dryRun,
        instanceId: request.instanceId,
        layerName: targetLayerName,
        objectName: objectReference.name,
        objectPath: objectReference.path,
        roomName: roomReference.name,
        roomPath: roomReference.path,
        warnings: [],
        writtenPaths: [roomReference.path],
        x,
        y
    };
}
