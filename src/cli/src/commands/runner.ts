import path from "node:path";

import { Core } from "@gmloop/core";
import { Argument, Command } from "commander";

import { wrapInvalidArgumentResolver } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import {
    getRunnerController,
    type RunnerLifecycleStateController,
    type RunnerLogClearer,
    type RunnerLogReader,
    type RunnerProjectBinder,
    type RunnerRoomController,
    type RunnerSnapshotReader
} from "../modules/runtime/index.js";
import {
    coerceRunnerLifecycleAction,
    RUNNER_LIFECYCLE_ACTIONS,
    type RunnerLifecycleAction
} from "../modules/runtime/lifecycle.js";
import { isRecord } from "../shared/error-guards.js";
import { discoverProjectRoot } from "../workflow/project-root.js";
import { followRunnerLogs, type FollowRunnerLogsReadOptions, resolveBoundRunnerState } from "./runner-context.js";

type RunnerOptions = Readonly<{
    debug?: boolean;
    errorsOnly?: boolean;
    filter?: string;
    follow?: boolean;
    json?: boolean;
    kind?: "all" | "compile" | "runtime";
    path?: string;
    project?: string;
    runner?: string;
}>;

type RunnerLaunchConfiguration = Readonly<{
    args: Array<string>;
    command: string;
    projectRoot: string;
}>;

function printRunnerPayload(payload: unknown): void {
    console.log(JSON.stringify(payload, null, 2));
}

/**
 * Parse the `GMLOOP_RUNNER_ARGS` environment variable into an ordered array
 * of process arguments for the runtime runner backend.
 *
 * Two input shapes are accepted:
 *
 * - A JSON array of strings — exactly what the runner controller forwards to
 *   `child_process.spawn`, so a hand-curated list can be expressed inline
 *   (e.g. `GMLOOP_RUNNER_ARGS='["-e","setInterval(...)"]'`).
 * - A whitespace-delimited string of arguments, split on runs of `\s+` and
 *   filtered to drop empty entries produced by leading or trailing whitespace.
 *
 * Malformed input — non-JSON syntax, a top-level JSON value that is not an
 * array, or an array containing any non-string entry — must surface as a
 * `TypeError` carrying both the diagnostic reason and the offending payload.
 * The previous implementation let the raw `SyntaxError` from `JSON.parse`
 * escape through; that crashed the CLI with an opaque "Unexpected token"
 * message whenever a user supplied truncated JSON. Wrapping the parse in a
 * structured guard keeps the failure mode predictable and self-documenting.
 *
 * @param value Raw environment variable value, exactly as supplied by the
 *              caller. Leading and trailing whitespace is tolerated.
 * @returns Ordered array of runner arguments.
 * @throws {TypeError} When the payload does not conform to the documented
 *                     shape. The error message always identifies the field
 *                     name and includes the offending input for context.
 */
function parseRunnerArgsInput(value: string): Array<string> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return [];
    }

    if (!trimmed.startsWith("[")) {
        return trimmed.split(/\s+/u).filter((entry) => entry.length > 0);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(trimmed);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new TypeError(`GMLOOP_RUNNER_ARGS JSON is malformed (${reason}): ${trimmed}`, {
            cause: error
        });
    }

    if (!Array.isArray(parsed)) {
        const actualKind = parsed === null ? "null" : typeof parsed;
        throw new TypeError(`GMLOOP_RUNNER_ARGS JSON must be an array of strings, received ${actualKind}: ${trimmed}`);
    }

    const nonStringIndex = parsed.findIndex((entry) => typeof entry !== "string");
    if (nonStringIndex !== -1) {
        const actualKind = parsed[nonStringIndex] === null ? "null" : typeof parsed[nonStringIndex];
        throw new TypeError(
            `GMLOOP_RUNNER_ARGS JSON entry at index ${nonStringIndex} must be a string, received ${actualKind}: ${trimmed}`
        );
    }

    return parsed;
}

