import path from "node:path";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import { getRunnerController, getRunnerStateStore } from "../modules/runtime/index.js";
import { discoverProjectRoot } from "../workflow/project-root.js";

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseRunnerArgsInput(value: string): Array<string> {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
        return [];
    }

    if (trimmed.startsWith("[")) {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
            throw new TypeError("GMLOOP_RUNNER_ARGS JSON must be an array of strings.");
        }
        return parsed;
    }

    return trimmed.split(/\s+/u).filter((entry) => entry.length > 0);
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

async function runRunnerStatusAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    const snapshot = runnerStateStore.readSnapshot();
    const processStatus = getRunnerController().status(projectRoot);
    printRunnerPayload({
        command: "runner status",
        payload: {
            ...snapshot,
            process: processStatus
        }
    });
}

async function runRunnerLogsAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    const logs = runnerStateStore.readLogs({
        errorsOnly: options.errorsOnly === true,
        filter: options.filter,
        kind: options.kind ?? "all"
    });
    printRunnerPayload({
        command: "runner logs",
        payload: logs
    });
}

async function runRunnerLogsFollowAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    const startTimestamp = Date.now();
    const followWindowMs = 750;
    let lastTimestamp = startTimestamp - 1;

    await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
            runnerStateStore.bindProjectRoot(projectRoot);
            const entries = runnerStateStore
                .readLogs({
                    errorsOnly: options.errorsOnly === true,
                    filter: options.filter,
                    kind: options.kind ?? "all"
                })
                .filter((entry) => entry.timestamp > lastTimestamp);

            if (entries.length > 0) {
                const nextLast = entries.at(-1);
                if (nextLast) {
                    lastTimestamp = nextLast.timestamp;
                }
                printRunnerPayload({
                    command: "runner logs",
                    follow: true,
                    payload: entries
                });
            }

            if (Date.now() - startTimestamp >= followWindowMs) {
                clearInterval(interval);
                resolve();
            }
        }, 100);
    });
}

async function runRunnerClearLogsAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    runnerStateStore.clearLogs();
    printRunnerPayload({
        command: "runner clear-logs",
        payload: { ok: true }
    });
}

async function runRunnerPauseAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    runnerStateStore.setState("paused");
    printRunnerPayload({
        command: "runner pause",
        payload: { ok: true }
    });
}

async function runRunnerResumeAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    runnerStateStore.setState("running");
    printRunnerPayload({
        command: "runner resume",
        payload: { ok: true }
    });
}

async function runRunnerRoomSetAction(roomName: string, options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
    runnerStateStore.setRoom(roomName);
    printRunnerPayload({
        command: "runner room set",
        payload: { room: roomName }
    });
}

async function runRunnerRoomCurrentAction(options: RunnerOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({
        explicitProjectPath: options.project ?? options.path
    });
    const runnerStateStore = getRunnerStateStore();
    runnerStateStore.bindProjectRoot(projectRoot);
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

    const start = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("start"))
            .description("Start the runner process.")
            .option("--debug", "Start in debug mode.")
    );
    start.action(async function runnerStartAction() {
        await runRunnerCommandAction(() => {
            return runRunnerStartAction(this.opts<RunnerOptions>());
        });
    });

    const stop = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("stop")).description("Stop the runner process.")
    );
    stop.action(async function runnerStopAction() {
        await runRunnerCommandAction(() => {
            return runRunnerStopAction(this.opts<RunnerOptions>());
        });
    });

    const restart = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("restart")).description("Restart the runner process.")
    );
    restart.action(async function runnerRestartAction() {
        await runRunnerCommandAction(() => {
            return runRunnerRestartAction(this.opts<RunnerOptions>());
        });
    });

    const pause = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("pause")).description("Pause runner execution.")
    );
    pause.action(async function runnerPauseAction() {
        await runRunnerCommandAction(() => {
            return runRunnerPauseAction(this.opts<RunnerOptions>());
        });
    });

    const resume = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("resume")).description("Resume runner execution.")
    );
    resume.action(async function runnerResumeAction() {
        await runRunnerCommandAction(() => {
            return runRunnerResumeAction(this.opts<RunnerOptions>());
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

    command.addCommand(start);
    command.addCommand(stop);
    command.addCommand(restart);
    command.addCommand(pause);
    command.addCommand(resume);
    command.addCommand(status);
    command.addCommand(logs);
    command.addCommand(clearLogs);
    command.addCommand(room);

    return command;
}
