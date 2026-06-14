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
const CAMERA_ID_PATTERN = /^(?:camera|view)_(\d+)$/iu;

type ResourceReference = Readonly<{
    name: string;
    path: string;
}>;

type RoomCameraMutationContext = Readonly<{
    cameraIndex: number;
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
    view: Record<string, unknown>;
}>;

/**
 * Parameters for updating one GameMaker room camera/view rectangle.
 */
export interface UpdateRoomCameraRequest {
    cameraId: string;
    dryRun?: boolean;
    height: number;
    projectRoot: string;
    roomName: string;
    width: number;
    x: number;
    y: number;
}

/**
 * Summary returned after a room camera/view metadata mutation.
 */
export interface RoomCameraMutationResult {
    action: "update";
    cameraId: string;
    deletedPaths: Array<string>;
    dryRun: boolean;
    height: number;
    roomName: string;
    roomPath: string;
    warnings: Array<string>;
    width: number;
    writtenPaths: Array<string>;
    x: number;
    y: number;
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

function parseCameraIndex(cameraId: string): number {
    const directIndex = Number(cameraId);
    if (Number.isInteger(directIndex) && directIndex >= 0) {
        return directIndex;
    }

    const matchedCameraId = CAMERA_ID_PATTERN.exec(cameraId);
    if (matchedCameraId !== null) {
        const parsedIndex = Number(matchedCameraId[1]);
        if (Number.isInteger(parsedIndex) && parsedIndex >= 0) {
            return parsedIndex;
        }
    }

    throw new TypeError(`Invalid room camera id '${cameraId}'. Expected a non-negative index or an id like camera_0.`);
}

function assertFiniteDimension(value: number, dimensionName: "height" | "width"): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(
            `Invalid camera ${dimensionName} ${String(value)}. Expected a positive finite numeric value.`
        );
    }
}

function assertFiniteCoordinate(value: number, coordinateName: "x" | "y"): void {
    if (!Number.isFinite(value)) {
        throw new TypeError(`Invalid camera ${coordinateName} ${String(value)}. Expected a finite numeric value.`);
    }
}

async function resolveRoomCameraMutationContext(
    projectRootInput: string,
    roomName: string,
    cameraId: string
): Promise<RoomCameraMutationContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const roomReference = locateRoomReference(getManifestResources(manifestDocument), roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);
    const cameraIndex = parseCameraIndex(cameraId);
    const views = Core.asArray(roomDocument.views);
    const view = views[cameraIndex];

    if (!Core.isObjectLike(view)) {
        throw new TypeError(`Could not find room camera '${cameraId}' in room '${roomName}'.`);
    }

    return Object.freeze({
        cameraIndex,
        projectRoot,
        roomAbsolutePath,
        roomDocument,
        roomReference,
        view: view as Record<string, unknown>
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
 * Update one room camera/view rectangle and enable room views for autonomous playtesting.
 *
 * @param request - Room camera update request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function updateRoomCamera(request: UpdateRoomCameraRequest): Promise<RoomCameraMutationResult> {
    assertFiniteCoordinate(request.x, "x");
    assertFiniteCoordinate(request.y, "y");
    assertFiniteDimension(request.width, "width");
    assertFiniteDimension(request.height, "height");

    const context = await resolveRoomCameraMutationContext(request.projectRoot, request.roomName, request.cameraId);
    context.view.xview = request.x;
    context.view.yview = request.y;
    context.view.wview = request.width;
    context.view.hview = request.height;
    context.view.xport = 0;
    context.view.yport = 0;
    context.view.wport = request.width;
    context.view.hport = request.height;
    context.view.visible = true;

    const viewSettings = Core.isObjectLike(context.roomDocument.viewSettings)
        ? (context.roomDocument.viewSettings as Record<string, unknown>)
        : {};
    viewSettings.enableViews = true;
    context.roomDocument.viewSettings = viewSettings;

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "update",
        cameraId: `camera_${context.cameraIndex}`,
        deletedPaths: [],
        dryRun,
        height: request.height,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        width: request.width,
        writtenPaths: [context.roomReference.path],
        x: request.x,
        y: request.y
    };
}
