import { Refactor } from "@gmloop/refactor";
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
const EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION = "Event descriptor (category:event)";

type ObjectEventDescriptor = Readonly<{
    category: string;
    descriptor: string;
}>;

function printObjectPayload(payload: unknown): void {
    printProjectPayload(payload);
}

type ObjectMutationOptions = SharedProjectContextOptions &
    Readonly<{
        write?: boolean;
    }>;

type ObjectUpdateOptions = ObjectMutationOptions &
    Readonly<{
        clearParent?: boolean;
        clearSprite?: boolean;
        parent?: string;
        persistent?: string;
        solid?: string;
        sprite?: string;
        visible?: string;
    }>;

function parseObjectBooleanOption(value: string, optionName: string): boolean {
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    throw new TypeError(`Invalid ${optionName} value "${value}". Expected "true" or "false".`);
}

function toObjectPropertyMutationPayload(result: Awaited<ReturnType<typeof Refactor.updateObjectProperties>>) {
    return {
        action: result.action,
        changed: result.changed,
        dryRun: result.dryRun,
        objectName: result.objectName,
        objectPath: result.objectPath,
        parentObjectName: result.parentObjectName,
        persistent: result.persistent,
        solid: result.solid,
        spriteName: result.spriteName,
        visible: result.visible,
        warnings: result.warnings,
        writtenPaths: result.writtenPaths
    };
}

function toObjectEventMutationPayload(result: Awaited<ReturnType<typeof Refactor.addObjectEvent>>) {
    return {
        action: result.action,
        deletedPaths: result.deletedPaths,
        dryRun: result.dryRun,
        eventFilePath: result.eventFilePath,
        eventNumber: result.eventNumber,
        eventType: result.eventType,
        objectName: result.objectName,
        objectPath: result.objectPath,
        warnings: result.warnings,
        writtenPaths: result.writtenPaths
    };
}

function toObjectEventInspectionPayload(result: Awaited<ReturnType<typeof Refactor.inspectObjectEvent>>) {
    return {
        descriptor: result.descriptor,
        eventFilePath: result.eventFilePath,
        eventNumber: result.eventNumber,
        eventType: result.eventType,
        objectName: result.objectName,
        objectPath: result.objectPath,
        parse: result.parse,
        source: result.source
    };
}

async function runObjectEventAddAction(
    objectName: string,
    eventDescriptor: ObjectEventDescriptor,
    handler: string,
    options: ObjectMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.addObjectEvent({
        descriptor: eventDescriptor,
        dryRun: options.write !== true,
        handlerSource: handler,
        objectName,
        projectRoot: context.projectRoot
    });

    printObjectPayload({
        command: "object event add",
        ok: true,
        payload: toObjectEventMutationPayload(result)
    });
}

async function runObjectEventUpdateAction(
    objectName: string,
    eventDescriptor: ObjectEventDescriptor,
    handler: string,
    options: ObjectMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.updateObjectEvent({
        descriptor: eventDescriptor,
        dryRun: options.write !== true,
        handlerSource: handler,
        objectName,
        projectRoot: context.projectRoot
    });

    printObjectPayload({
        command: "object event update",
        ok: true,
        payload: toObjectEventMutationPayload(result)
    });
}

async function runObjectEventDeleteAction(
    objectName: string,
    eventDescriptor: ObjectEventDescriptor,
    options: ObjectMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.deleteObjectEvent({
        descriptor: eventDescriptor,
        dryRun: options.write !== true,
        objectName,
        projectRoot: context.projectRoot
    });

    printObjectPayload({
        command: "object event delete",
        ok: true,
        payload: toObjectEventMutationPayload(result)
    });
}

async function runObjectUpdateAction(objectName: string, options: ObjectUpdateOptions): Promise<void> {
    if (options.sprite !== undefined && options.clearSprite === true) {
        throw new TypeError("Object update accepts either --sprite or --clear-sprite, not both.");
    }
    if (options.parent !== undefined && options.clearParent === true) {
        throw new TypeError("Object update accepts either --parent or --clear-parent, not both.");
    }

    const spriteName = options.clearSprite === true ? null : options.sprite;
    const parentObjectName = options.clearParent === true ? null : options.parent;

    const context = await resolveCommandProjectContext(options);
    const result = await Refactor.updateObjectProperties({
        dryRun: options.write !== true,
        objectName,
        parentObjectName,
        persistent:
            options.persistent === undefined ? undefined : parseObjectBooleanOption(options.persistent, "--persistent"),
        projectRoot: context.projectRoot,
        solid: options.solid === undefined ? undefined : parseObjectBooleanOption(options.solid, "--solid"),
        spriteName,
        visible: options.visible === undefined ? undefined : parseObjectBooleanOption(options.visible, "--visible")
    });

    printObjectPayload({ command: "object update", ok: true, payload: toObjectPropertyMutationPayload(result) });
}

async function runObjectEventListAction(objectName: string, options: ObjectMutationOptions): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const events = await Refactor.listObjectEvents({
        objectName,
        projectRoot: context.projectRoot
    });
    printObjectPayload({
        command: "object event list",
        ok: true,
        payload: {
            events: events.map(toObjectEventInspectionPayload),
            object: objectName
        }
    });
}

