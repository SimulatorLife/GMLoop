import { readFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import { createDefaultInstanceLayer, createDefaultRoomView, createDefaultRoomViews } from "./room-metadata-defaults.js";
import { locateRoomReference, type ResourceReference, writeRoomDocumentIfApplying } from "./room-resource-helpers.js";

const INSTANCE_LAYER_RESOURCE_TYPE = "GMRInstanceLayer";
const REQUIRED_ROOM_VIEW_COUNT = 8;

type RoomRepairContext = Readonly<{
    projectRoot: string;
    roomAbsolutePath: string;
    roomDocument: Record<string, unknown>;
    roomReference: ResourceReference;
}>;

/**
 * Parameters for repairing common GameMaker room metadata shape issues.
 */
export interface RepairRoomRequest {
    dryRun?: boolean;
    projectRoot: string;
    roomName: string;
}

/**
 * Diagnostic emitted while inspecting room metadata for repair.
 */
export interface RoomRepairDiagnostic {
    code: string;
    message: string;
    path: string;
    severity: "info" | "warning";
}

/**
 * One planned or applied room metadata repair.
 */
export interface RoomRepairAppliedRepair {
    code: string;
    path: string;
    summary: string;
}

/**
 * Summary returned after room repair planning or application.
 */
export interface RoomRepairResult {
    action: "repair";
    changed: boolean;
    deletedPaths: Array<string>;
    diagnostics: Array<RoomRepairDiagnostic>;
    dryRun: boolean;
    repairs: Array<RoomRepairAppliedRepair>;
    roomName: string;
    roomPath: string;
    warnings: Array<string>;
    writtenPaths: Array<string>;
}

type RepairAccumulator = {
    diagnostics: Array<RoomRepairDiagnostic>;
    repairs: Array<RoomRepairAppliedRepair>;
};

async function readRepairableRoomDocument(roomAbsolutePath: string): Promise<Record<string, unknown>> {
    return Core.parseProjectMetadataDocument(await readFile(roomAbsolutePath, "utf8"), roomAbsolutePath);
}

function addRepair(
    accumulator: RepairAccumulator,
    code: string,
    metadataPath: string,
    message: string,
    summary: string
): void {
    accumulator.diagnostics.push({
        code,
        message,
        path: metadataPath,
        severity: "warning"
    });
    accumulator.repairs.push({
        code,
        path: metadataPath,
        summary
    });
}

function readMetadataName(record: Record<string, unknown>): string | null {
    return Core.getNonEmptyString(record.name) ?? Core.getNonEmptyString(record["%Name"]);
}

function ensureRoomArrayField(
    roomDocument: Record<string, unknown>,
    fieldName: "instanceCreationOrder" | "layers" | "views",
    accumulator: RepairAccumulator
): Array<unknown> {
    const value = roomDocument[fieldName];
    if (Array.isArray(value)) {
        return value;
    }

    const replacement = fieldName === "views" ? createDefaultRoomViews() : [];
    roomDocument[fieldName] = replacement;
    addRepair(
        accumulator,
        `room.${fieldName}.not_array`,
        fieldName,
        `Room metadata field '${fieldName}' is not an array.`,
        `Replaced '${fieldName}' with a valid array.`
    );
    return replacement;
}

function ensureRoomViewSettings(roomDocument: Record<string, unknown>, accumulator: RepairAccumulator): void {
    const defaults = {
        clearDisplayBuffer: true,
        clearViewBackground: false,
        enableViews: false,
        inheritViewSettings: false
    };
    const viewSettings = Core.isObjectLike(roomDocument.viewSettings)
        ? (roomDocument.viewSettings as Record<string, unknown>)
        : {};
    if (!Core.isObjectLike(roomDocument.viewSettings)) {
        roomDocument.viewSettings = viewSettings;
        addRepair(
            accumulator,
            "room.viewSettings.not_object",
            "viewSettings",
            "Room viewSettings metadata is not an object.",
            "Replaced viewSettings with a valid object."
        );
    }

    for (const [fieldName, defaultValue] of Object.entries(defaults)) {
        if (typeof viewSettings[fieldName] === "boolean") {
            continue;
        }
        viewSettings[fieldName] = defaultValue;
        addRepair(
            accumulator,
            "room.viewSettings.invalid_field",
            `viewSettings.${fieldName}`,
            `Room viewSettings.${fieldName} is not a boolean.`,
            `Set viewSettings.${fieldName} to ${String(defaultValue)}.`
        );
    }
}

function ensureRoomViews(roomDocument: Record<string, unknown>, accumulator: RepairAccumulator): void {
    const views = ensureRoomArrayField(roomDocument, "views", accumulator);
    while (views.length < REQUIRED_ROOM_VIEW_COUNT) {
        views.push(createDefaultRoomView());
        addRepair(
            accumulator,
            "room.views.missing_entry",
            `views[${String(views.length - 1)}]`,
            "Room views metadata has fewer than eight entries.",
            "Added a default room view entry."
        );
    }

    for (let index = 0; index < views.length; index += 1) {
        if (Core.isObjectLike(views[index])) {
            continue;
        }
        views[index] = createDefaultRoomView();
        addRepair(
            accumulator,
            "room.views.invalid_entry",
            `views[${String(index)}]`,
            "Room view metadata entry is not an object.",
            "Replaced the malformed room view entry with defaults."
        );
    }
}

function normalizeLayerRecord(
    layerRecord: Record<string, unknown>,
    layerIndex: number,
    accumulator: RepairAccumulator
): void {
    if (!Array.isArray(layerRecord.layers)) {
        layerRecord.layers = [];
        addRepair(
            accumulator,
            "room.layer.sub_layers.not_array",
            `layers[${String(layerIndex)}].layers`,
            "Room layer sub-layer metadata is not an array.",
            "Replaced layer sub-layers with an empty array."
        );
    }

    if (layerRecord.resourceType !== INSTANCE_LAYER_RESOURCE_TYPE || Array.isArray(layerRecord.instances)) {
        return;
    }

    layerRecord.instances = [];
    addRepair(
        accumulator,
        "room.layer.instances.not_array",
        `layers[${String(layerIndex)}].instances`,
        "Room instance layer instances metadata is not an array.",
        "Replaced layer instances with an empty array."
    );
}

function ensureRoomLayers(roomDocument: Record<string, unknown>, accumulator: RepairAccumulator): void {
    const layers = ensureRoomArrayField(roomDocument, "layers", accumulator);
    let hasInstanceLayer = false;

    for (const [layerIndex, layer] of layers.entries()) {
        if (!Core.isObjectLike(layer)) {
            continue;
        }
        const layerRecord = layer as Record<string, unknown>;
        hasInstanceLayer = hasInstanceLayer || layerRecord.resourceType === INSTANCE_LAYER_RESOURCE_TYPE;
        normalizeLayerRecord(layerRecord, layerIndex, accumulator);
    }

    if (hasInstanceLayer) {
        return;
    }

    layers.unshift(createDefaultInstanceLayer("Instances", 0));
    addRepair(
        accumulator,
        "room.layers.missing_instance_layer",
        "layers",
        "Room does not contain an instance layer.",
        "Added a default instance layer named 'Instances'."
    );
}

function collectInstanceNames(roomDocument: Record<string, unknown>, accumulator: RepairAccumulator): Array<string> {
    const instanceNames: Array<string> = [];
    const seenNames = new Set<string>();
    const layers = ensureRoomArrayField(roomDocument, "layers", accumulator);
    for (const [layerIndex, layer] of layers.entries()) {
        if (!Core.isObjectLike(layer)) {
            continue;
        }
        const layerRecord = layer as Record<string, unknown>;
        if (layerRecord.resourceType !== INSTANCE_LAYER_RESOURCE_TYPE) {
            continue;
        }
        for (const [instanceIndex, instance] of Core.asArray(layerRecord.instances).entries()) {
            if (!Core.isObjectLike(instance)) {
                continue;
            }
            const instanceRecord = instance as Record<string, unknown>;
            const instanceName = readMetadataName(instanceRecord);
            if (instanceName === null || seenNames.has(instanceName)) {
                continue;
            }
            if (instanceRecord.name !== instanceName || instanceRecord["%Name"] !== instanceName) {
                addRepair(
                    accumulator,
                    "room.instance.name_mismatch",
                    `layers[${String(layerIndex)}].instances[${String(instanceIndex)}]`,
                    `Room instance metadata for '${instanceName}' has inconsistent name fields.`,
                    `Synchronized instance name fields for '${instanceName}'.`
                );
            }
            instanceRecord.name = instanceName;
            instanceRecord["%Name"] = instanceName;
            instanceNames.push(instanceName);
            seenNames.add(instanceName);
            accumulator.diagnostics.push({
                code: "room.instance.detected",
                message: `Found room instance '${instanceName}'.`,
                path: `layers[${String(layerIndex)}].instances[${String(instanceIndex)}]`,
                severity: "info"
            });
        }
    }
    return instanceNames;
}

function isCreationOrderEntryForInstance(
    entry: unknown,
    instanceNames: ReadonlySet<string>
): entry is Record<string, unknown> {
    if (!Core.isObjectLike(entry)) {
        return false;
    }
    const entryName = Core.getNonEmptyString((entry as Record<string, unknown>).name);
    return entryName !== null && instanceNames.has(entryName);
}

function synchronizeInstanceCreationOrder(
    roomDocument: Record<string, unknown>,
    roomPath: string,
    accumulator: RepairAccumulator
): void {
    const instanceNames = collectInstanceNames(roomDocument, accumulator);
    const expectedNames = new Set(instanceNames);
    const creationOrder = ensureRoomArrayField(roomDocument, "instanceCreationOrder", accumulator);
    const nextCreationOrder: Array<Record<string, string>> = [];
    const seenCreationNames = new Set<string>();

    for (const entry of creationOrder) {
        if (!isCreationOrderEntryForInstance(entry, expectedNames)) {
            addRepair(
                accumulator,
                "room.instanceCreationOrder.stale_entry",
                "instanceCreationOrder",
                "Room instanceCreationOrder contains a stale or malformed entry.",
                "Removed a stale or malformed instanceCreationOrder entry."
            );
            continue;
        }
        const entryName = Core.getNonEmptyString(entry.name);
        if (entryName === null || seenCreationNames.has(entryName)) {
            addRepair(
                accumulator,
                "room.instanceCreationOrder.duplicate_entry",
                "instanceCreationOrder",
                "Room instanceCreationOrder contains a duplicate entry.",
                "Removed a duplicate instanceCreationOrder entry."
            );
            continue;
        }
        if (entry.path !== roomPath) {
            addRepair(
                accumulator,
                "room.instanceCreationOrder.invalid_path",
                "instanceCreationOrder",
                `Room instanceCreationOrder entry '${entryName}' points at the wrong room path.`,
                `Updated instanceCreationOrder entry '${entryName}' to the current room path.`
            );
        }
        nextCreationOrder.push({ name: entryName, path: roomPath });
        seenCreationNames.add(entryName);
    }

    for (const instanceName of instanceNames) {
        if (seenCreationNames.has(instanceName)) {
            continue;
        }
        nextCreationOrder.push({ name: instanceName, path: roomPath });
        addRepair(
            accumulator,
            "room.instanceCreationOrder.missing_entry",
            "instanceCreationOrder",
            `Room instanceCreationOrder is missing instance '${instanceName}'.`,
            `Added instance '${instanceName}' to instanceCreationOrder.`
        );
    }

    if (
        nextCreationOrder.length !== creationOrder.length ||
        nextCreationOrder.some((entry, index) => {
            const previousEntry = creationOrder[index];
            const previousRecord = Core.isObjectLike(previousEntry) ? (previousEntry as Record<string, unknown>) : null;
            return previousRecord === null || previousRecord.name !== entry.name || previousRecord.path !== entry.path;
        })
    ) {
        roomDocument.instanceCreationOrder = nextCreationOrder;
    }
}

async function resolveRoomRepairContext(projectRootInput: string, roomName: string): Promise<RoomRepairContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const roomReference = locateRoomReference(getManifestResources(manifestDocument), roomName);
    const roomAbsolutePath = path.join(projectRoot, Core.fromPosixPath(roomReference.path));
    const roomDocument = await readRepairableRoomDocument(roomAbsolutePath);

    return Object.freeze({
        projectRoot,
        roomAbsolutePath,
        roomDocument,
        roomReference
    });
}

