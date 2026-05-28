import { randomUUID } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

const ROOM_RESOURCE_DIRECTORY = "rooms";
const OBJECT_RESOURCE_DIRECTORY = "objects";
const INSTANCE_LAYER_RESOURCE_TYPE = "GMRInstanceLayer";
const ROOM_INSTANCE_RESOURCE_TYPE = "GMRInstance";
const ROOM_INSTANCE_NAME_PREFIX = "inst_";

type ProjectManifestEntry = Readonly<{
    id: Readonly<{
        name: string;
        path: string;
    }>;
}>;

type RoomInstanceLayerRecord = Record<string, unknown> & {
    instances: Array<unknown>;
};

type ResourceReference = Readonly<{
    name: string;
    path: string;
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
 * Summary returned after a room instance mutation.
 */
export interface RoomInstanceMutationResult {
    action: "add";
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

async function readProjectMetadataDocument(absolutePath: string): Promise<Record<string, unknown>> {
    const rawContent = await readFile(absolutePath, "utf8");
    return Core.parseProjectMetadataDocumentForMutation(rawContent, absolutePath).document;
}

async function resolveProjectManifestPath(projectRoot: string): Promise<string> {
    const directoryEntries = await readdir(projectRoot, { withFileTypes: true });
    const manifestFileNames = directoryEntries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
        .map((entry) => entry.name)
        .toSorted((left, right) => left.localeCompare(right));

    if (manifestFileNames.length === 0) {
        throw new Error(`Could not locate a .yyp manifest inside '${projectRoot}'.`);
    }
    if (manifestFileNames.length > 1) {
        throw new Error(
            `Found multiple .yyp manifests in '${projectRoot}'. Room instance operations require exactly one project manifest.`
        );
    }

    return path.join(projectRoot, manifestFileNames[0]);
}

function getManifestResources(document: Record<string, unknown>): Array<ProjectManifestEntry> {
    const resources: Array<ProjectManifestEntry> = [];
    for (const resourceEntry of Core.asArray(document.resources)) {
        if (!Core.isObjectLike(resourceEntry)) {
            continue;
        }

        const identifier = (resourceEntry as { id?: unknown }).id;
        if (!Core.isObjectLike(identifier)) {
            continue;
        }

        const name = Core.getNonEmptyString((identifier as { name?: unknown }).name);
        const resourcePath = Core.getNonEmptyString((identifier as { path?: unknown }).path);
        if (!name || !resourcePath) {
            continue;
        }

        resources.push(
            Object.freeze({
                id: Object.freeze({
                    name,
                    path: resourcePath
                })
            })
        );
    }
    return resources;
}

function locateResourceReference(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    resourceDirectory: string,
    resourceName: string
): ResourceReference {
    const expectedPrefix = `${resourceDirectory}/`;
    let located: ResourceReference | null = null;

    for (const manifestResource of manifestResources) {
        if (manifestResource.id.name !== resourceName || !manifestResource.id.path.startsWith(expectedPrefix)) {
            continue;
        }
        if (located !== null) {
            throw new Error(
                `Found multiple ${resourceDirectory} resources named '${resourceName}' in the project manifest.`
            );
        }
        located = Object.freeze({
            name: manifestResource.id.name,
            path: manifestResource.id.path
        });
    }

    if (located === null) {
        throw new Error(`Could not find ${resourceDirectory} resource '${resourceName}' in the project manifest.`);
    }

    return located;
}

function findInstanceLayer(roomDocument: Record<string, unknown>, roomName: string): RoomInstanceLayerRecord {
    const layers = Core.asArray(roomDocument.layers);
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
        return layerRecord as RoomInstanceLayerRecord;
    }

    throw new Error(`Room '${roomName}' does not contain a ${INSTANCE_LAYER_RESOURCE_TYPE} layer.`);
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

function assertFiniteCoordinate(value: number, coordinateName: "x" | "y"): void {
    if (!Number.isFinite(value)) {
        throw new TypeError(`Invalid ${coordinateName} coordinate ${String(value)}. Expected a finite numeric value.`);
    }
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

    const projectRoot = path.resolve(request.projectRoot);
    const manifestPath = await resolveProjectManifestPath(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifestPath);
    const manifestResources = getManifestResources(manifestDocument);
    const roomReference = locateResourceReference(manifestResources, ROOM_RESOURCE_DIRECTORY, request.roomName);
    const objectReference = locateResourceReference(manifestResources, OBJECT_RESOURCE_DIRECTORY, request.objectName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);
    const instanceLayer = findInstanceLayer(roomDocument, request.roomName);
    const instanceId = `${ROOM_INSTANCE_NAME_PREFIX}${randomUUID().replaceAll("-", "")}`;
    const roomInstance = createRoomInstance(instanceId, objectReference, request.x, request.y);

    instanceLayer.instances = [...instanceLayer.instances, roomInstance];
    appendRoomInstanceCreationOrder(roomDocument, instanceId, roomReference.path);

    const dryRun = request.dryRun !== false;
    if (!dryRun) {
        await writeFile(
            roomAbsolutePath,
            `${Core.stringifyProjectMetadataDocument(roomDocument, roomAbsolutePath)}\n`,
            "utf8"
        );
    }

    return {
        action: "add",
        deletedPaths: [],
        dryRun,
        instanceId,
        layerName: Core.getNonEmptyString(instanceLayer.name) ?? "Instances",
        objectName: objectReference.name,
        objectPath: objectReference.path,
        roomName: roomReference.name,
        roomPath: roomReference.path,
        warnings: [],
        writtenPaths: [roomReference.path],
        x: request.x,
        y: request.y
    };
}