async function runObjectEventInspectAction(
    objectName: string,
    eventDescriptor: ObjectEventDescriptor,
    options: ObjectMutationOptions
): Promise<void> {
    const context = await resolveCommandProjectContext(options);
    const event = await Refactor.inspectObjectEvent({
        descriptor: eventDescriptor,
        objectName,
        projectRoot: context.projectRoot
    });
    printObjectPayload({
        command: "object event inspect",
        ok: event.parse.ok,
        payload: toObjectEventInspectionPayload(event)
    });
}

function parseObjectEventDescriptor(eventDescriptor: string): ObjectEventDescriptor {
    const [rawCategory, ...rawDescriptorSegments] = eventDescriptor.split(":");
    const category = rawCategory?.trim() ?? "";
    const descriptor = rawDescriptorSegments.join(":").trim();
    if (category.length === 0 || descriptor.length === 0) {
        throw new Error(
            `Invalid event descriptor "${eventDescriptor}". Expected format: category:event (for example Step:Begin).`
        );
    }
    return {
        category,
        descriptor
    };
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
        const payload = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            }).results,
            "object"
        );
        printObjectPayload({ command: "object list", ok: true, payload });
    });

    const update = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Update object properties such as sprite, parent, visibility, solidity, and persistence.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .option("--sprite <name>", "Set the object's sprite resource by name.")
            .option("--clear-sprite", "Clear the object's sprite reference.")
            .option("--parent <name>", "Set the object's parent object resource by name.")
            .option("--clear-parent", "Clear the object's parent object reference.")
            .option("--visible <value>", "Set object visibility (true or false).")
            .option("--solid <value>", "Set whether the object is solid (true or false).")
            .option("--persistent <value>", "Set whether the object is persistent (true or false).")
    ).addOption(createWriteOption());
    update.action(async function objectUpdateAction(objectName: string) {
        try {
            await runObjectUpdateAction(objectName, this.opts<ObjectUpdateOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });

    const validate = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate object metadata.")
    );
    validate.action(async function objectValidateAction() {
        const options = this.opts<SharedProjectContextOptions>();
        const context = await ensureProjectGraphIndex(options);
        const objects = filterGraphIndexResultsByKind(
            Semantic.searchGraphIndex({
                databasePath: options.databasePath,
                projectConfig: context.projectConfig,
                projectRoot: context.projectRoot,
                query: "",
                toolsetRoot: options.toolsetRoot
            }).results,
            "object"
        );
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
    eventList.action(async function objectEventListAction(objectName: string) {
        try {
            await runObjectEventListAction(objectName, this.opts<ObjectMutationOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });

    const eventInspect = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Object event inspect.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
    );
    eventInspect.action(async function objectEventInspectAction(objectName: string, eventDescriptor: string) {
        try {
            const parsedDescriptor = parseObjectEventDescriptor(eventDescriptor);
            await runObjectEventInspectAction(objectName, parsedDescriptor, this.opts<ObjectMutationOptions>());
        } catch (error) {
            handleCliError(error);
        }
    });

    const eventAdd = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("add"))
            .description("Object event add.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
            .argument("<handler>", "Handler source snippet or statement block")
    ).addOption(createWriteOption());
    eventAdd.action(async function objectEventAddAction(objectName: string, eventDescriptor: string, handler: string) {
        try {
            const options = this.opts<ObjectMutationOptions>();
            const parsedDescriptor = parseObjectEventDescriptor(eventDescriptor);
            await runObjectEventAddAction(objectName, parsedDescriptor, handler, options);
        } catch (error) {
            handleCliError(error);
        }
    });

    const eventUpdate = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Object event update.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
            .argument("<handler>", "Updated handler source snippet or statement block")
    ).addOption(createWriteOption());
    eventUpdate.action(async function objectEventUpdateAction(
        objectName: string,
        eventDescriptor: string,
        handler: string
    ) {
        try {
            const options = this.opts<ObjectMutationOptions>();
            const parsedDescriptor = parseObjectEventDescriptor(eventDescriptor);
            await runObjectEventUpdateAction(objectName, parsedDescriptor, handler, options);
        } catch (error) {
            handleCliError(error);
        }
    });

    const eventDelete = addObjectSharedOptions(
        applyStandardCommandOptions(new Command("delete"))
            .description("Object event delete.")
            .argument("<object>", OBJECT_NAME_ARGUMENT_DESCRIPTION)
            .argument("<event>", EVENT_DESCRIPTOR_ARGUMENT_DESCRIPTION)
    ).addOption(createWriteOption());
    eventDelete.action(async function objectEventDeleteAction(objectName: string, eventDescriptor: string) {
        try {
            const options = this.opts<ObjectMutationOptions>();
            const parsedDescriptor = parseObjectEventDescriptor(eventDescriptor);
            await runObjectEventDeleteAction(objectName, parsedDescriptor, options);
        } catch (error) {
            handleCliError(error);
        }
    });

    event.addCommand(eventList);
    event.addCommand(eventInspect);
    event.addCommand(eventAdd);
    event.addCommand(eventUpdate);
    event.addCommand(eventDelete);

    command.addCommand(list);
    command.addCommand(update);
    command.addCommand(validate);
    command.addCommand(event);
    return command;
}