/**
 * Repair common room metadata shape issues used by autonomous room editing tools.
 *
 * @param request - Room repair request.
 * @returns Summary of the planned or applied repair.
 */
export async function repairRoom(request: RepairRoomRequest): Promise<RoomRepairResult> {
    const context = await resolveRoomRepairContext(request.projectRoot, request.roomName);
    const accumulator: RepairAccumulator = {
        diagnostics: [],
        repairs: []
    };

    ensureRoomLayers(context.roomDocument, accumulator);
    ensureRoomViewSettings(context.roomDocument, accumulator);
    ensureRoomViews(context.roomDocument, accumulator);
    synchronizeInstanceCreationOrder(context.roomDocument, context.roomReference.path, accumulator);

    const dryRun = request.dryRun !== false;
    const changed = accumulator.repairs.length > 0;
    if (changed) {
        await writeRoomDocumentIfApplying(dryRun, context.roomAbsolutePath, context.roomDocument);
    }

    return {
        action: "repair",
        changed,
        deletedPaths: [],
        diagnostics: accumulator.diagnostics,
        dryRun,
        repairs: accumulator.repairs,
        roomName: context.roomReference.name,
        roomPath: context.roomReference.path,
        warnings: [],
        writtenPaths: changed ? [context.roomReference.path] : []
    };
}
