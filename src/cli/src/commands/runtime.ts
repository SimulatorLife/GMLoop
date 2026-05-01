import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { getRunnerStateStore } from "../modules/runtime/index.js";
import {
    readRuntimeProjectState,
    type RuntimeProjectState,
    writeRuntimeProjectState
} from "../modules/runtime/project-state-store.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

type RuntimeOptions = Readonly<{
    args?: string;
    expression?: string;
    instanceId?: string;
    json?: boolean;
    kind?: "audio" | "camera" | "draw" | "room";
    method?: string;
    path?: string;
    project?: string;
    scope?: "global" | "instance";
    value?: string;
}>;

type RuntimeStateRecord = Record<string, unknown>;

const DEFAULT_INSTANCE_ID = "instance-1";

function appendRuntimeLog(state: RuntimeProjectState, message: string): RuntimeProjectState {
    return {
        ...state,
        logs: [
            ...state.logs,
            {
                message,
                timestamp: Date.now()
            }
        ]
    };
}

function resolveRuntimeScopeStore(state: RuntimeProjectState, options: RuntimeOptions): RuntimeStateRecord {
    if (options.scope === "global") {
        return state.globals;
    }
    const instanceId = options.instanceId ?? DEFAULT_INSTANCE_ID;
    const existing = state.instances[instanceId];
    if (existing) {
        return existing;
    }
    const created: RuntimeStateRecord = {};
    state.instances[instanceId] = created;
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

function printRuntimePayload(command: string, payload: unknown): void {
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
}

async function resolveRuntimeProjectRoot(options: RuntimeOptions): Promise<string> {
    return await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
}

async function runRuntimeInstancesAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const state = readRuntimeProjectState(projectRoot);
    const payload = Object.keys(state.instances)
        .sort()
        .map((instanceId) => ({
            instanceId,
            keys: Object.keys(state.instances[instanceId] ?? {}).sort()
        }));
    printRuntimePayload("runtime instances", { ok: true, instances: payload });
}

async function runRuntimeInspectAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const state = readRuntimeProjectState(projectRoot);
    const instanceId = options.instanceId ?? DEFAULT_INSTANCE_ID;
    const instanceState = state.instances[instanceId] ?? {};
    printRuntimePayload("runtime inspect", { instanceId, ok: true, state: instanceState });
}

async function runRuntimeGetAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const runtimeState = readRuntimeProjectState(projectRoot);
    const propertyPath = options.path ?? "";
    const scopeStore = resolveRuntimeScopeStore(runtimeState, options);
    const value = propertyPath.length > 0 ? scopeStore[propertyPath] : undefined;
    printRuntimePayload("runtime get", {
        ok: propertyPath.length > 0 && value !== undefined,
        path: propertyPath,
        scope: options.scope ?? "instance",
        value
    });
}

async function runRuntimeSetAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const propertyPath = options.path ?? "";
    const rawValue = options.value ?? "";
    const parsedValue = parseRuntimeValue(rawValue);
    const runtimeState = readRuntimeProjectState(projectRoot);
    const scopeStore = resolveRuntimeScopeStore(runtimeState, options);
    scopeStore[propertyPath] = parsedValue;
    const nextState = appendRuntimeLog(runtimeState, `Set ${options.scope ?? "instance"}:${propertyPath}`);
    writeRuntimeProjectState(projectRoot, nextState);
    printRuntimePayload("runtime set", {
        ok: true,
        path: propertyPath,
        scope: options.scope ?? "instance",
        value: parsedValue
    });
}

async function runRuntimeCallAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const method = options.method ?? "";
    let argsPayload: unknown = [];
    if (typeof options.args === "string" && options.args.trim().length > 0) {
        try {
            argsPayload = JSON.parse(options.args);
        } catch {
            argsPayload = [options.args];
        }
    }
    const runtimeState = readRuntimeProjectState(projectRoot);
    writeRuntimeProjectState(projectRoot, appendRuntimeLog(runtimeState, `Call ${method}`));
    printRuntimePayload("runtime call", {
        args: argsPayload,
        method,
        ok: true,
        result: null
    });
}

async function runRuntimeWatchAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const runtimeState = readRuntimeProjectState(projectRoot);
    const expression = options.expression ?? "";
    const instanceCount = Object.keys(runtimeState.instances).length;
    printRuntimePayload("runtime watch", {
        expression,
        ok: true,
        sample: {
            globalsTrackedKeys: Object.keys(runtimeState.globals).sort(),
            instanceCount
        }
    });
}

