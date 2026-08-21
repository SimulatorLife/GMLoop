import { Refactor } from "@gmloop/refactor";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import {
    addResourceQuerySharedOptions,
    printResourceCommandPayload,
    type ResourceMutationOptions
} from "../cli-core/resource-command-shared.js";
import { createWriteOption } from "../cli-core/shared-command-options.js";
import { ensureProjectGraphIndex, type SharedProjectContextOptions } from "../workflow/project-root.js";

type ScriptMutationOptions = ResourceMutationOptions;

async function runScriptAddAction(scriptName: string, options: ScriptMutationOptions): Promise<void> {
    const context = await ensureProjectGraphIndex(options);

    const result = await Refactor.addProjectResource({
        dryRun: options.write !== true,
        projectRoot: context.projectRoot,
        resourceKind: "script",
        resourceName: scriptName
    });

    printResourceCommandPayload({
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
    printResourceCommandPayload({
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

    const list = addResourceQuerySharedOptions(
        applyStandardCommandOptions(new Command("list")).description("List script resources.")
    );
    list.action(async function scriptListAction() {
        const options = this.opts<SharedProjectContextOptions>();
        const context = await ensureProjectGraphIndex(options);
        const payload = context.projectConfig;
        printResourceCommandPayload({ command: "script list", ok: true, payload });
    });

    const add = addResourceQuerySharedOptions(
        applyStandardCommandOptions(new Command("add"))
            .description("Create a new script resource.")
            .argument("<name>", "Script resource name.")
    ).addOption(createWriteOption());
    add.action(async function scriptAddAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        await runScriptAddAction(scriptName, options);
    });

    const update = addResourceQuerySharedOptions(
        applyStandardCommandOptions(new Command("update"))
            .description("Update a script resource.")
            .argument("<name>", "Script name.")
    );
    update.action(function scriptUpdateAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script update", options, { script: scriptName });
    });

    const remove = addResourceQuerySharedOptions(
        applyStandardCommandOptions(new Command("remove"))
            .description("Remove a script resource.")
            .argument("<name>", "Script name.")
    ).addOption(createWriteOption());
    remove.action(function scriptRemoveAction(scriptName: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script remove", options, { script: scriptName });
    });

    const rename = addResourceQuerySharedOptions(
        applyStandardCommandOptions(new Command("rename"))
            .description("Rename a script resource.")
            .argument("<from>", "Current script name.")
            .argument("<to>", "New script name.")
    ).addOption(createWriteOption());
    rename.action(function scriptRenameAction(from: string, to: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script rename", options, { from, to });
    });

    const duplicate = addResourceQuerySharedOptions(
        applyStandardCommandOptions(new Command("duplicate"))
            .description("Duplicate a script resource.")
            .argument("<source>", "Source script name.")
            .argument("<target>", "Target script name.")
    ).addOption(createWriteOption());
    duplicate.action(function scriptDuplicateAction(source: string, target: string) {
        const options = this.opts<ScriptMutationOptions>();
        emitScriptNotFoundLeaf("script duplicate", options, { source, target });
    });

    command.addCommand(list);
    command.addCommand(add);
    command.addCommand(update);
    command.addCommand(remove);
    command.addCommand(rename);
    command.addCommand(duplicate);
    return command;
}
