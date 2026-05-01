import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";

type RuntimeOptions = Readonly<{
    args?: string;
    expression?: string;
    instanceId?: string;
    json?: boolean;
    kind?: "audio" | "camera" | "draw" | "room";
    method?: string;
    path?: string;
    scope?: "global" | "instance";
    value?: string;
}>;

function printRuntimePayload(command: string, payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(
            JSON.stringify(
                {
                    command,
                    payload
                },
                null,
                2
            )
        );
        return;
    }
    console.log(JSON.stringify({ command, payload }, null, 2));
}

function runRuntimeReadAction(command: string, options: RuntimeOptions): void {
    printRuntimePayload(command, { ok: true, options }, options.json === true);
}

function failRuntimeMutation(command: string): never {
    throw new Error(`runtime ${command} mutation backend is not implemented yet.`);
}

export function createRuntimeCommand(): Command {
    const command = applyStandardCommandOptions(new Command("runtime")).description(
        "Inspect and interact with runtime state."
    );

    const shared = (nested: Command): Command => nested.option("--json", "Emit JSON output.");

    const instances = shared(
        applyStandardCommandOptions(new Command("instances")).description("List runtime instances.")
    );
    instances.action(async function runtimeInstancesAction() {
        runRuntimeReadAction("runtime instances", this.opts<RuntimeOptions>());
    });

    const inspect = shared(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one runtime instance.")
            .option("--instance-id <id>", "Runtime instance id.")
    );
    inspect.action(async function runtimeInspectAction() {
        runRuntimeReadAction("runtime inspect", this.opts<RuntimeOptions>());
    });

    const get = shared(
        applyStandardCommandOptions(new Command("get"))
            .description("Read a runtime value.")
            .option("--path <path>", "Property path.")
            .option("--scope <scope>", "Scope: instance or global.", "instance")
            .option("--instance-id <id>", "Runtime instance id.")
    );
    get.action(async function runtimeGetAction() {
        runRuntimeReadAction("runtime get", this.opts<RuntimeOptions>());
    });

    const set = shared(
        applyStandardCommandOptions(new Command("set"))
            .description("Set a runtime value.")
            .requiredOption("--path <path>", "Property path.")
            .requiredOption("--value <value>", "New value.")
            .option("--scope <scope>", "Scope: instance or global.", "instance")
            .option("--instance-id <id>", "Runtime instance id.")
    );
    set.action(async function runtimeSetAction() {
        failRuntimeMutation("set");
    });

    const call = shared(
        applyStandardCommandOptions(new Command("call"))
            .description("Call a runtime method/function.")
            .requiredOption("--method <name>", "Method/function name.")
            .option("--args <json>", "JSON encoded arguments.")
            .option("--instance-id <id>", "Runtime instance id.")
    );
    call.action(async function runtimeCallAction() {
        failRuntimeMutation("call");
    });

    const watch = shared(
        applyStandardCommandOptions(new Command("watch"))
            .description("Watch runtime expression changes.")
            .requiredOption("--expression <expr>", "Expression to watch.")
    );
    watch.action(async function runtimeWatchAction() {
        runRuntimeReadAction("runtime watch", this.opts<RuntimeOptions>());
    });

    const state = shared(
        applyStandardCommandOptions(new Command("state"))
            .description("Read coarse runtime state domain.")
            .option("--kind <kind>", "State kind.", "room")
    );
    state.action(async function runtimeStateAction() {
        runRuntimeReadAction("runtime state", this.opts<RuntimeOptions>());
    });

    const logs = shared(applyStandardCommandOptions(new Command("logs")).description("Read runtime logs."));
    logs.action(async function runtimeLogsAction() {
        runRuntimeReadAction("runtime logs", this.opts<RuntimeOptions>());
    });

    command.addCommand(instances);
    command.addCommand(inspect);
    command.addCommand(get);
    command.addCommand(set);
    command.addCommand(call);
    command.addCommand(watch);
    command.addCommand(state);
    command.addCommand(logs);

    return command;
}
