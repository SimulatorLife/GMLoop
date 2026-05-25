import { Semantic } from "@gmloop/semantic";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption, createWriteOption } from "../cli-core/shared-command-options.js";
import {
    ensureProjectGraphIndex,
    printProjectPayload,
    type SharedProjectContextOptions
} from "../workflow/project-root.js";

function addObjectSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--force", "Rebuild graph index before query.")
        .option("--json", "Emit JSON output.");
}

const OBJECT_NAME_ARGUMENT_DESCRIPTION = "Object name";
const OBJECT_EVENT_MUTATION_CAPABILITY = "object_event_mutation";
const EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION = "Event descriptor (category:event)";

function printObjectPayload(payload: unknown): void {
    printProjectPayload(payload);
}

type ObjectMutationOptions = SharedProjectContextOptions &
    Readonly<{
        write?: boolean;
    }>;

function emitObjectUnavailableLeaf(
    commandName: string,
    options: ObjectMutationOptions,
    capability: string,
    details: Record<string, unknown> = {}
): void {
    printObjectPayload({
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

export function createObjectCommand(): Command {
    const command = applyStandardCommandOptions(new Command("object")).description(
        "Inspect and mutate object resources."
    );

    const list = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("list")).description("List object resources.")
    );
    list.action(async function objectListAction() {
        const options = this.opts<SharedProjectContextOptions>();
        const context = await ensureProjectGraphIndex(options);
        const payload = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "object");
        printObjectPayload({ command: "object list", ok: true, payload });
    });

    const inspect = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one object.")
            .argument("<object>", "Object name or graph node id.")
    );
    inspect.action(async function objectInspectAction(objectNameOrId: string) {
        const options = this.opts<SharedProjectContextOptions>();
        const context = await ensureProjectGraphIndex(options);
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
        printObjectPayload({ command: "object inspect", ok: payload !== null, payload });
    });

    const update = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Update object.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
    );
    update.action(function objectUpdateAction(objectName: string) {
        const options = this.opts<SharedProjectContextOptions>();
        emitObjectUnavailableLeaf("object update", options, "object_property_mutation", { object: objectName });
    });

    const validate = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate object metadata.")
    );
    validate.action(async function objectValidateAction() {
        const options = this.opts<SharedProjectContextOptions>();
        const context = await ensureProjectGraphIndex(options);
        const objects = Semantic.searchGraphIndex({
            databasePath: options.databasePath,
            projectConfig: context.projectConfig,
            projectRoot: context.projectRoot,
            query: "",
            toolsetRoot: options.toolsetRoot
        }).results.filter((entry) => entry.kind === "object");
        printObjectPayload({
            command: "object validate",
            ok: true,
            payload: {
                objectCount: objects.length,
                state: "available"
            }
        });
    });

    const event = applyStandardCommandOptions(new Command("event")).description("Object event operations.");

    const eventList = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("list"))
            .description("Object event list.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
    );
    eventList.action(function objectEventListAction(objectName: string) {
        const options = this.opts<ObjectMutationOptions>();
        emitObjectUnavailableLeaf("object event list", options, OBJECT_EVENT_MUTATION_CAPABILITY, {
            object: objectName
        });
    });

    const eventInspect = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Object event inspect.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
    );
    eventInspect.action(function objectEventInspectAction(objectName: string, eventDescriptor: string) {
        const options = this.opts<ObjectMutationOptions>();
        emitObjectUnavailableLeaf("object event inspect", options, OBJECT_EVENT_MUTATION_CAPABILITY, {
            event: eventDescriptor,
            object: objectName
        });
    });

    const eventAdd = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("add"))
            .description("Object event add.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
            .argument("<handler>", "Handler source snippet or statement block")
    ).addOption(createWriteOption());
    eventAdd.action(function objectEventAddAction(objectName: string, eventDescriptor: string, handler: string) {
        const options = this.opts<ObjectMutationOptions>();
        emitObjectUnavailableLeaf("object event add", options, OBJECT_EVENT_MUTATION_CAPABILITY, {
            event: eventDescriptor,
            handler,
            object: objectName
        });
    });

    const eventUpdate = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Object event update.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
            .argument("<handler>", "Updated handler source snippet or statement block")
    ).addOption(createWriteOption());
    eventUpdate.action(function objectEventUpdateAction(objectName: string, eventDescriptor: string, handler: string) {
        const options = this.opts<ObjectMutationOptions>();
        emitObjectUnavailableLeaf("object event update", options, OBJECT_EVENT_MUTATION_CAPABILITY, {
            event: eventDescriptor,
            handler,
            object: objectName
        });
    });

    const eventDelete = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("delete"))
            .description("Object event delete.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
    ).addOption(createWriteOption());
    eventDelete.action(function objectEventDeleteAction(objectName: string, eventDescriptor: string) {
        const options = this.opts<ObjectMutationOptions>();
        emitObjectUnavailableLeaf("object event delete", options, OBJECT_EVENT_MUTATION_CAPABILITY, {
            event: eventDescriptor,
            object: objectName
        });
    });

    event.addCommand(eventList);
    event.addCommand(eventInspect);
    event.addCommand(eventAdd);
    event.addCommand(eventUpdate);
    event.addCommand(eventDelete);

    command.addCommand(list);
    command.addCommand(inspect);
    command.addCommand(update);
    command.addCommand(validate);
    command.addCommand(event);
    return command;
}
