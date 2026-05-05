import { type ProjectResourceMutationResult, Refactor } from "@gmloop/refactor";
import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption, createWriteOption } from "../cli-core/shared-command-options.js";
import {
    ensurePlannedSurfaceGraphIndex,
    type PlannedSurfaceSharedOptions,
    printPlannedSurfacePayload,
    resolvePlannedSurfaceProjectContext
} from "./planned-ai-surface-shared.js";

type RoomCommandSharedOptions = PlannedSurfaceSharedOptions &
    Readonly<{
        newName?: string;
        write?: boolean;
    }>;

function addRoomSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--force", "Rebuild graph index before query.")
        .option("--json", "Emit JSON output.");
}

function printRoomPayload(payload: unknown): void {
    printPlannedSurfacePayload(payload);
}

function mapMutationResult(result: ProjectResourceMutationResult): {
    action: string;
    dryRun: boolean;
    resourceKind: string;
    resourceName: string;
    writtenPaths: ReadonlyArray<string>;
    deletedPaths: ReadonlyArray<string>;
    warnings: ReadonlyArray<string>;
} {
    return {
        action: result.action,
        deletedPaths: result.deletedPaths,
        dryRun: result.dryRun,
        resourceKind: result.resourceKind,
        resourceName: result.resourceName,
        warnings: result.warnings,
        writtenPaths: result.writtenPaths
    };
}

async function runRoomResourceMutation(
    commandName: string,
    options: RoomCommandSharedOptions,
    runMutation: (projectRoot: string) => Promise<ProjectResourceMutationResult>
): Promise<void> {
    const context = await resolvePlannedSurfaceProjectContext(options);
    const result = await runMutation(context.projectRoot);

    printRoomPayload({
        command: commandName,
        ok: true,
        payload: mapMutationResult(result)
    });
}

function emitRoomUnavailableLeaf(
    commandName: string,
    options: PlannedSurfaceSharedOptions,
    capability: string,
    details: Record<string, unknown> = {}
): void {
    printRoomPayload({
        command: commandName,
        ok: true,
        payload: {
            capability,
            details,
            state: "not_available"
        }
    });
}

export function createRoomCommand(): Command {
    const command = applyStandardCommandOptions(new Command("room")).description("Inspect and mutate room resources.");

    const list = addRoomSharedOptions(applyStandardCommandOptions(new Command("list")).description("List rooms."));
    list.action(async function roomListAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        const context = await ensurePlannedSurfaceGraphIndex(options);
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
        const context = await ensurePlannedSurfaceGraphIndex(options);
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
        const context = await ensurePlannedSurfaceGraphIndex(options);
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
        const context = await ensurePlannedSurfaceGraphIndex(options);
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
        const context = await ensurePlannedSurfaceGraphIndex(options);
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
        const context = await ensurePlannedSurfaceGraphIndex(options);
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

    const create = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("create")).description("Create a room.").argument("<room>", "Room name")
    );
    create.action(async function roomCreateAction(roomName: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        await runRoomResourceMutation("room create", options, (projectRoot) =>
            Refactor.addProjectResource({
                dryRun: !options.write,
                projectRoot,
                resourceKind: Refactor.ProjectResourceKind.ROOM,
                resourceName: roomName
            })
        );
    });

    const duplicate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("duplicate"))
            .description("Duplicate a room.")
            .argument("<room>", "Room name")
            .requiredOption("--new-name <name>", "New room name")
    );
    duplicate.action(async function roomDuplicateAction(roomName: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        await runRoomResourceMutation("room duplicate", options, (projectRoot) =>
            Refactor.duplicateProjectResource({
                dryRun: !options.write,
                newResourceName: options.newName ?? "",
                projectRoot,
                resourceKind: Refactor.ProjectResourceKind.ROOM,
                resourceName: roomName
            })
        );
    });

    const rename = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("rename"))
            .description("Rename a room.")
            .argument("<room>", "Current room name")
            .requiredOption("--new-name <name>", "New room name")
    );
    rename.action(async function roomRenameAction(roomName: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        await runRoomResourceMutation("room rename", options, (projectRoot) =>
            Refactor.renameProjectResource({
                dryRun: !options.write,
                newResourceName: options.newName ?? "",
                projectRoot,
                resourceKind: Refactor.ProjectResourceKind.ROOM,
                resourceName: roomName
            })
        );
    });

    const remove = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("delete")).description("Delete a room.").argument("<room>", "Room name")
    );
    remove.action(async function roomDeleteAction(roomName: string) {
        const options = this.opts<RoomCommandSharedOptions>();
        await runRoomResourceMutation("room delete", options, (projectRoot) =>
            Refactor.removeProjectResource({
                dryRun: !options.write,
                projectRoot,
                resourceKind: Refactor.ProjectResourceKind.ROOM,
                resourceName: roomName
            })
        );
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
    );
    instanceAdd.action(function roomInstanceAddAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        emitRoomUnavailableLeaf("room instance add", options, "room_instance_mutation");
    });
    const instanceUpdate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update room instance.")
    );
    instanceUpdate.action(function roomInstanceUpdateAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        emitRoomUnavailableLeaf("room instance update", options, "room_instance_mutation");
    });
    const instanceDelete = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("delete")).description("Delete room instance.")
    );
    instanceDelete.action(function roomInstanceDeleteAction() {
        const options = this.opts<RoomCommandSharedOptions>();
        emitRoomUnavailableLeaf("room instance delete", options, "room_instance_mutation");
    });
    instance.addCommand(instanceAdd);
    instance.addCommand(instanceUpdate);
    instance.addCommand(instanceDelete);

    const layer = applyStandardCommandOptions(new Command("layer")).description("Room layer operations.");
    for (const layerLeaf of ["list", "inspect", "create", "update", "delete", "reorder", "move-resource"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(layerLeaf)).description(`Room layer ${layerLeaf}.`)
        );
        nested.action(function roomLayerAction() {
            const options = this.opts<RoomCommandSharedOptions>();
            emitRoomUnavailableLeaf(`room layer ${layerLeaf}`, options, "room_layer_mutation");
        });
        layer.addCommand(nested);
    }

    const camera = applyStandardCommandOptions(new Command("camera")).description("Room camera operations.");
    for (const cameraLeaf of ["list", "inspect", "update", "frame"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(cameraLeaf)).description(`Room camera ${cameraLeaf}.`)
        );
        nested.action(function roomCameraAction() {
            const options = this.opts<RoomCommandSharedOptions>();
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
    command.addCommand(create);
    command.addCommand(duplicate);
    command.addCommand(rename);
    command.addCommand(remove);
    command.addCommand(update);
    command.addCommand(repair);
    command.addCommand(instance);
    command.addCommand(layer);
    command.addCommand(camera);
    return command;
}
