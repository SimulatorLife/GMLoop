import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import { createDefaultInstanceLayer } from "./room-metadata-defaults.js";
import { locateRoomReference, type ResourceReference, writeRoomDocumentIfApplying } from "./room-resource-helpers.js";

type RoomLayerMutationContext = Readonly<{
    layers: Array<unknown>;
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
}>;

type RoomLayerInspectionContext = Readonly<{
    layers: ReadonlyArray<unknown>;
    roomReference: ResourceReference;
}>;

/**
 * Parameters for creating a GameMaker room instance layer.
 */
export interface CreateRoomLayerRequest {
    depth: number;
    dryRun?: boolean;
    layerName: string;
    projectRoot: string;
    roomName: string;
}

/**
 * Parameters for updating a GameMaker room layer's refactor-safe metadata.
 */
export interface UpdateRoomLayerRequest {
    depth: number | null;
    dryRun?: boolean;
    layerName: string;
    newLayerName: string | null;
    projectRoot: string;
    roomName: string;
}

/**
 * Parameters for deleting an empty GameMaker room layer.
 */
export interface DeleteRoomLayerRequest {
    dryRun?: boolean;
    layerName: string;
    projectRoot: string;
    roomName: string;
}

/**
 * Parameters for reordering a GameMaker room layer in metadata order.
 */
export interface ReorderRoomLayerRequest {
    dryRun?: boolean;
    layerIndex: number;
    layerName: string;
    projectRoot: string;
    roomName: string;
}

/**
 * Summary returned after a room layer metadata mutation.
 */
export interface RoomLayerMutationResult {
    action: "create" | "delete" | "reorder" | "update";
    changed: boolean;
    deletedPaths: Array<string>;
    depth: number;
    dryRun: boolean;
    layerIndex: number;
    layerName: string;
    layerType: "instance";
    previousLayerIndex: number | null;
    roomName: string;
    roomPath: string;
    warnings: Array<string>;
    writtenPaths: Array<string>;
}

/**
 * Read-only summary of one room layer.
 */
export interface RoomLayerInspectionResult {
    depth: number | null;
    instanceCount: number;
    layerName: string;
    layerType: string;
    roomName: string;
    roomPath: string;
    subLayerCount: number;
    visible: boolean | null;
}

function assertRoomLayerName(layerName: string): void {
    if (layerName.trim() !== layerName || layerName.length === 0) {
        throw new TypeError("Room layer name must be a non-empty string without leading or trailing whitespace.");
    }
}

function assertLayerDepth(depth: number): void {
    if (!Number.isInteger(depth)) {
        throw new TypeError(`Invalid room layer depth ${String(depth)}. Expected an integer value.`);
    }
}

function readLayerName(layer: unknown): string | null {
    if (!Core.isObjectLike(layer)) {
        return null;
    }

    const layerRecord = layer as Record<string, unknown>;
    return Core.getNonEmptyString(layerRecord.name) ?? Core.getNonEmptyString(layerRecord["%Name"]);
}

function readLayerType(layer: Record<string, unknown>): string {
    return Core.getNonEmptyString(layer.resourceType) ?? "unknown";
}

function readLayerDepth(layer: Record<string, unknown>): number | null {
    return typeof layer.depth === "number" && Number.isFinite(layer.depth) ? layer.depth : null;
}

function readLayerVisible(layer: Record<string, unknown>): boolean | null {
    return typeof layer.visible === "boolean" ? layer.visible : null;
}

function inspectLayerRecord(
    context: RoomLayerInspectionContext,
    layer: Record<string, unknown>
): RoomLayerInspectionResult {
    return Object.freeze({
        depth: readLayerDepth(layer),
        instanceCount: Core.asArray(layer.instances).length,
        layerName: readLayerName(layer) ?? "",
        layerType: readLayerType(layer),
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        subLayerCount: Core.asArray(layer.layers).length,
        visible: readLayerVisible(layer)
    });
}

function findLayerIndex(layers: ReadonlyArray<unknown>, layerName: string, roomName: string): number {
    const layerIndex = layers.findIndex((layer) => readLayerName(layer) === layerName);
    if (layerIndex === -1) {
        throw new Error(`Could not find room layer '${layerName}' in room '${roomName}'.`);
    }
    return layerIndex;
}

