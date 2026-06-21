import { writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    type ProjectManifestEntry,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";

const ROOM_RESOURCE_DIRECTORY = "rooms";
const INSTANCE_LAYER_RESOURCE_TYPE = "GMRInstanceLayer";

type ResourceReference = Readonly<{
    name: string;
    path: string;
}>;

type RoomLayerMutationContext = Readonly<{
    layers: Array<unknown>;
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
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

function locateRoomReference(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    roomName: string
): ResourceReference {
    const expectedPrefix = `${ROOM_RESOURCE_DIRECTORY}/`;
    let located: ResourceReference | null = null;

    for (const manifestResource of manifestResources) {
        if (manifestResource.id.name !== roomName || !manifestResource.id.path.startsWith(expectedPrefix)) {
            continue;
        }
        if (located !== null) {
            throw new Error(`Found multiple room resources named '${roomName}' in the project manifest.`);
        }
        located = Object.freeze({
            name: manifestResource.id.name,
            path: manifestResource.id.path
        });
    }

    if (located === null) {
        throw new Error(`Could not find room resource '${roomName}' in the project manifest.`);
    }

    return located;
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

async function writeRoomDocumentIfApplying(
    dryRun: boolean,
    roomAbsolutePath: string,
    roomDocument: Record<string, unknown>
): Promise<void> {
    if (dryRun) {
        return;
    }

    await writeFile(
        roomAbsolutePath,
        `${Core.stringifyProjectMetadataDocument(roomDocument, roomAbsolutePath)}\n`,
        "utf8"
    );
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