function resolveRunnerArgsFromConfig(config: unknown): Array<string> {
    if (!isRecord(config) || !Array.isArray(config.args)) {
        return [];
    }

    const parsedArgs: Array<string> = [];
    for (const candidate of config.args) {
        if (typeof candidate !== "string") {
            throw new TypeError("gmloop runtime runner args must be an array of strings.");
        }
        parsedArgs.push(candidate);
    }

    return parsedArgs;
}

function resolveRunnerConfigFromLoadedProjectConfig(config: unknown): { args: Array<string>; command: string | null } {
    if (!isRecord(config)) {
        return { args: [], command: null };
    }

    const runtimeValue = config.runtime;
    if (!isRecord(runtimeValue)) {
        return { args: [], command: null };
    }

    const runnerValue = runtimeValue.runner;
    if (!isRecord(runnerValue)) {
        return { args: [], command: null };
    }

    const command = typeof runnerValue.command === "string" ? runnerValue.command.trim() : "";
    return {
        args: resolveRunnerArgsFromConfig(runnerValue),
        command: command.length > 0 ? command : null
    };
}

async function resolveRunnerLaunchConfiguration(options: RunnerOptions): Promise<RunnerLaunchConfiguration> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });

    const configPath = path.join(projectRoot, "gmloop.json");
    const loadedConfig = await Core.loadGmloopProjectConfig(configPath).catch(() => ({}));
    const configRunner = resolveRunnerConfigFromLoadedProjectConfig(loadedConfig);

    const envCommand =
        typeof process.env.GMLOOP_RUNNER_COMMAND === "string" ? process.env.GMLOOP_RUNNER_COMMAND.trim() : "";
    const envArgsRaw = typeof process.env.GMLOOP_RUNNER_ARGS === "string" ? process.env.GMLOOP_RUNNER_ARGS : "";
    const envArgs = envArgsRaw.trim().length > 0 ? parseRunnerArgsInput(envArgsRaw) : [];

    const command = options.runner?.trim() || envCommand || configRunner.command;
    if (!command) {
        throw new TypeError(
            "Runner command is not configured. Provide --runner <command>, set GMLOOP_RUNNER_COMMAND, or define runtime.runner.command in gmloop.json."
        );
    }

    const args = envArgs.length > 0 ? envArgs : configRunner.args;
    return {
        args,
        command,
        projectRoot
    };
}

/**
 * Normalise the read options shared by the `runner logs` and
 * `runner logs --follow` actions. Pulled out so the two orchestrators stay
 * byte-for-byte consistent and the orchestrator bodies remain free of
 * inline defaults like `options.kind ?? "all"`.
 */
function resolveRunnerLogsReadOptions(options: RunnerOptions): FollowRunnerLogsReadOptions {
    return {
        errorsOnly: options.errorsOnly === true,
        filter: options.filter,
        kind: options.kind ?? "all"
    };
}

async function runRunnerStatusAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // The status action only reads a snapshot and hands the project root to
    // the controller; it never mutates lifecycle, room, or log state, so we
    // narrow the binding to the read-only role interface.
    const runnerStateStore: RunnerSnapshotReader = bound.runnerStateStore;
    const snapshot = runnerStateStore.readSnapshot();
    const processStatus = getRunnerController().status(bound.projectRoot);
    printRunnerPayload({
        command: "runner status",
        payload: {
            ...snapshot,
            process: processStatus
        }
    });
}

async function runRunnerLogsAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // The logs action only reads the persisted log stream; narrowing to the
    // log-reader role documents that this handler does not mutate logs,
    // lifecycle, or room state.
    const runnerStateStore: RunnerLogReader = bound.runnerStateStore;
    const logs = runnerStateStore.readLogs(resolveRunnerLogsReadOptions(options));
    printRunnerPayload({
        command: "runner logs",
        payload: logs
    });
}

