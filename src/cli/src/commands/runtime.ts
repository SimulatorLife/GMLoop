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

type RuntimeStateRecord = Record<string, unknown>;
type RuntimeStateStore = {
    globals: RuntimeStateRecord;
    instances: Map<string, RuntimeStateRecord>;
    logs: Array<{ message: string; timestamp: number }>;
};

const DEFAULT_INSTANCE_ID = "instance-1";
const runtimeStateStore: RuntimeStateStore = {
    globals: {},
    instances: new Map<string, RuntimeStateRecord>(),
    logs: []
};

function appendRuntimeLog(message: string): void {
    runtimeStateStore.logs.push({
        message,
        timestamp: Date.now()
    });
}

function resolveRuntimeScopeStore(options: RuntimeOptions): RuntimeStateRecord {
    if (options.scope === "global") {
        return runtimeStateStore.globals;
    }
    const instanceId = options.instanceId ?? DEFAULT_INSTANCE_ID;
    const existing = runtimeStateStore.instances.get(instanceId);
    if (existing) {
        return existing;
    }
    const created: RuntimeStateRecord = {};
    runtimeStateStore.instances.set(instanceId, created);
    return created;
}

function parseRuntimeValue(value: string): unknown {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return "";
    }

    if (trimmed === "true") {
        return true;
    }
    if (trimmed === "false") {
        return false;
    }
    if (trimmed === "null") {
        return null;
    }

    const maybeNumber = Number(trimmed);
    if (Number.isFinite(maybeNumber) && String(maybeNumber) === trimmed) {
        return maybeNumber;
    }

    try {
        return JSON.parse(trimmed);
    } catch {
        return value;
    }
}

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

function runRuntimeInstancesAction(options: RuntimeOptions): void {
    const payload = Array.from(runtimeStateStore.instances.entries()).map(([instanceId, state]) => ({
        instanceId,
        keys: Object.keys(state).sort()
    }));
    printRuntimePayload("runtime instances", { ok: true, instances: payload }, options.json === true);
}

function runRuntimeInspectAction(options: RuntimeOptions): void {
    const instanceId = options.instanceId ?? DEFAULT_INSTANCE_ID;
    const state = runtimeStateStore.instances.get(instanceId) ?? {};
    printRuntimePayload("runtime inspect", { instanceId, ok: true, state }, options.json === true);
}

function runRuntimeGetAction(options: RuntimeOptions): void {
    const path = options.path ?? "";
    const scopeStore = resolveRuntimeScopeStore(options);
    const value = path.length > 0 ? scopeStore[path] : undefined;
    printRuntimePayload(
        "runtime get",
        { ok: path.length > 0 && value !== undefined, path, scope: options.scope ?? "instance", value },
        options.json === true
    );
}

function runRuntimeSetAction(options: RuntimeOptions): void {
    const path = options.path ?? "";
    const rawValue = options.value ?? "";
    const parsedValue = parseRuntimeValue(rawValue);
    const scopeStore = resolveRuntimeScopeStore(options);
    scopeStore[path] = parsedValue;
    appendRuntimeLog(`Set ${options.scope ?? "instance"}:${path}`);
    printRuntimePayload(
        "runtime set",
        { ok: true, path, scope: options.scope ?? "instance", value: parsedValue },
        options.json === true
    );
}

function runRuntimeCallAction(options: RuntimeOptions): void {
    const method = options.method ?? "";
    let argsPayload: unknown = [];
    if (typeof options.args === "string" && options.args.trim().length > 0) {
        try {
            argsPayload = JSON.parse(options.args);
        } catch {
            argsPayload = [options.args];
        }
    }
    appendRuntimeLog(`Call ${method}`);
    printRuntimePayload(
        "runtime call",
        {
            args: argsPayload,
            method,
            ok: true,
            result: null
        },
        options.json === true
    );
}

function runRuntimeWatchAction(options: RuntimeOptions): void {
    const expression = options.expression ?? "";
    const instanceCount = runtimeStateStore.instances.size;
    printRuntimePayload(
        "runtime watch",
        {
            expression,
            ok: true,
            sample: {
                globalsTrackedKeys: Object.keys(runtimeStateStore.globals).sort(),
                instanceCount
            }
        },
        options.json === true
    );
}

function runRuntimeStateAction(options: RuntimeOptions): void {
    const kind = options.kind ?? "room";
    const payload = {
        globals: Object.keys(runtimeStateStore.globals).sort(),
        kind,
        logs: runtimeStateStore.logs.length,
        trackedInstances: runtimeStateStore.instances.size
    };
    printRuntimePayload("runtime state", { ok: true, state: payload }, options.json === true);
}

function runRuntimeLogsAction(options: RuntimeOptions): void {
    printRuntimePayload("runtime logs", { ok: true, payload: runtimeStateStore.logs }, options.json === true);
}

export function createRuntimeCommand(): Command {
    const command = applyStandardCommandOptions(new Command("runtime")).description(
        "Inspect and interact with runtime state."
    );
    const runtimeInstanceIdOptionName = "--instance-id <id>";
    const runtimeInstanceIdOptionDescription = "Runtime instance id.";

    const shared = (nested: Command): Command => nested.option("--json", "Emit JSON output.");

    const instances = shared(
        applyStandardCommandOptions(new Command("instances")).description("List runtime instances.")
    );
    instances.action(function runtimeInstancesAction() {
        runRuntimeInstancesAction(this.opts<RuntimeOptions>());
    });

    const inspect = shared(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one runtime instance.")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    inspect.action(function runtimeInspectAction() {
        runRuntimeInspectAction(this.opts<RuntimeOptions>());
    });

    const get = shared(
        applyStandardCommandOptions(new Command("get"))
            .description("Read a runtime value.")
            .option("--path <path>", "Property path.")
            .option("--scope <scope>", "Scope: instance or global.", "instance")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    get.action(function runtimeGetAction() {
        runRuntimeGetAction(this.opts<RuntimeOptions>());
    });

    const set = shared(
        applyStandardCommandOptions(new Command("set"))
            .description("Set a runtime value.")
            .requiredOption("--path <path>", "Property path.")
            .requiredOption("--value <value>", "New value.")
            .option("--scope <scope>", "Scope: instance or global.", "instance")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    set.action(function runtimeSetAction() {
        runRuntimeSetAction(this.opts<RuntimeOptions>());
    });

    const call = shared(
        applyStandardCommandOptions(new Command("call"))
            .description("Call a runtime method/function.")
            .requiredOption("--method <name>", "Method/function name.")
            .option("--args <json>", "JSON encoded arguments.")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    call.action(function runtimeCallAction() {
        runRuntimeCallAction(this.opts<RuntimeOptions>());
    });

    const watch = shared(
        applyStandardCommandOptions(new Command("watch"))
            .description("Watch runtime expression changes.")
            .requiredOption("--expression <expr>", "Expression to watch.")
    );
    watch.action(function runtimeWatchAction() {
        runRuntimeWatchAction(this.opts<RuntimeOptions>());
    });

    const state = shared(
        applyStandardCommandOptions(new Command("state"))
            .description("Read coarse runtime state domain.")
            .option("--kind <kind>", "State kind.", "room")
    );
    state.action(function runtimeStateAction() {
        runRuntimeStateAction(this.opts<RuntimeOptions>());
    });

    const logs = shared(applyStandardCommandOptions(new Command("logs")).description("Read runtime logs."));
    logs.action(function runtimeLogsAction() {
        runRuntimeLogsAction(this.opts<RuntimeOptions>());
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
