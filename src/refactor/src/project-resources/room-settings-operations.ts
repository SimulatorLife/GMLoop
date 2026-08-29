import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import { locateRoomReference, type ResourceReference, writeRoomDocumentIfApplying } from "./room-resource-helpers.js";

type RoomSettingsMutationContext = Readonly<{
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
    roomSettings: Record<string, unknown>;
}>;

/**
 * Parameters for updating a GameMaker room's top-level settings.
 *
 * Every mutable field is nullable so callers can update a strict subset of
 * `roomSettings`/`volume` without first reading the room document. At least
 * one field must be non-null; {@link updateRoomSettings} rejects an
 * all-null request instead of silently reporting a no-op mutation.
 */
export interface UpdateRoomSettingsRequest {
    dryRun?: boolean;
    height: number | null;
    persistent: boolean | null;
    projectRoot: string;
    roomName: string;
    volume: number | null;
    width: number | null;
}

/**
 * Summary returned after a room settings mutation.
 */
export interface RoomSettingsMutationResult {
    action: "update";
    changed: boolean;
    deletedPaths: Array<string>;
    dryRun: boolean;
    height: number;
    persistent: boolean;
    roomName: string;
    roomPath: string;
    volume: number;
    warnings: Array<string>;
    width: number;
    writtenPaths: Array<string>;
}

function assertPositiveDimension(value: number, dimensionName: "height" | "width"): void {
    if (!Number.isFinite(value) || value <= 0) {
        throw new TypeError(
            `Invalid room ${dimensionName} ${String(value)}. Expected a positive finite numeric value.`
        );
    }
}

function assertNonNegativeVolume(value: number): void {
    if (!Number.isFinite(value) || value < 0) {
        throw new TypeError(`Invalid room volume ${String(value)}. Expected a non-negative finite numeric value.`);
    }
}

function readRoomSettings(roomDocument: Record<string, unknown>): Record<string, unknown> {
    const existing = roomDocument.roomSettings;
    return Core.isObjectLike(existing) ? { ...(existing as Record<string, unknown>) } : {};
}

function readFiniteNumberField(record: Record<string, unknown>, fieldName: string): number | null {
    const value = record[fieldName];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBooleanField(record: Record<string, unknown>, fieldName: string): boolean | null {
    const value = record[fieldName];
    return typeof value === "boolean" ? value : null;
}

async function resolveRoomSettingsMutationContext(
    projectRootInput: string,
    roomName: string
): Promise<RoomSettingsMutationContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const roomReference = locateRoomReference(getManifestResources(manifestDocument), roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readProjectMetadataDocument(roomAbsolutePath);
    const roomSettings = readRoomSettings(roomDocument);
    roomDocument.roomSettings = roomSettings;

    return Object.freeze({
        projectRoot,
        roomAbsolutePath,
        roomDocument,
        roomReference,
        roomSettings
    });
}

/**
 * Update a GameMaker room's top-level width, height, persistent, and volume
 * settings.
 *
 * @param request - Room settings update request.
 * @returns Summary of the planned or applied room metadata mutation.
 */
export async function updateRoomSettings(request: UpdateRoomSettingsRequest): Promise<RoomSettingsMutationResult> {
    if (request.width === null && request.height === null && request.persistent === null && request.volume === null) {
        throw new TypeError(
            "Room settings update requires --width, --height, --persistent, --volume, or a combination."
        );
    }
    if (request.width !== null) {
        assertPositiveDimension(request.width, "width");
    }
    if (request.height !== null) {
        assertPositiveDimension(request.height, "height");
    }
    if (request.volume !== null) {
        assertNonNegativeVolume(request.volume);
    }

    const context = await resolveRoomSettingsMutationContext(request.projectRoot, request.roomName);
    const currentWidth = readFiniteNumberField(context.roomSettings, "Width");
    const currentHeight = readFiniteNumberField(context.roomSettings, "Height");
    const currentPersistent = readBooleanField(context.roomSettings, "persistent") ?? false;
    const currentVolume = readFiniteNumberField(context.roomDocument, "volume") ?? 1;

    const nextWidth = request.width ?? currentWidth;
    const nextHeight = request.height ?? currentHeight;
    const nextPersistent = request.persistent ?? currentPersistent;
    const nextVolume = request.volume ?? currentVolume;

    if (nextWidth === null) {
        throw new Error(`Room '${request.roomName}' does not have a numeric width to preserve.`);
    }
    if (nextHeight === null) {
        throw new Error(`Room '${request.roomName}' does not have a numeric height to preserve.`);
    }

    const changed =
        currentWidth !== nextWidth ||
        currentHeight !== nextHeight ||
        currentPersistent !== nextPersistent ||
        currentVolume !== nextVolume;

    context.roomSettings.Width = nextWidth;
    context.roomSettings.Height = nextHeight;
    context.roomSettings.persistent = nextPersistent;
    context.roomDocument.volume = nextVolume;

    const dryRun = request.dryRun !== false;
    await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);

    return {
        action: "update",
        changed,
        deletedPaths: [],
        dryRun,
        height: nextHeight,
        persistent: nextPersistent,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        volume: nextVolume,
        warnings: [],
        width: nextWidth,
        writtenPaths: [context.roomReference.path]
    };
}