async function runRunnerLogsFollowAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // The follow loop re-binds the project root on every tick and reads the
    // log stream; narrowing to those two roles keeps the closure signatures
    // honest and prevents accidental coupling to lifecycle or room mutation.
    const runnerStateStore: RunnerProjectBinder & RunnerLogReader = bound.runnerStateStore;
    const readOptions = resolveRunnerLogsReadOptions(options);

    await followRunnerLogs({
        emit: (entries) => {
            printRunnerPayload({
                command: "runner logs",
                follow: true,
                payload: entries
            });
        },
        readLogs: () => runnerStateStore.readLogs(readOptions),
        rebind: () => {
            runnerStateStore.bindProjectRoot(bound.projectRoot);
        }
    });
}

async function runRunnerClearLogsAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // The clear-logs action only drops the persisted log stream; narrowing
    // to the log-clearer role makes the absence of any read or write
    // dependency explicit.
    const runnerStateStore: RunnerLogClearer = bound.runnerStateStore;
    runnerStateStore.clearLogs();
    printRunnerPayload({
        command: "runner clear-logs",
        payload: { ok: true }
    });
}

async function runRunnerPauseAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // Lifecycle-only action; narrow to the lifecycle controller role.
    const runnerStateStore: RunnerLifecycleStateController = bound.runnerStateStore;
    runnerStateStore.setState("paused");
    printRunnerPayload({
        command: "runner pause",
        payload: { ok: true }
    });
}

async function runRunnerResumeAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // Lifecycle-only action; narrow to the lifecycle controller role.
    const runnerStateStore: RunnerLifecycleStateController = bound.runnerStateStore;
    runnerStateStore.setState("running");
    printRunnerPayload({
        command: "runner resume",
        payload: { ok: true }
    });
}

async function runRunnerRoomSetAction(roomName: string, options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // Room-only mutating action; narrow to the room controller role.
    const runnerStateStore: RunnerRoomController = bound.runnerStateStore;
    runnerStateStore.setRoom(roomName);
    printRunnerPayload({
        command: "runner room set",
        payload: { room: roomName }
    });
}

async function runRunnerRoomCurrentAction(options: RunnerOptions): Promise<void> {
    const bound = await resolveBoundRunnerState(options);
    // Read-only snapshot to surface the active room; no mutation should be
    // possible through this binding.
    const runnerStateStore: RunnerSnapshotReader = bound.runnerStateStore;
    const snapshot = runnerStateStore.readSnapshot();
    printRunnerPayload({
        command: "runner room current",
        payload: { room: snapshot.room }
    });
}

async function runRunnerStartAction(options: RunnerOptions): Promise<void> {
    const launch = await resolveRunnerLaunchConfiguration(options);
    const payload = getRunnerController().start({
        args: launch.args,
        command: launch.command,
        debug: options.debug,
        projectRoot: launch.projectRoot
    });
    printRunnerPayload({
        command: "runner start",
        payload
    });
}

async function runRunnerStopAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const payload = getRunnerController().stop(projectRoot);
    printRunnerPayload({
        command: "runner stop",
        payload
    });
}

async function runRunnerRestartAction(options: RunnerOptions): Promise<void> {
    const launch = await resolveRunnerLaunchConfiguration(options);
    const payload = getRunnerController().restart({
        args: launch.args,
        command: launch.command,
        debug: options.debug,
        projectRoot: launch.projectRoot
    });
    printRunnerPayload({
        command: "runner restart",
        payload
    });
}

function addRunnerSharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .option("--project <path>", "Project root or .yyp path.")
        .option("--runner <path>", "Runner binary path override.")
        .option("--json", "Emit JSON output.");
}

function addRunnerLogOptions(command: Command): Command {
    return addRunnerSharedOptions(command)
        .option("--follow", "Follow log output stream.")
        .option("--kind <kind>", "Log kind: runtime, compile, or all.", "all")
        .option("--errors-only", "Only include error records.")
        .option("--filter <text>", "Filter log lines by substring.");
}

