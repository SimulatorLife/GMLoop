import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import { locateRoomReference, type ResourceReference, writeRoomDocumentIfApplying } from "./room-resource-helpers.js";

const INSTANCE_LAYER_RESOURCE_TYPE = "GMRInstanceLayer";

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
 * Summary returned after a room layer metadata mutation.
 */
export interface RoomLayerMutationResult {
    action: "create";
    deletedPaths: Array<string>;
    depth: number;
    dryRun: boolean;
    layerName: string;
    layerType: "instance";
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

function assertUniqueLayerName(layers: ReadonlyArray<unknown>, layerName: string, roomName: string): void {
    for (const layer of layers) {
        if (readLayerName(layer) === layerName) {
            throw new Error(`Room '${roomName}' already contains a layer named '${layerName}'.`);
        }
    }
}

function createInstanceLayer(layerName: string, depth: number): Record<string, unknown> {
    return {
        $GMRInstanceLayer: "",
        "%Name": layerName,
        depth,
        effectEnabled: true,
        effectType: null,
        gridX: 32,
        gridY: 32,
        hierarchyFrozen: false,
        inheritLayerDepth: false,
        inheritLayerSettings: false,
        inheritSubLayers: true,
        inheritVisibility: true,
        instances: [],
        layers: [],
        name: layerName,
        properties: [],
        resourceType: INSTANCE_LAYER_RESOURCE_TYPE,
        resourceVersion: "2.0",
        userdefinedDepth: false,
        visible: true
    };
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
    context.layers.push(createInstanceLayer(request.layerName, request.depth));

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "create",
        deletedPaths: [],
        depth: request.depth,
        dryRun,
        layerName: request.layerName,
        layerType: "instance",
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: [context.roomReference.path]
    };
}
