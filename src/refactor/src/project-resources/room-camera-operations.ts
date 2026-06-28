import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import {
    assertFiniteCoordinate,
    locateRoomReference,
    type ResourceReference,
    writeRoomDocumentIfApplying
} from "./room-resource-helpers.js";

const CAMERA_ID_PATTERN = /^(?:camera|view)_(\d+)$/iu;

type RoomCameraMutationContext = Readonly<{
    cameraIndex: number;
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
    view: Record<string, unknown>;
}>;

type RoomCameraInspectionContext = Readonly<{
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
    viewsEnabled: boolean;
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

/**
 * Read-only summary of one room camera/view entry.
 */
export interface RoomCameraInspectionResult {
    cameraId: string;
    enabled: boolean;
    height: number | null;
    portHeight: number | null;
    portWidth: number | null;
    portX: number | null;
    portY: number | null;
    roomName: string;
    roomPath: string;
    visible: boolean;
    width: number | null;
    x: number | null;
    y: number | null;
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

function readFiniteNumberField(record: Record<string, unknown>, fieldName: string): number | null {
    const value = record[fieldName];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanField(record: Record<string, unknown>, fieldName: string): boolean {
    return record[fieldName] === true;
}

function inspectRoomCameraRecord(
    context: RoomCameraInspectionContext,
    cameraIndex: number,
    view: Record<string, unknown>
): RoomCameraInspectionResult {
    const visible = readBooleanField(view, "visible");
    return Object.freeze({
        cameraId: `camera_${String(cameraIndex)}`,
        enabled: context.viewsEnabled && visible,
        height: readFiniteNumberField(view, "hview"),
        portHeight: readFiniteNumberField(view, "hport"),
        portWidth: readFiniteNumberField(view, "wport"),
        portX: readFiniteNumberField(view, "xport"),
        portY: readFiniteNumberField(view, "yport"),
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        visible,
        width: readFiniteNumberField(view, "wview"),
        x: readFiniteNumberField(view, "xview"),
        y: readFiniteNumberField(view, "yview")
    });
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

async function resolveRoomCameraInspectionContext(
    projectRootInput: string,
    roomName: string
): Promise<RoomCameraInspectionContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const roomReference = locateRoomReference(getManifestResources(manifestDocument), roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);
    const viewSettings = Core.isObjectLike(roomDocument.viewSettings)
        ? (roomDocument.viewSettings as Record<string, unknown>)
        : {};

    return Object.freeze({
        roomDocument,
        roomReference,
        viewsEnabled: viewSettings.enableViews === true
    });
}

/**
 * List camera/view entries declared by one GameMaker room.
 *
 * @param request - Project root and room name to inspect.
 * @returns Deterministic camera summaries in room metadata order.
 */
export async function listRoomCameras(request: {
    projectRoot: string;
    roomName: string;
}): Promise<ReadonlyArray<RoomCameraInspectionResult>> {
    const context = await resolveRoomCameraInspectionContext(request.projectRoot, request.roomName);
    return Object.freeze(
        Core.asArray(context.roomDocument.views)
            .map((view, cameraIndex) =>
                Core.isObjectLike(view)
                    ? inspectRoomCameraRecord(context, cameraIndex, view as Record<string, unknown>)
                    : null
            )
            .filter((view): view is RoomCameraInspectionResult => view !== null)
    );
}

/**
 * Inspect one camera/view entry declared by a GameMaker room.
 *
 * @param request - Project root, room name, and camera id/index to inspect.
 * @returns The matching camera summary.
 */
export async function inspectRoomCamera(request: {
    cameraId: string;
    projectRoot: string;
    roomName: string;
}): Promise<RoomCameraInspectionResult> {
    const cameraIndex = parseCameraIndex(request.cameraId);
    const cameras = await listRoomCameras(request);
    const camera = cameras.find((entry) => entry.cameraId === `camera_${String(cameraIndex)}`);
    if (camera === undefined) {
        throw new TypeError(`Could not find room camera '${request.cameraId}' in room '${request.roomName}'.`);
    }
    return camera;
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