async function runRunnerCommandAction(action: () => void | Promise<void>): Promise<void> {
    try {
        await action();
    } catch (error) {
        handleCliError(error, {
            exitCode: 1,
            prefix: "Runner command failed."
        });
    }
}

export function createRunnerCommand(): Command {
    const command = applyStandardCommandOptions(new Command("runner")).description(
        "Control runtime runner lifecycle and logs."
    );

    const lifecycle = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("lifecycle"))
            .description("Manage the runner process lifecycle (start, stop, restart, pause, resume).")
            .addArgument(
                new Argument("<action>", "Lifecycle action to perform.")
                    .choices(Object.values(RUNNER_LIFECYCLE_ACTIONS))
                    .argParser(wrapInvalidArgumentResolver(coerceRunnerLifecycleAction))
            )
            .option("--debug", "Start/restart in debug mode.")
    );
    lifecycle.action(async function runnerLifecycleAction(action: RunnerLifecycleAction) {
        await runRunnerCommandAction(async () => {
            const options = this.opts<RunnerOptions>();
            switch (action) {
                case RUNNER_LIFECYCLE_ACTIONS.start: {
                    await runRunnerStartAction(options);
                    break;
                }
                case RUNNER_LIFECYCLE_ACTIONS.stop: {
                    await runRunnerStopAction(options);
                    break;
                }
                case RUNNER_LIFECYCLE_ACTIONS.restart: {
                    await runRunnerRestartAction(options);
                    break;
                }
                case RUNNER_LIFECYCLE_ACTIONS.pause: {
                    await runRunnerPauseAction(options);
                    break;
                }
                case RUNNER_LIFECYCLE_ACTIONS.resume: {
                    await runRunnerResumeAction(options);
                    break;
                }
            }
        });
    });

    const status = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("status")).description("Show runner status.")
    );
    status.action(async function runnerStatusAction() {
        await runRunnerCommandAction(() => {
            return runRunnerStatusAction(this.opts<RunnerOptions>());
        });
    });

    const logs = addRunnerLogOptions(applyStandardCommandOptions(new Command("logs")).description("Read runner logs."));
    logs.action(async function runnerLogsAction() {
        await runRunnerCommandAction(async () => {
            const options = this.opts<RunnerOptions>();
            if (options.follow === true) {
                await runRunnerLogsFollowAction(options);
                return;
            }
            await runRunnerLogsAction(options);
        });
    });

    const clearLogs = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("clear-logs")).description("Clear stored runner logs.")
    );
    clearLogs.action(async function runnerClearLogsAction() {
        await runRunnerCommandAction(() => {
            return runRunnerClearLogsAction(this.opts<RunnerOptions>());
        });
    });

    const room = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("room")).description("Runner room controls.")
    );
    const roomSet = applyStandardCommandOptions(new Command("set")).description("Set active room.").argument("<room>");
    roomSet.action(async function runnerRoomSetAction(roomName: string) {
        await runRunnerCommandAction(() => {
            return runRunnerRoomSetAction(roomName, this.optsWithGlobals<RunnerOptions>());
        });
    });

    const roomCurrent = applyStandardCommandOptions(new Command("current")).description("Show active room.");
    roomCurrent.action(async function runnerRoomCurrentAction() {
        await runRunnerCommandAction(() => {
            return runRunnerRoomCurrentAction(this.optsWithGlobals<RunnerOptions>());
        });
    });

    room.addCommand(roomSet);
    room.addCommand(roomCurrent);

    command.addCommand(lifecycle);
    command.addCommand(status);
    command.addCommand(logs);
    command.addCommand(clearLogs);
    command.addCommand(room);

    return command;
}

// `parseRunnerArgsInput` is exported separately (rather than only through a
// test-only helper) so that direct unit tests can exercise the malformed-JSON
// guard without having to spawn the `runner` command with a hand-crafted
// environment. The function is not part of the CLI's public surface, but the
// inline `export` keeps the test reachable without adding a new barrel entry.
export { parseRunnerArgsInput };
