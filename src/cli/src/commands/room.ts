import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import {
    ensurePlannedSurfaceGraphIndex,
    type PlannedSurfaceSharedOptions,
    printPlannedSurfacePayload,
    reportUnsupportedPlannedSurfaceBackend
} from "./planned-ai-surface-shared.js";

function addRoomSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--force", "Rebuild graph index before query.")
        .option("--json", "Emit JSON output.");
}

function addUnsupportedRoomLeaf(command: Command, commandName: string, message: string): void {
    command.action(function roomUnsupportedAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(commandName, options, message, [
            "Implement room metadata mutation/query backend in @gmloop/refactor and @gmloop/semantic.",
            "Expose transactional room operations in @gmloop/cli."
        ]);
    });
}

export function createRoomCommand(): Command {
    const command = applyStandardCommandOptions(new Command("room")).description("Inspect and mutate room resources.");

    const list = addRoomSharedOptions(applyStandardCommandOptions(new Command("list")).description("List rooms."));
    list.action(async function roomListAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        const context = await ensurePlannedSurfaceGraphIndex(options);
        const rooms = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "room");
        printPlannedSurfacePayload({ command: "room list", ok: true, payload: rooms }, options.json === true);
    });

    const inspect = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one room.")
            .argument("<room>", "Room name or graph node id.")
    );
    inspect.action(async function roomInspectAction(roomNameOrId: string) {
        const options = this.opts<PlannedSurfaceSharedOptions>();
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
        printPlannedSurfacePayload({ command: "room inspect", ok: payload !== null, payload }, options.json === true);
    });

    const query = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("query")).description("Query room contents.")
    );
    addUnsupportedRoomLeaf(query, "room query", "Room query backend is not implemented.");

    const validate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate room resource data.")
    );
    addUnsupportedRoomLeaf(validate, "room validate", "Room validation backend is not implemented.");

    const preview = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("preview")).description("Preview room layout output.")
    );
    addUnsupportedRoomLeaf(preview, "room preview", "Room preview backend is not implemented.");

    const summary = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("summary")).description("Summarize room layout and dependencies.")
    );
    addUnsupportedRoomLeaf(summary, "room summary", "Room summary backend is not implemented.");

    const create = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("create")).description("Create a room.")
    );
    addUnsupportedRoomLeaf(create, "room create", "Room create backend is not implemented.");
    const duplicate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("duplicate")).description("Duplicate a room.")
    );
    addUnsupportedRoomLeaf(duplicate, "room duplicate", "Room duplicate backend is not implemented.");
    const rename = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("rename")).description("Rename a room.")
    );
    addUnsupportedRoomLeaf(rename, "room rename", "Room rename backend is not implemented.");
    const remove = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("delete")).description("Delete a room.")
    );
    addUnsupportedRoomLeaf(remove, "room delete", "Room delete backend is not implemented.");
    const update = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update a room.")
    );
    addUnsupportedRoomLeaf(update, "room update", "Room update backend is not implemented.");
    const repair = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("repair")).description("Repair a room.")
    );
    addUnsupportedRoomLeaf(repair, "room repair", "Room repair backend is not implemented.");

    const instance = applyStandardCommandOptions(new Command("instance")).description("Room instance operations.");
    const instanceAdd = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("add")).description("Add room instance.")
    );
    addUnsupportedRoomLeaf(instanceAdd, "room instance add", "Room instance add backend is not implemented.");
    const instanceUpdate = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update room instance.")
    );
    addUnsupportedRoomLeaf(instanceUpdate, "room instance update", "Room instance update backend is not implemented.");
    const instanceDelete = addRoomSharedOptions(
        applyStandardCommandOptions(new Command("delete")).description("Delete room instance.")
    );
    addUnsupportedRoomLeaf(instanceDelete, "room instance delete", "Room instance delete backend is not implemented.");
    instance.addCommand(instanceAdd);
    instance.addCommand(instanceUpdate);
    instance.addCommand(instanceDelete);

    const layer = applyStandardCommandOptions(new Command("layer")).description("Room layer operations.");
    for (const layerLeaf of ["list", "inspect", "create", "update", "delete", "reorder", "move-resource"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(layerLeaf)).description(`Room layer ${layerLeaf}.`)
        );
        addUnsupportedRoomLeaf(
            nested,
            `room layer ${layerLeaf}`,
            `Room layer ${layerLeaf} backend is not implemented.`
        );
        layer.addCommand(nested);
    }

    const camera = applyStandardCommandOptions(new Command("camera")).description("Room camera operations.");
    for (const cameraLeaf of ["list", "inspect", "update", "frame"]) {
        const nested = addRoomSharedOptions(
            applyStandardCommandOptions(new Command(cameraLeaf)).description(`Room camera ${cameraLeaf}.`)
        );
        addUnsupportedRoomLeaf(
            nested,
            `room camera ${cameraLeaf}`,
            `Room camera ${cameraLeaf} backend is not implemented.`
        );
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