function readMutableLayerRecord(
    layers: ReadonlyArray<unknown>,
    layerIndex: number,
    layerName: string
): Record<string, unknown> {
    const layer = layers[layerIndex];
    if (!Core.isObjectLike(layer)) {
        throw new TypeError(`Room layer '${layerName}' metadata is not an object.`);
    }
    return layer as Record<string, unknown>;
}

function assertUniqueLayerName(layers: ReadonlyArray<unknown>, layerName: string, roomName: string): void {
    for (const layer of layers) {
        if (readLayerName(layer) === layerName) {
            throw new Error(`Room '${roomName}' already contains a layer named '${layerName}'.`);
        }
    }
}

function assertUniqueLayerNameForUpdate(
    layers: ReadonlyArray<unknown>,
    currentLayerName: string,
    newLayerName: string,
    roomName: string
): void {
    for (const layer of layers) {
        const existingLayerName = readLayerName(layer);
        if (existingLayerName === newLayerName && existingLayerName !== currentLayerName) {
            throw new Error(`Room '${roomName}' already contains a layer named '${newLayerName}'.`);
        }
    }
}

function assertEmptyLayerForDeletion(layer: Record<string, unknown>, layerName: string): void {
    const instances = Core.asArray(layer.instances);
    if (instances.length > 0) {
        throw new Error(
            `Room layer '${layerName}' contains ${String(instances.length)} instance(s) and cannot be deleted.`
        );
    }

    const subLayers = Core.asArray(layer.layers);
    if (subLayers.length > 0) {
        throw new Error(
            `Room layer '${layerName}' contains ${String(subLayers.length)} sub-layer(s) and cannot be deleted.`
        );
    }
}

function assertLayerIndex(layerIndex: number, layers: ReadonlyArray<unknown>): void {
    if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= layers.length) {
        throw new TypeError(
            `Invalid room layer index ${String(layerIndex)}. Expected an integer from 0 to ${String(layers.length - 1)}.`
        );
    }
}

async function resolveRoomLayerMutationContext(
    projectRootInput: string,
    roomName: string
): Promise<RoomLayerMutationContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const roomReference = locateRoomReference(getManifestResources(manifestDocument), roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);
    const layers = [...Core.asArray(roomDocument.layers)];
    roomDocument.layers = layers;

    return Object.freeze({
        layers,
        projectRoot,
        roomAbsolutePath,
        roomDocument,
        roomReference
    });
}

async function resolveRoomLayerInspectionContext(
    projectRootInput: string,
    roomName: string
): Promise<RoomLayerInspectionContext> {
    const context = await resolveRoomLayerMutationContext(projectRootInput, roomName);
    return Object.freeze({
        layers: Object.freeze([...context.layers]),
        roomReference: context.roomReference
    });
}

/**
 * List layers declared by one GameMaker room.
 *
 * @param request - Project root and room name to inspect.
 * @returns Deterministic layer summaries in room metadata order.
 */
export async function listRoomLayers(request: {
    projectRoot: string;
    roomName: string;
}): Promise<ReadonlyArray<RoomLayerInspectionResult>> {
    const context = await resolveRoomLayerInspectionContext(request.projectRoot, request.roomName);
    return Object.freeze(
        context.layers
            .filter((layer): layer is Record<string, unknown> => Core.isObjectLike(layer))
            .map((layer) => inspectLayerRecord(context, layer))
    );
}

/**
 * Inspect one layer declared by a GameMaker room.
 *
 * @param request - Project root, room name, and layer name to inspect.
 * @returns The matching layer summary.
 */
export async function inspectRoomLayer(request: {
    layerName: string;
    projectRoot: string;
    roomName: string;
}): Promise<RoomLayerInspectionResult> {
    const layers = await listRoomLayers(request);
    const layer = layers.find((entry) => entry.layerName === request.layerName);
    if (layer === undefined) {
        throw new Error(`Could not find room layer '${request.layerName}' in room '${request.roomName}'.`);
    }
    return layer;
}

