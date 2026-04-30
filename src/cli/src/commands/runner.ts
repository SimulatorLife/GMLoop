import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import { getRunnerController, getRunnerStateStore } from "../modules/runtime/index.js";

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

function printRunnerPayload(payload: unknown, asJson: boolean): void {
    if (asJson) {
        console.log(JSON.stringify(payload, null, 2));
        return;
    }
    console.log(JSON.stringify(payload, null, 2));
}

function runRunnerStatusAction(options: RunnerOptions): void {
    const snapshot = getRunnerStateStore().readSnapshot();
    const processStatus = getRunnerController().status();
    printRunnerPayload(
        {
            command: "runner status",
            payload: {
                ...snapshot,
                process: processStatus
            }
        },
        options.json === true
    );
}

function runRunnerLogsAction(options: RunnerOptions): void {
    const logs = getRunnerStateStore().readLogs({
        errorsOnly: options.errorsOnly === true,
        filter: options.filter,
        kind: options.kind ?? "all"
    });
    printRunnerPayload(
        {
            command: "runner logs",
            payload: logs
        },
        options.json === true
    );
}

async function runRunnerLogsFollowAction(options: RunnerOptions): Promise<void> {
    const runnerStateStore = getRunnerStateStore();
    const startTimestamp = Date.now();
    const followWindowMs = 750;
    let lastTimestamp = startTimestamp - 1;

    await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
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
                printRunnerPayload(
                    {
                        command: "runner logs",
                        follow: true,
                        payload: entries
                    },
                    options.json === true
                );
            }

            if (Date.now() - startTimestamp >= followWindowMs) {
                clearInterval(interval);
                resolve();
            }
        }, 100);
    });
}

function runRunnerClearLogsAction(options: RunnerOptions): void {
    getRunnerStateStore().clearLogs();
    printRunnerPayload(
        {
            command: "runner clear-logs",
            payload: { ok: true }
        },
        options.json === true
    );
}

function runRunnerPauseAction(options: RunnerOptions): void {
    getRunnerStateStore().setState("paused");
    printRunnerPayload(
        {
            command: "runner pause",
            payload: { ok: true }
        },
        options.json === true
    );
}

function runRunnerResumeAction(options: RunnerOptions): void {
    getRunnerStateStore().setState("running");
    printRunnerPayload(
        {
            command: "runner resume",
            payload: { ok: true }
        },
        options.json === true
    );
}

function runRunnerRoomSetAction(roomName: string, options: RunnerOptions): void {
    getRunnerStateStore().setRoom(roomName);
    printRunnerPayload(
        {
            command: "runner room set",
            payload: { room: roomName }
        },
        options.json === true
    );
}

function runRunnerRoomCurrentAction(options: RunnerOptions): void {
    const snapshot = getRunnerStateStore().readSnapshot();
    printRunnerPayload(
        {
            command: "runner room current",
            payload: { room: snapshot.room }
        },
        options.json === true
    );
}

function runRunnerStartAction(options: RunnerOptions): void {
    const payload = getRunnerController().start({
        debug: options.debug,
        runner: options.runner
    });
    printRunnerPayload(
        {
            command: "runner start",
            payload
        },
        options.json === true
    );
}

function runRunnerStopAction(options: RunnerOptions): void {
    const payload = getRunnerController().stop();
    printRunnerPayload(
        {
            command: "runner stop",
            payload
        },
        options.json === true
    );
}

function runRunnerRestartAction(options: RunnerOptions): void {
    const payload = getRunnerController().restart({
        debug: options.debug,
        runner: options.runner
    });
    printRunnerPayload(
        {
            command: "runner restart",
            payload
        },
        options.json === true
    );
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
            runRunnerPauseAction(this.opts<RunnerOptions>());
        });
    });

    const resume = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("resume")).description("Resume runner execution.")
    );
    resume.action(async function runnerResumeAction() {
        await runRunnerCommandAction(() => {
            runRunnerResumeAction(this.opts<RunnerOptions>());
        });
    });

    const status = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("status")).description("Show runner status.")
    );
    status.action(async function runnerStatusAction() {
        await runRunnerCommandAction(() => {
            runRunnerStatusAction(this.opts<RunnerOptions>());
        });
    });

    const logs = addRunnerLogOptions(applyStandardCommandOptions(new Command("logs")).description("Read runner logs."));
    logs.action(async function runnerLogsAction() {
        await runRunnerCommandAction(() => {
            const options = this.opts<RunnerOptions>();
            if (options.follow === true) {
                return runRunnerLogsFollowAction(options);
            }
            runRunnerLogsAction(options);
        });
    });

    const clearLogs = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("clear-logs")).description("Clear stored runner logs.")
    );
    clearLogs.action(async function runnerClearLogsAction() {
        await runRunnerCommandAction(() => {
            runRunnerClearLogsAction(this.opts<RunnerOptions>());
        });
    });

    const room = applyStandardCommandOptions(new Command("room")).description("Runner room controls.");
    const roomSet = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("set"))
            .description("Set current room.")
            .argument("<room>", "Room name or id.")
    );
    roomSet.action(async function runnerRoomSetAction(roomName: string) {
        await runRunnerCommandAction(() => {
            runRunnerRoomSetAction(roomName, this.opts<RunnerOptions>());
        });
    });
    const roomCurrent = addRunnerSharedOptions(
        applyStandardCommandOptions(new Command("current")).description("Show current room.")
    );
    roomCurrent.action(async function runnerRoomCurrentAction() {
        await runRunnerCommandAction(() => {
            runRunnerRoomCurrentAction(this.opts<RunnerOptions>());
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
