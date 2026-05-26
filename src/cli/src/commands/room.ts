import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption, createWriteOption } from "../cli-core/shared-command-options.js";
import {
    ensureProjectGraphIndex,
    printProjectPayload,
    type SharedProjectContextOptions
} from "../workflow/project-root.js";

type RoomCommandSharedOptions = SharedProjectContextOptions;

type RoomMutationOptions = SharedProjectContextOptions &
    Readonly<{
        write?: boolean;
    }>;

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

export function createRoomCommand(): Command {
    const command = applyStandardCommandOptions(new Command("room")).description(
        "Inspect room resources. Use `gm-cli resourcetool ...` for room edits."
    );

    const list = addRoomSharedOptions(applyStandardCommandOptions(new Command("list")).description("List rooms."));
    list.action(async function roomListAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const rooms = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "room");
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
        const resolvedId = roomNameOrId.includes("::")
            ? roomNameOrId
            : (Semantic.searchGraphIndex({
                  databasePath: options.databasePath,
                  projectConfig: context.projectConfig,
                  projectRoot: context.projectRoot,
                  query: roomNameOrId,
                  toolsetRoot: options.toolsetRoot
              }).results.find((entry) => entry.kind === "room")?.id ?? null);
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
        const payload = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: normalizedQuery,
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "room");

        printRoomPayload({ command: "room query", ok: true, payload });
    });

    const validate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate room resource data.")
    );
    validate.action(async function roomValidateAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensureProjectGraphIndex(options);
        const rooms = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "room");

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
        const rooms = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "room");

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
        const rooms = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "room");

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
    );
    repair.action(function roomRepairAction(roomName: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        emitRoomUnavailableLeaf("room repair", options, "room_repair", { room: roomName });
    });

    const instance = applyStandardCommandOptions(new Command("instance")).description("Room instance operations.");
    const instanceAdd = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("add")).description("Add room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<object>", "Object resource name")
        .argument("<x>", "Instance x coordinate")
        .argument("<y>", "Instance y coordinate")
        .addOption(createWriteOption());
    instanceAdd.action(function roomInstanceAddAction(roomName: string, objectName: string, x: string, y: string) {
        const options = this.opts<RoomMutationOptions>();
        emitRoomUnavailableLeaf("room instance add", options, "room_instance_mutation", {
            object: objectName,
            room: roomName,
            x,
            y
        });
    });
    const instanceUpdate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<instance-id>", "Room instance id")
        .argument("<x>", "Updated instance x coordinate")
        .argument("<y>", "Updated instance y coordinate")
        .addOption(createWriteOption());
    instanceUpdate.action(function roomInstanceUpdateAction(
        roomName: string,
        instanceId: string,
        x: string,
        y: string
    ) {
        const options = this.opts<RoomMutationOptions>();
        emitRoomUnavailableLeaf("room instance update", options, "room_instance_mutation", {
            instanceId,
            room: roomName,
            x,
            y
        });
    });
    const instanceDelete = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("delete")).description("Delete room instance.")
    )
        .argument("<room>", "Room name")
        .argument("<instance-id>", "Room instance id")
        .addOption(createWriteOption());
    instanceDelete.action(function roomInstanceDeleteAction(roomName: string, instanceId: string) {
        const options = this.opts<RoomMutationOptions>();
        emitRoomUnavailableLeaf("room instance delete", options, "room_instance_mutation", {
            instanceId,
            room: roomName
        });
    });
    instance.addCommand(instanceAdd);
    instance.addCommand(instanceUpdate);
    instance.addCommand(instanceDelete);

    const layer = applyStandardCommandOptions(new Command("layer")).description("Room layer operations.");
    const layerMutationLeaves = new Set(["create", "update", "delete", "reorder", "move-resource"]);
    for (const layerLeaf of ["list", "inspect", "create", "update", "delete", "reorder", "move-resource"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(layerLeaf)).description(`Room layer ${layerLeaf}.`)
        );
        if (layerMutationLeaves.has(layerLeaf)) {
            nested.addOption(createWriteOption());
        }
        nested.action(function roomLayerAction() {
            const options = this.opts<RoomMutationOptions>();
            emitRoomUnavailableLeaf(`room layer ${layerLeaf}`, options, "room_layer_mutation");
        });
        layer.addCommand(nested);
    }

    const camera = applyStandardCommandOptions(new Command("camera")).description("Room camera operations.");
    const cameraMutationLeaves = new Set(["update", "frame"]);
    for (const cameraLeaf of ["list", "inspect", "update", "frame"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(cameraLeaf)).description(`Room camera ${cameraLeaf}.`)
        );
        if (cameraMutationLeaves.has(cameraLeaf)) {
            nested.addOption(createWriteOption());
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
