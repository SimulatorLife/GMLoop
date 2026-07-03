import {
    Refactor,
    type RoomCameraMutationResult,
    type RoomInstanceInspectionResult,
    type RoomInstanceMutationResult,
    type RoomLayerMutationResult,
    type RoomRepairResult
} from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createConfigOption, createPathOption, createWriteOption } from "../cli-core/shared-command-options.js";
import {
    ensureProjectGraphIndex,
    filterGraphIndexResultsByKind,
    printProjectPayload,
    resolveCommandProjectContext,
    type SharedProjectContextOptions
} from "../workflow/project-root.js";

type RoomCommandSharedOptions = SharedProjectContextOptions;

type RoomMutationOptions = SharedProjectContextOptions &
    Readonly<{
        depth?: string;
        name?: string;
        padding?: string;
        write?: boolean;
    }>;

const ROOM_LAYER_NAME_ARGUMENT_DESCRIPTION = "Layer name";

function addRoomSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--force", "Rebuild graph index before query.")
        .option("--json", "Emit JSON output.");
}

function printRoomPayload(payload: unknown): void {
    printProjectPayload(payload);
}

function parseCoordinateArgument(value: string, argumentName: "x" | "y"): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new TypeError(`Invalid ${argumentName} coordinate "${value}". Expected a finite numeric value.`);
    }
    return parsed;
}

function parseLayerDepthArgument(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new TypeError(`Invalid room layer depth "${value}". Expected an integer value.`);
    }
    return parsed;
}

function parseLayerIndexArgument(value: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new TypeError(`Invalid room layer index "${value}". Expected a zero-based integer value.`);
    }
    return parsed;
}

function parsePositiveDimensionArgument(value: string, argumentName: "height" | "width"): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new TypeError(`Invalid ${argumentName} dimension "${value}". Expected a positive finite numeric value.`);
    }
    return parsed;
}

function parseNonNegativePaddingArgument(value: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new TypeError(`Invalid room camera padding "${value}". Expected a non-negative finite numeric value.`);
    }
    return parsed;
}

function toRoomInstanceMutationPayload(result: RoomInstanceMutationResult) {
    return {
        action: result.action,
        deletedPaths: result.deletedPaths,
        dryRun: result.dryRun,
        instanceId: result.instanceId,
        layerName: result.layerName,
        objectName: result.objectName,
        objectPath: result.objectPath,
        roomName: result.roomName,
        roomPath: result.roomPath,
        warnings: result.warnings,
        writtenPaths: result.writtenPaths,
        x: result.x,
        y: result.y
    };
}

function toRoomInstanceInspectionPayload(result: RoomInstanceInspectionResult) {
    return {
        instanceId: result.instanceId,
        layerName: result.layerName,
        objectName: result.objectName,
        objectPath: result.objectPath,
        roomName: result.roomName,
        roomPath: result.roomPath,
        x: result.x,
        y: result.y
    };
}

function toRoomLayerMutationPayload(result: RoomLayerMutationResult) {
    return {
        action: result.action,
        changed: result.changed,
        deletedPaths: result.deletedPaths,
        depth: result.depth,
        dryRun: result.dryRun,
        layerIndex: result.layerIndex,
        layerName: result.layerName,
        layerType: result.layerType,
        previousLayerIndex: result.previousLayerIndex,
        roomName: result.roomName,
        roomPath: result.roomPath,
        warnings: result.warnings,
        writtenPaths: result.writtenPaths
    };
}

function toRoomCameraMutationPayload(result: RoomCameraMutationResult) {
    return {
        action: result.action,
        cameraId: result.cameraId,
        deletedPaths: result.deletedPaths,
        dryRun: result.dryRun,
        framedInstanceCount: result.framedInstanceCount,
        height: result.height,
        layerName: result.layerName,
        roomName: result.roomName,
        roomPath: result.roomPath,
        warnings: result.warnings,
        width: result.width,
        writtenPaths: result.writtenPaths,
        x: result.x,
        y: result.y
    };
}

