import { readFile, stat } from "node:fs/promises";

import { Core } from "@gmloop/core";

import {
    createResourcePatch,
    type ResourceLayerUpdate,
    type ResourcePatch
} from "../../modules/transpilation/index.js";
import type { PatchBroadcaster } from "../../modules/websocket/server.js";
import { hashSourceContent, readSourceFileWithTransientEmptyRetry } from "./source-analysis.js";
import { evaluateTranspilationSkipPolicy } from "./transpilation-skip-policy.js";

type JsonObject = Record<string, unknown>;

export interface ResourceChangeContext {
    fileSnapshots: Map<string, number>;
    fileContentHashes: Map<string, string>;
    resourcePatches: Map<string, ResourcePatch>;
    totalPatchCount: number;
    websocketServer: PatchBroadcaster | null;
    transientEmptyFileReadRetryCount: number;
    transientEmptyFileReadRetryDelayMs: number;
}

export interface ResourceChangeOptions {
    verbose: boolean;
    quiet: boolean;
    fileStats?: { mtimeMs: number } | null;
    abortSignal?: AbortSignal;
}

const BACKGROUND_PROPERTIES = new Set([
    "colour",
    "visible",
    "hspeed",
    "vspeed",
    "stretch",
    "htiled",
    "vtiled",
    "x",
    "y",
    "animationFPS"
]);

function isJsonObject(value: unknown): value is JsonObject {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getLayerName(layer: JsonObject): string | null {
    const layerName = layer.name ?? layer["%Name"];
    return typeof layerName === "string" && layerName.length > 0 ? layerName : null;
}

function getBackgroundLayers(roomData: JsonObject): Map<string, JsonObject> {
    const layers = roomData.layers;
    if (!Array.isArray(layers)) {
        return new Map();
    }

    const backgroundLayers = new Map<string, JsonObject>();
    for (const candidate of layers) {
        if (!isJsonObject(candidate) || candidate.resourceType !== "GMRBackgroundLayer") {
            continue;
        }
        const name = getLayerName(candidate);
        if (name !== null) {
            backgroundLayers.set(name, candidate);
        }
    }
    return backgroundLayers;
}

/** Diffs mutable GameMaker background-layer settings by layer name. */
export function diffRoomBackgroundLayers(
    previousRoom: JsonObject,
    currentRoom: JsonObject
): Array<ResourceLayerUpdate> {
    const previousLayers = getBackgroundLayers(previousRoom);
    const updates: Array<ResourceLayerUpdate> = [];

    for (const [layerName, currentLayer] of getBackgroundLayers(currentRoom)) {
        const previousLayer = previousLayers.get(layerName);
        if (!previousLayer) {
            continue;
        }

        const properties: Record<string, unknown> = {};
        for (const propertyName of BACKGROUND_PROPERTIES) {
            const currentValue = currentLayer[propertyName];
            if (!Object.is(previousLayer[propertyName], currentValue)) {
                properties[propertyName] = currentValue;
            }
        }
        if (Object.keys(properties).length > 0) {
            updates.push({ layerName, layerType: "GMRBackgroundLayer", properties });
        }
    }
    return updates;
}

/** Reads a changed room resource, diffs it against the previous save, and broadcasts its live patch. */
export async function handleResourceFileChange(
    filePath: string,
    context: ResourceChangeContext,
    previousRooms: Map<string, JsonObject>,
    options: ResourceChangeOptions
): Promise<void> {
    const fileStats = options.fileStats ?? (await stat(filePath));

    // Cheap pre-read mtime fast path: avoid reading the (potentially large)
    // room JSON when the mtime has not advanced. Kept inline because the
    // policy cannot evaluate a content hash without first reading the bytes.
    const previousMtime = context.fileSnapshots.get(filePath);
    if (previousMtime !== undefined && fileStats.mtimeMs <= previousMtime) {
        return;
    }

    const source = await readSourceFileWithTransientEmptyRetry(
        filePath,
        context.transientEmptyFileReadRetryCount,
        context.transientEmptyFileReadRetryDelayMs,
        options.abortSignal
    );
    if (source === null) {
        return;
    }

    // Defer the post-read decision to the shared policy so the heuristic
    // lives in one place (see ./transpilation-skip-policy.ts). The pre-read
    // mtime guard above already proved the new mtime is strictly newer than
    // the cached one, so the policy's mtime check is disabled by passing
    // `previousMtimeMs: undefined`; only the content-hash guard is evaluated.
    const skipDecision = evaluateTranspilationSkipPolicy({
        currentMtimeMs: fileStats.mtimeMs,
        previousMtimeMs: undefined,
        currentContent: source,
        previousContentHash: context.fileContentHashes.get(filePath)
    });

    if (skipDecision.action === "skip") {
        // Content bytes did not change since the last observation. Refresh
        // the cached mtime so a future duplicate event can short-circuit on
        // the cheaper mtime guard; the content hash stays the same.
        context.fileSnapshots.set(filePath, fileStats.mtimeMs);
        return;
    }

    context.fileSnapshots.set(filePath, fileStats.mtimeMs);
    context.fileContentHashes.set(filePath, skipDecision.contentHash);

    const roomData = Core.parseProjectMetadataDocument(source, filePath);
    if (roomData.resourceType !== "GMRoom") {
        if (options.verbose && !options.quiet) {
            console.log("  ↳ Ignored non-room GameMaker resource");
        }
        return;
    }

    const previousRoom = previousRooms.get(filePath);
    previousRooms.set(filePath, roomData);
    if (!previousRoom) {
        return;
    }

    const resourceName = typeof roomData.name === "string" ? roomData.name : getLayerName(roomData);
    if (resourceName === null) {
        return;
    }
    const layerUpdates = diffRoomBackgroundLayers(previousRoom, roomData);
    if (layerUpdates.length === 0) {
        return;
    }

    const patch = createResourcePatch(filePath, resourceName, layerUpdates, skipDecision.contentHash);
    context.resourcePatches.set(patch.id, patch);
    context.totalPatchCount += 1;
    context.websocketServer?.broadcast(patch);
}

/** Seeds the room cache without emitting a patch during watcher start-up. */
export async function primeRoomResource(
    filePath: string,
    context: Pick<ResourceChangeContext, "fileSnapshots" | "fileContentHashes">,
    previousRooms: Map<string, JsonObject>
): Promise<void> {
    const [fileStats, source] = await Promise.all([stat(filePath), readFile(filePath, "utf8")]);
    const roomData = Core.parseProjectMetadataDocument(source, filePath);
    context.fileSnapshots.set(filePath, fileStats.mtimeMs);
    context.fileContentHashes.set(filePath, hashSourceContent(source));
    if (roomData.resourceType === "GMRoom") {
        previousRooms.set(filePath, roomData);
    }
}
