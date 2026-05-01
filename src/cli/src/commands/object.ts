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

function addObjectSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--force", "Rebuild graph index before query.")
        .option("--json", "Emit JSON output.");
}

function addUnsupportedObjectLeaf(command: Command, commandName: string, message: string): void {
    command.action(function objectUnsupportedAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(commandName, options, message, [
            "Implement object metadata and event mutation backend in @gmloop/refactor.",
            "Expose object transaction execution in @gmloop/cli."
        ]);
    });
}

export function createObjectCommand(): Command {
    const command = applyStandardCommandOptions(new Command("object")).description(
        "Inspect and mutate object resources."
    );

    const list = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("list")).description("List object resources.")
    );
    list.action(async function objectListAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        const context = await ensurePlannedSurfaceGraphIndex(options);
        const payload = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "object");
        printPlannedSurfacePayload({ command: "object list", ok: true, payload }, options.json === true);
    });

    const inspect = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one object.")
            .argument("<object>", "Object name or graph node id.")
    );
    inspect.action(async function objectInspectAction(objectNameOrId: string) {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        const context = await ensurePlannedSurfaceGraphIndex(options);
        const resolvedId = objectNameOrId.includes("::")
            ? objectNameOrId
            : (Semantic.searchGraphIndex({
                  databasePath: options.databasePath,
                  projectConfig: context.projectConfig,
                  projectRoot: context.projectRoot,
                  query: objectNameOrId,
                  toolsetRoot: options.toolsetRoot
              }).results.find((entry) => entry.kind === "object")?.id ?? null);
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
        printPlannedSurfacePayload({ command: "object inspect", ok: payload !== null, payload }, options.json === true);
    });

    const update = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("update")).description("Update object.")
    );
    addUnsupportedObjectLeaf(update, "object update", "Object update backend is not implemented.");
    const validate = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate object metadata.")
    );
    addUnsupportedObjectLeaf(validate, "object validate", "Object validation backend is not implemented.");

    const event = applyStandardCommandOptions(new Command("event")).description("Object event operations.");
    for (const eventLeaf of ["list", "inspect", "add", "update", "delete"]) {
        const nested = addObjectSharedOptions(
            applyStandardCommandOptions(new Command(eventLeaf)).description(`Object event ${eventLeaf}.`)
        );
        addUnsupportedObjectLeaf(
            nested,
            `object event ${eventLeaf}`,
            `Object event ${eventLeaf} backend is not implemented.`
        );
        event.addCommand(nested);
    }

    command.addCommand(list);
    command.addCommand(inspect);
    command.addCommand(update);
    command.addCommand(validate);
    command.addCommand(event);
    return command;
}