function toRoomRepairPayload(result: RoomRepairResult) {
    return {
        action: result.action,
        changed: result.changed,
        deletedPaths: result.deletedPaths,
        diagnostics: result.diagnostics,
        dryRun: result.dryRun,
        repairs: result.repairs,
        roomName: result.roomName,
        roomPath: result.roomPath,
        warnings: result.warnings,
        writtenPaths: result.writtenPaths
    };
}

function toRoomLayerInspectionPayload(result: Awaited<ReturnType<typeof Refactor.inspectRoomLayer>>) {
    return {
        depth: result.depth,
        instanceCount: result.instanceCount,
        layerName: result.layerName,
        layerType: result.layerType,
        roomName: result.roomName,
        roomPath: result.roomPath,
        subLayerCount: result.subLayerCount,
        visible: result.visible
    };
}

function toRoomCameraInspectionPayload(result: Awaited<ReturnType<typeof Refactor.inspectRoomCamera>>) {
    return {
        cameraId: result.cameraId,
        enabled: result.enabled,
        height: result.height,
        portHeight: result.portHeight,
        portWidth: result.portWidth,
        portX: result.portX,
        portY: result.portY,
        roomName: result.roomName,
        roomPath: result.roomPath,
        visible: result.visible,
        width: result.width,
        x: result.x,
        y: result.y
    };
}

