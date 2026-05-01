import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import {
    ensurePlannedSurfaceGraphIndex,
    type PlannedSurfaceSharedOptions,
    printPlannedSurfacePayload
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

function printObjectPayload(payload: unknown, options: PlannedSurfaceSharedOptions): void {
    printPlannedSurfacePayload(payload, options.json === true);
}

function emitObjectUnavailableLeaf(
    commandName: string,
    options: PlannedSurfaceSharedOptions,
    capability: string,
    details: Record<string, unknown> = {}
): void {
    printObjectPayload(
        {
            command: commandName,
            ok: true,
            payload: {
                capability,
                details,
                state: "not_available"
            }
        },
        options
    );
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
        printObjectPayload({ command: "object list", ok: true, payload }, options);
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
        printObjectPayload({ command: "object inspect", ok: payload !== null, payload }, options);
    });

    const update = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Update object.")
            .argument("<object>", "Object name")
    );
    update.action(function objectUpdateAction(objectName: string) {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        emitObjectUnavailableLeaf("object update", options, "object_property_mutation", { object: objectName });
    });

    const validate = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate object metadata.")
    );
    validate.action(async function objectValidateAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        const context = await ensurePlannedSurfaceGraphIndex(options);
        const objects = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "object");
        printObjectPayload(
            {
                command: "object validate",
                ok: true,
                payload: {
                    objectCount: objects.length,
                    state: "available"
                }
            },
            options
        );
    });

    const event = applyStandardCommandOptions(new Command("event")).description("Object event operations.");
    for (const eventLeaf of ["list", "inspect", "add", "update", "delete"]) {
        const nested = addObjectSharedOptions(
            applyStandardCommandOptions(new Command(eventLeaf)).description(`Object event ${eventLeaf}.`)
        );
        nested.action(function objectEventLeafAction() {
            const options = this.opts<PlannedSurfaceSharedOptions>();
            emitObjectUnavailableLeaf(`object event ${eventLeaf}`, options, "object_event_mutation");
        });
        event.addCommand(nested);
    }

    command.addCommand(list);
    command.addCommand(inspect);
    command.addCommand(update);
    command.addCommand(validate);
    command.addCommand(event);
    return command;
}
