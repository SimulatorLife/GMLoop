import { Refactor } from "@gmloop/refactor";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption, createWriteOption } from "../cli-core/shared-command-options.js";
import {
    ensureProjectGraphIndex,
    printProjectPayload,
    type SharedProjectContextOptions
} from "../workflow/project-root.js";

type ScriptMutationOptions = SharedProjectContextOptions &
    Readonly<{
        write?: boolean;
    }>;

function printScriptPayload(payload: unknown): void {
    printProjectPayload(payload);
}

async function runScriptAddAction(scriptName: string, options: ScriptMutationOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);

    const result = await Refactor.addProjectResource({
        dryRun: options.write !== true,
        projectRoot: context.projectRoot,
        resourceKind: "script",
        resourceName: scriptName
    });

    printScriptPayload({
        command: "script add",
        ok: true,
        payload: {
            action: result.action,
            deletedPaths: result.deletedPaths,
            dryRun: result.dryRun,
            manifestPath: result.manifestPath,
            resourceKind: result.resourceKind,
            resourceName: result.resourceName,
            resourcePath: result.resourcePath,
            warnings: result.warnings,
            writtenPaths: result.writtenPaths
        }
    });
}

function emitScriptNotFoundLeaf(
    commandName: string,
    options: ScriptMutationOptions,
    details: Record<string, unknown> = {}
): void {
    printScriptPayload({
        command: commandName,
        ok: true,
        payload: {
            details,
            mode: options.write === true ? "apply" : "dry-run",
            state: "not_available"
        }
    });
}

export function createScriptCommand(): Command {
    const command = applyStandardCommandOptions(new Command("script")).description(
        "Inspect and mutate script resources."
    );

    const list = applyStandardCommandOptions(new Command("list")).description("List script resources.");
    list.addOption(createPathOption()).addOption(createConfigOption());
    list.action(async function scriptListAction() {
        const options = this.opts<SharedProjectContextOptions>();
        const context = await ensureProjectGraphIndex(options);
        const payload = context.projectConfig;
        printScriptPayload({ command: "script list", ok: true, payload });
    });

    const add = applyStandardCommandOptions(new Command("add"))
        .description("Create a new script resource.")
        .argument("<name>", "Script resource name.")
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption());
    add.action(async function scriptAddAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        await runScriptAddAction(scriptName, options);
    });

    const inspect = applyStandardCommandOptions(new Command("inspect"))
        .description("Inspect a script resource.")
        .argument("<name>", "Script name.")
        .addOption(createPathOption())
        .addOption(createConfigOption());
    inspect.action(function scriptInspectAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script inspect", options, { script: scriptName });
    });

    const update = applyStandardCommandOptions(new Command("update"))
        .description("Update a script resource.")
        .argument("<name>", "Script name.")
        .addOption(createPathOption())
        .addOption(createConfigOption());
    update.action(function scriptUpdateAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script update", options, { script: scriptName });
    });

    const remove = applyStandardCommandOptions(new Command("remove"))
        .description("Remove a script resource.")
        .argument("<name>", "Script name.")
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption());
    remove.action(function scriptRemoveAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script remove", options, { script: scriptName });
    });

    const rename = applyStandardCommandOptions(new Command("rename"))
        .description("Rename a script resource.")
        .argument("<from>", "Current script name.")
        .argument("<to>", "New script name.")
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption());
    rename.action(function scriptRenameAction(from: string, to: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script rename", options, { from, to });
    });

    const duplicate = applyStandardCommandOptions(new Command("duplicate"))
        .description("Duplicate a script resource.")
        .argument("<source>", "Source script name.")
        .argument("<target>", "Target script name.")
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .addOption(createWriteOption());
    duplicate.action(function scriptDuplicateAction(source: string, target: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script duplicate", options, { source, target });
    });

    command.addCommand(list);
    command.addCommand(add);
    command.addCommand(inspect);
    command.addCommand(update);
    command.addCommand(remove);
    command.addCommand(rename);
    command.addCommand(duplicate);
    return command;
}