async function runRuntimeStateAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const runtimeState = readRuntimeProjectState(projectRoot);
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    const runnerSnapshot = runnerStateStore.readSnapshot();
    const kind = options.kind ?? "room";
    const payload = {
        globals: Object.keys(runtimeState.globals).sort(),
        kind,
        logs: runtimeState.logs.length,
        runner: {
            logCount: runnerSnapshot.logCount,
            room: runnerSnapshot.room,
            state: runnerSnapshot.state
        },
        trackedInstances: Object.keys(runtimeState.instances).length
    };
    printRuntimePayload("runtime state", { ok: true, state: payload });
}

async function runRuntimeLogsAction(options: RuntimeOptions): Promise<void> {
    const projectRoot = await resolveRuntimeProjectRoot(options);
    const runtimeState = readRuntimeProjectState(projectRoot);
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    const runnerLogs = runnerStateStore.readLogs({ kind: "runtime" }).map((entry) => ({
        message: `[runner:${entry.level}] ${entry.message}`,
        timestamp: entry.timestamp
    }));

    const payload = [...runtimeState.logs, ...runnerLogs].sort(
        (left, right) => left.timestamp - right.timestamp || left.message.localeCompare(right.message)
    );
    printRuntimePayload("runtime logs", { ok: true, payload });
}

export function createRuntimeCommand(): Command {
    const command = applyStandardCommandOptions(new Command("runtime")).description(
        "Inspect and interact with runtime state."
    );
    const runtimeInstanceIdOptionName = "--instance-id <id>";
    const runtimeInstanceIdOptionDescription = "Runtime instance id.";

    const shared = (nested: Command): Command =>
        nested.option("--json", "Emit JSON output.").option("--project <path>", "Project root or .yyp path.");

    const instances = shared(
        applyStandardCommandOptions(new Command("instances")).description("List runtime instances.")
    );
    instances.action(async function runtimeInstancesAction() {
        await runRuntimeInstancesAction(this.opts<RuntimeOptions>());
    });

    const inspect = shared(
        applyStandardCommandOptions(new Command("inspect"))
            .description("Inspect one runtime instance.")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    inspect.action(async function runtimeInspectAction() {
        await runRuntimeInspectAction(this.opts<RuntimeOptions>());
    });

    const get = shared(
        applyStandardCommandOptions(new Command("get"))
            .description("Read a runtime value.")
            .option("--path <path>", "Property path.")
            .option("--scope <scope>", "Scope: instance or global.", "instance")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    get.action(async function runtimeGetAction() {
        await runRuntimeGetAction(this.opts<RuntimeOptions>());
    });

    const set = shared(
        applyStandardCommandOptions(new Command("set"))
            .description("Set a runtime value.")
            .requiredOption("--path <path>", "Property path.")
            .requiredOption("--value <value>", "New value.")
            .option("--scope <scope>", "Scope: instance or global.", "instance")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    set.action(async function runtimeSetAction() {
        await runRuntimeSetAction(this.opts<RuntimeOptions>());
    });

    const call = shared(
        applyStandardCommandOptions(new Command("call"))
            .description("Call a runtime method/function.")
            .requiredOption("--method <name>", "Method/function name.")
            .option("--args <json>", "JSON encoded arguments.")
            .option(runtimeInstanceIdOptionName, runtimeInstanceIdOptionDescription)
    );
    call.action(async function runtimeCallAction() {
        await runRuntimeCallAction(this.opts<RuntimeOptions>());
    });

    const watch = shared(
        applyStandardCommandOptions(new Command("watch"))
            .description("Watch runtime expression changes.")
            .requiredOption("--expression <expr>", "Expression to watch.")
    );
    watch.action(async function runtimeWatchAction() {
        await runRuntimeWatchAction(this.opts<RuntimeOptions>());
    });

    const state = shared(
        applyStandardCommandOptions(new Command("state"))
            .description("Read coarse runtime state domain.")
            .option("--kind <kind>", "State kind.", "room")
    );
    state.action(async function runtimeStateAction() {
        await runRuntimeStateAction(this.opts<RuntimeOptions>());
    });

    const logs = shared(applyStandardCommandOptions(new Command("logs")).description("Read runtime logs."));
    logs.action(async function runtimeLogsAction() {
        await runRuntimeLogsAction(this.opts<RuntimeOptions>());
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