/**
 * Create an empty instance layer in a GameMaker room.
 *
 * @param request - Room layer creation request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function createRoomLayer(request: CreateRoomLayerRequest): Promise<RoomLayerMutationResult> {
    assertRoomLayerName(request.layerName);
    assertLayerDepth(request.depth);

    const context = await resolveRoomLayerMutationContext(request.projectRoot, request.roomName);
    assertUniqueLayerName(context.layers, request.layerName, context.roomReference.name);
    context.layers.push(createDefaultInstanceLayer(request.layerName, request.depth));
    const layerIndex = context.layers.length - 1;

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "create",
        changed: true,
        deletedPaths: [],
        depth: request.depth,
        dryRun,
        layerIndex,
        layerName: request.layerName,
        layerType: "instance",
        previousLayerIndex: null,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path]
    };
}

/**
 * Update refactor-safe room layer metadata.
 *
 * @param request - Room layer update request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function updateRoomLayer(request: UpdateRoomLayerRequest): Promise<RoomLayerMutationResult> {
    if (request.newLayerName === null && request.depth === null) {
        throw new TypeError("Room layer update requires --name, --depth, or both.");
    }
    if (request.newLayerName !== null) {
        assertRoomLayerName(request.newLayerName);
    }
    if (request.depth !== null) {
        assertLayerDepth(request.depth);
    }

    const context = await resolveRoomLayerMutationContext(request.projectRoot, request.roomName);
    const layerIndex = findLayerIndex(context.layers, request.layerName, context.roomReference.name);
    const layer = readMutableLayerRecord(context.layers, layerIndex, request.layerName);
    const currentDepth = readLayerDepth(layer);
    const nextLayerName = request.newLayerName ?? request.layerName;
    const nextDepth = request.depth ?? currentDepth;
    if (request.newLayerName !== null) {
        assertUniqueLayerNameForUpdate(
            context.layers,
            request.layerName,
            request.newLayerName,
            context.roomReference.name
        );
    }
    if (nextDepth === null) {
        throw new Error(`Room layer '${request.layerName}' does not have a numeric depth to preserve.`);
    }

    const changed = readLayerName(layer) !== nextLayerName || currentDepth !== nextDepth;
    layer.name = nextLayerName;
    layer["%Name"] = nextLayerName;
    layer.depth = nextDepth;

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "update",
        changed,
        deletedPaths: [],
        depth: nextDepth,
        dryRun,
        layerIndex,
        layerName: nextLayerName,
        layerType: "instance",
        previousLayerIndex: layerIndex,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path]
    };
}

/**
 * Delete an empty room layer from GameMaker room metadata.
 *
 * @param request - Room layer deletion request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function deleteRoomLayer(request: DeleteRoomLayerRequest): Promise<RoomLayerMutationResult> {
    const context = await resolveRoomLayerMutationContext(request.projectRoot, request.roomName);
    const layerIndex = findLayerIndex(context.layers, request.layerName, context.roomReference.name);
    const layer = readMutableLayerRecord(context.layers, layerIndex, request.layerName);
    assertEmptyLayerForDeletion(layer, request.layerName);
    const depth = readLayerDepth(layer);
    if (depth === null) {
        throw new Error(`Room layer '${request.layerName}' does not have a numeric depth.`);
    }

    context.layers.splice(layerIndex, 1);

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "delete",
        changed: true,
        deletedPaths: [],
        depth,
        dryRun,
        layerIndex,
        layerName: request.layerName,
        layerType: "instance",
        previousLayerIndex: layerIndex,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path]
    };
}

/**
 * Reorder a room layer in GameMaker room metadata.
 *
 * @param request - Room layer reorder request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function reorderRoomLayer(request: ReorderRoomLayerRequest): Promise<RoomLayerMutationResult> {
    const context = await resolveRoomLayerMutationContext(request.projectRoot, request.roomName);
    assertLayerIndex(request.layerIndex, context.layers);
    const previousLayerIndex = findLayerIndex(context.layers, request.layerName, context.roomReference.name);
    const layer = readMutableLayerRecord(context.layers, previousLayerIndex, request.layerName);
    const depth = readLayerDepth(layer);
    if (depth === null) {
        throw new Error(`Room layer '${request.layerName}' does not have a numeric depth.`);
    }

    context.layers.splice(previousLayerIndex, 1);
    context.layers.splice(request.layerIndex, 0, layer);

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "reorder",
        changed: previousLayerIndex !== request.layerIndex,
        deletedPaths: [],
        depth,
        dryRun,
        layerIndex: request.layerIndex,
        layerName: request.layerName,
        layerType: "instance",
        previousLayerIndex,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path]
    };
}