async function runRoomLayerCreateAction(
    roomName: string,
    layerName: string,
    depth: number,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.createRoomLayer({
        depth,
        dryRun: options.write !== true,
        layerName,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room layer create", ok: true, payload: toRoomLayerMutationPayload(result) });
}

async function runRoomLayerUpdateAction(
    roomName: string,
    layerName: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.updateRoomLayer({
        depth: options.depth === undefined ? null : parseLayerDepthArgument(options.depth),
        dryRun: options.write !== true,
        layerName,
        newLayerName: options.name ?? null,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room layer update", ok: true, payload: toRoomLayerMutationPayload(result) });
}

async function runRoomLayerDeleteAction(
    roomName: string,
    layerName: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.deleteRoomLayer({
        dryRun: options.write !== true,
        layerName,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room layer delete", ok: true, payload: toRoomLayerMutationPayload(result) });
}

async function runRoomLayerReorderAction(
    roomName: string,
    layerName: string,
    layerIndex: number,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.reorderRoomLayer({
        dryRun: options.write !== true,
        layerIndex,
        layerName,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room layer reorder", ok: true, payload: toRoomLayerMutationPayload(result) });
}

async function runRoomCameraUpdateAction(
    roomName: string,
    cameraId: string,
    x: number,
    y: number,
    width: number,
    height: number,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.updateRoomCamera({
        cameraId,
        dryRun: options.write !== true,
        height,
        projectRoot: context.projectRoot,
        roomName,
        width,
        x,
        y
    });

    printRoomPayload({ command: "room camera update", ok: true, payload: toRoomCameraMutationPayload(result) });
}

async function runRoomCameraFrameAction(
    roomName: string,
    cameraId: string,
    layerName: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.frameRoomCamera({
        cameraId,
        dryRun: options.write !== true,
        layerName,
        padding: options.padding === undefined ? 0 : parseNonNegativePaddingArgument(options.padding),
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room camera frame", ok: true, payload: toRoomCameraMutationPayload(result) });
}

async function runRoomRepairAction(roomName: string, options: RoomMutationOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.repairRoom({
        dryRun: options.write !== true,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room repair", ok: true, payload: toRoomRepairPayload(result) });
}

async function runRoomInstanceAddAction(
    roomName: string,
    objectName: string,
    x: number,
    y: number,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.addRoomInstance({
        dryRun: options.write !== true,
        objectName,
        projectRoot: context.projectRoot,
        roomName,
        x,
        y
    });

    printRoomPayload({ command: "room instance add", ok: true, payload: toRoomInstanceMutationPayload(result) });
}

async function runRoomInstanceUpdateAction(
    roomName: string,
    instanceId: string,
    x: number,
    y: number,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.updateRoomInstance({
        dryRun: options.write !== true,
        instanceId,
        projectRoot: context.projectRoot,
        roomName,
        x,
        y
    });

    printRoomPayload({ command: "room instance update", ok: true, payload: toRoomInstanceMutationPayload(result) });
}

async function runRoomInstanceDeleteAction(
    roomName: string,
    instanceId: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.deleteRoomInstance({
        dryRun: options.write !== true,
        instanceId,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({ command: "room instance delete", ok: true, payload: toRoomInstanceMutationPayload(result) });
}

async function runRoomInstanceListAction(roomName: string, options: RoomMutationOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const instances = await Refactor.listRoomInstances({
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({
        command: "room instance list",
        ok: true,
        payload: {
            instances: instances.map(toRoomInstanceInspectionPayload),
            room: roomName
        }
    });
}

async function runRoomInstanceInspectAction(
    roomName: string,
    instanceId: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const instance = await Refactor.inspectRoomInstance({
        instanceId,
        projectRoot: context.projectRoot,
        roomName
    });

    printRoomPayload({
        command: "room instance inspect",
        ok: true,
        payload: toRoomInstanceInspectionPayload(instance)
    });
}

function emitRoomUnavailableLeaf(
    commandName: string,
    options: RoomMutationOptions,
    capability: string,
    details: Record<string, unknown> = {}
): void {
    printRoomPayload({
        command: commandName,
        ok: true,
        payload: {
            capability,
            details,
            mode: options.write === true ? "apply" : "dry-run",
            state: "not_available"
        }
    });
}

async function runRoomLayerListAction(roomName: string, options: RoomMutationOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const layers = await Refactor.listRoomLayers({
        projectRoot: context.projectRoot,
        roomName
    });
    printRoomPayload({
        command: "room layer list",
        ok: true,
        payload: {
            layers: layers.map(toRoomLayerInspectionPayload),
            room: roomName
        }
    });
}

async function runRoomLayerInspectAction(
    roomName: string,
    layerName: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const layer = await Refactor.inspectRoomLayer({
        layerName,
        projectRoot: context.projectRoot,
        roomName
    });
    printRoomPayload({
        command: "room layer inspect",
        ok: true,
        payload: toRoomLayerInspectionPayload(layer)
    });
}

async function runRoomCameraListAction(roomName: string, options: RoomMutationOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const cameras = await Refactor.listRoomCameras({
        projectRoot: context.projectRoot,
        roomName
    });
    printRoomPayload({
        command: "room camera list",
        ok: true,
        payload: {
            cameras: cameras.map(toRoomCameraInspectionPayload),
            room: roomName
        }
    });
}

async function runRoomCameraInspectAction(
    roomName: string,
    cameraId: string,
    options: RoomMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const camera = await Refactor.inspectRoomCamera({
        cameraId,
        projectRoot: context.projectRoot,
        roomName
    });
    printRoomPayload({
        command: "room camera inspect",
        ok: true,
        payload: toRoomCameraInspectionPayload(camera)
    });
}

function createRoomLayerCommand(): Command {
    const layer = applyStandardCommandOptions(new Command("layer")).description("Room layer operations.");
    const layerMutationLeaves = new Set(["create", "update", "delete", "reorder", "move-resource"]);
    for (const layerLeaf of ["list", "inspect", "create", "update", "delete", "reorder", "move-resource"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(layerLeaf)).description(`Room layer ${layerLeaf}.`)
        );
        if (layerMutationLeaves.has(layerLeaf)) {
            nested.addOption(createWriteOption());
        }
        if (layerLeaf === "create") {
            nested
                .argument("<room>", "Room name")
                .argument("<layer>", ROOM_LAYER_NAME_ARGUMENT_DESCRIPTION)
                .argument("<depth>", "Layer depth");
            nested.action(async function roomLayerCreateAction(roomName: string, layerName: string, depth: string) {
                try {
                    const options = this.opts<RoomMutationOptions>();
                    await runRoomLayerCreateAction(roomName, layerName, parseLayerDepthArgument(depth), options);
                } catch (error) {
                    handleCliError(error);
                }
            });
            layer.addCommand(nested);
            continue;
        }
        if (layerLeaf === "update") {
            nested
                .argument("<room>", "Room name")
                .argument("<layer>", ROOM_LAYER_NAME_ARGUMENT_DESCRIPTION)
                .option("--name <layer-name>", "Updated layer name.")
                .option("--depth <depth>", "Updated layer depth.");
            nested.action(async function roomLayerUpdateAction(roomName: string, layerName: string) {
                try {
                    await runRoomLayerUpdateAction(roomName, layerName, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            layer.addCommand(nested);
            continue;
        }
        if (layerLeaf === "delete") {
            nested.argument("<room>", "Room name").argument("<layer>", ROOM_LAYER_NAME_ARGUMENT_DESCRIPTION);
            nested.action(async function roomLayerDeleteAction(roomName: string, layerName: string) {
                try {
                    await runRoomLayerDeleteAction(roomName, layerName, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            layer.addCommand(nested);
            continue;
        }
        if (layerLeaf === "reorder") {
            nested
                .argument("<room>", "Room name")
                .argument("<layer>", ROOM_LAYER_NAME_ARGUMENT_DESCRIPTION)
                .argument("<index>", "Zero-based layer index");
            nested.action(async function roomLayerReorderAction(roomName: string, layerName: string, index: string) {
                try {
                    await runRoomLayerReorderAction(
                        roomName,
                        layerName,
                        parseLayerIndexArgument(index),
                        this.opts<RoomMutationOptions>()
                    );
                } catch (error) {
                    handleCliError(error);
                }
            });
            layer.addCommand(nested);
            continue;
        }
        if (layerLeaf === "list") {
            nested.argument("<room>", "Room name");
            nested.action(async function roomLayerListAction(roomName: string) {
                try {
                    await runRoomLayerListAction(roomName, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            layer.addCommand(nested);
            continue;
        }
        if (layerLeaf === "inspect") {
            nested.argument("<room>", "Room name").argument("<layer>", ROOM_LAYER_NAME_ARGUMENT_DESCRIPTION);
            nested.action(async function roomLayerInspectAction(roomName: string, layerName: string) {
                try {
                    await runRoomLayerInspectAction(roomName, layerName, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            layer.addCommand(nested);
            continue;
        }
        nested.action(function roomLayerAction() {
            const options = this.opts<RoomMutationOptions>();
            emitRoomUnavailableLeaf(`room layer ${layerLeaf}`, options, "room_layer_mutation");
        });
        layer.addCommand(nested);
    }

    return layer;
}

export function createRoomCommand(): Command {
    const command = applyStandardCommandOptions(new Command("room")).description(
        "Inspect rooms and apply GMLoop-owned companion room mutations."
    );

    const list = addRoomSharedOptions(applyStandardCommandOptions(new Command("list")).description("List rooms."));
    list.action(async function roomListAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const rooms = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            }).results,
            "room"
        );
        printRoomPayload({ command: "room list", ok: true, payload: rooms });
    });

    const inspect = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one room.")
            .argument("<room>", "Room name or graph node id.")
    );
    inspect.action(async function roomInspectAction(roomNameOrId: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const results = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: roomNameOrId,
            toolsetRoot: options.toolsetRoot
        }).results;
        const resolvedId = roomNameOrId.includes("::")
            ? roomNameOrId
            : (filterGraphIndexResultsByKind(results, "room")[0]?.id ?? null);
        const payload =
            resolvedId === null
                ? null
                : Semantic.getGraphNode({
                      databasePath: options.databasePath,
                      nodeId: resolvedId,
                      projectConfig: context.projectConfig,
                      projectRoot: context.projectRoot,
                      toolsetRoot: options.toolsetRoot
                  });
        printRoomPayload({ command: "room inspect", ok: payload !== null, payload });
    });

    const query = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("query"))
            .description("Query room contents.")
            .argument("[text]", "Search text.")
    );
    query.action(async function roomQueryAction(text?: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const normalizedQuery = typeof text === "string" ? text : "";
        const payload = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: normalizedQuery,
                toolsetRoot: options.toolsetRoot
            }).results,
            "room"
        );

        printRoomPayload({ command: "room query", ok: true, payload });
    });

    const validate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate room resource data.")
    );
    validate.action(async function roomValidateAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const rooms = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            }).results,
            "room"
        );

        printRoomPayload({
            command: "room validate",
            ok: true,
            payload: {
                roomCount: rooms.length,
                state: "available"
            }
        });
    });

    const preview = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("preview")).description("Preview room layout output.")
    );
    preview.action(async function roomPreviewAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const rooms = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            }).results,
            "room"
        );

        printRoomPayload({
            command: "room preview",
            ok: true,
            payload: {
                roomIds: rooms.map((entry) => entry.id),
                state: "available"
            }
        });
    });

    const summary = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("summary")).description("Summarize room layout and dependencies.")
    );
    summary.action(async function roomSummaryAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const rooms = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            }).results,
            "room"
        );

        printRoomPayload({
            command: "room summary",
            ok: true,
            payload: {
                names: rooms.map((entry) => entry.name),
                roomCount: rooms.length
            }
        });
    });

    const update = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update a room.").argument("<room>", "Room name")
    );
    update.action(function roomUpdateAction(roomName: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        emitRoomUnavailableLeaf("room update", options, "room_property_mutation", { room: roomName });
    });

    const repair = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("repair")).description("Repair a room.").argument("<room>", "Room name")
    ).addOption(createWriteOption());
    repair.action(async function roomRepairAction(roomName: string) {
        try {
            await runRoomRepairAction(roomName, this.opts<RoomMutationOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });

    const instance = applyStandardCommandOptions(new Command("instance")).description("Room instance operations.");
    const instanceList = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("list")).description("List room instances.")
    ).argument("<room>", "Room name");
    instanceList.action(async function roomInstanceListAction(roomName: string) {
        try {
            await runRoomInstanceListAction(roomName, this.opts<RoomMutationOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });
    const instanceInspect = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("inspect")).description("Inspect room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<instance-id>", "Room instance id");
    instanceInspect.action(async function roomInstanceInspectAction(roomName: string, instanceId: string) {
        try {
            await runRoomInstanceInspectAction(roomName, instanceId, this.opts<RoomMutationOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });
    const instanceAdd = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("add")).description("Add room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<object>", "Object resource name")
        .argument("<x>", "Instance x coordinate")
        .argument("<y>", "Instance y coordinate")
        .addOption(createWriteOption());
    instanceAdd.action(async function roomInstanceAddAction(
        roomName: string,
        objectName: string,
        x: string,
        y: string
    ) {
        try {
            const options = this.opts<RoomMutationOptions>();
            const parsedX = parseCoordinateArgument(x, "x");
            const parsedY = parseCoordinateArgument(y, "y");
            await runRoomInstanceAddAction(roomName, objectName, parsedX, parsedY, options);
        } catch (error) {
            handleCliError(error);
        }
    });
    const instanceUpdate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<instance-id>", "Room instance id")
        .argument("<x>", "Updated instance x coordinate")
        .argument("<y>", "Updated instance y coordinate")
        .addOption(createWriteOption());
    instanceUpdate.action(async function roomInstanceUpdateAction(
        roomName: string,
        instanceId: string,
        x: string,
        y: string
    ) {
        try {
            const options = this.opts<RoomMutationOptions>();
            const parsedX = parseCoordinateArgument(x, "x");
            const parsedY = parseCoordinateArgument(y, "y");
            await runRoomInstanceUpdateAction(roomName, instanceId, parsedX, parsedY, options);
        } catch (error) {
            handleCliError(error);
        }
    });
    const instanceDelete = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("delete")).description("Delete room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<instance-id>", "Room instance id")
        .addOption(createWriteOption());
    instanceDelete.action(function roomInstanceDeleteAction(roomName: string, instanceId: string) {
        const options = this.opts<RoomMutationOptions>();
        return runRoomInstanceDeleteAction(roomName, instanceId, options);
    });
    instance.addCommand(instanceList);
    instance.addCommand(instanceInspect);
    instance.addCommand(instanceAdd);
    instance.addCommand(instanceUpdate);
    instance.addCommand(instanceDelete);

    const layer = createRoomLayerCommand();

    const camera = applyStandardCommandOptions(new Command("camera")).description("Room camera operations.");
    const cameraMutationLeaves = new Set(["update", "frame"]);
    for (const cameraLeaf of ["list", "inspect", "update", "frame"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(cameraLeaf)).description(`Room camera ${cameraLeaf}.`)
        );
        if (cameraMutationLeaves.has(cameraLeaf)) {
            nested.addOption(createWriteOption());
        }
        if (cameraLeaf === "update") {
            nested
                .argument("<room>", "Room name")
                .argument("<camera-id>", "Camera id")
                .argument("<x>", "Camera x coordinate")
                .argument("<y>", "Camera y coordinate")
                .argument("<width>", "Camera width")
                .argument("<height>", "Camera height");
            nested.action(async function roomCameraUpdateAction(
                roomName: string,
                cameraId: string,
                x: string,
                y: string,
                width: string,
                height: string
            ) {
                try {
                    const options = this.opts<RoomMutationOptions>();
                    const parsedX = parseCoordinateArgument(x, "x");
                    const parsedY = parseCoordinateArgument(y, "y");
                    const parsedWidth = parsePositiveDimensionArgument(width, "width");
                    const parsedHeight = parsePositiveDimensionArgument(height, "height");
                    await runRoomCameraUpdateAction(
                        roomName,
                        cameraId,
                        parsedX,
                        parsedY,
                        parsedWidth,
                        parsedHeight,
                        options
                    );
                } catch (error) {
                    handleCliError(error);
                }
            });
            camera.addCommand(nested);
            continue;
        }
        if (cameraLeaf === "frame") {
            nested
                .argument("<room>", "Room name")
                .argument("<camera-id>", "Camera id")
                .argument("<layer>", "Layer name")
                .option("--padding <pixels>", "Padding around framed instance coordinates.");
            nested.action(async function roomCameraFrameAction(roomName: string, cameraId: string, layerName: string) {
                try {
                    await runRoomCameraFrameAction(roomName, cameraId, layerName, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            camera.addCommand(nested);
            continue;
        }
        if (cameraLeaf === "list") {
            nested.argument("<room>", "Room name");
            nested.action(async function roomCameraListAction(roomName: string) {
                try {
                    await runRoomCameraListAction(roomName, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            camera.addCommand(nested);
            continue;
        }
        if (cameraLeaf === "inspect") {
            nested.argument("<room>", "Room name").argument("<camera-id>", "Camera id");
            nested.action(async function roomCameraInspectAction(roomName: string, cameraId: string) {
                try {
                    await runRoomCameraInspectAction(roomName, cameraId, this.opts<RoomMutationOptions>());
                } catch (error) {
                    handleCliError(error);
                }
            });
            camera.addCommand(nested);
            continue;
        }
        nested.action(function roomCameraAction() {
            const options = this.opts<RoomMutationOptions>();
            emitRoomUnavailableLeaf(`room camera ${cameraLeaf}`, options, "room_camera_mutation");
        });
        camera.addCommand(nested);
    }

    command.addCommand(list);
    command.addCommand(inspect);
    command.addCommand(query);
    command.addCommand(validate);
    command.addCommand(preview);
    command.addCommand(summary);
    command.addCommand(update);
    command.addCommand(repair);
    command.addCommand(instance);
    command.addCommand(layer);
    command.addCommand(camera);
    return command;
}
