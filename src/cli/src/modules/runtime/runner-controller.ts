import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { getRunnerStateStore } from "./runner-state.js";

type RunnerController = {
    restart(options: { debug?: boolean; runner?: string }): { pid: number | null };
    start(options: { debug?: boolean; runner?: string }): { pid: number | null };
    status(): { pid: number | null; running: boolean };
    stop(): { stopped: boolean };
};

function createRunnerController(): RunnerController {
    let activeProcess: ChildProcessWithoutNullStreams | null = null;
    let activePid: number | null = null;

    function attachProcessLogs(processHandle: ChildProcessWithoutNullStreams): void {
        const runnerState = getRunnerStateStore();
        processHandle.stdout.on("data", (chunk) => {
            runnerState.appendLog({
                kind: "runtime",
                level: "info",
                message: String(chunk).trim()
            });
        });
        processHandle.stderr.on("data", (chunk) => {
            runnerState.appendLog({
                kind: "runtime",
                level: "error",
                message: String(chunk).trim()
            });
        });
        processHandle.on("exit", (code, signal) => {
            activeProcess = null;
            activePid = null;
            runnerState.setState("stopped");
            runnerState.appendLog({
                kind: "runtime",
                level: code === 0 ? "info" : "error",
                message: `Runner exited (code=${String(code)}, signal=${String(signal)})`
            });
        });
    }

    return {
        restart(options) {
            this.stop();
            return this.start(options);
        },
        start(options) {
            if (activeProcess && !activeProcess.killed) {
                throw new Error("Runner process is already running.");
            }

            const runnerBinary = options.runner ?? "node";
            const runnerArgs = options.runner ? [] : ["-e", "setInterval(() => {}, 1000)"];
            const childProcess = spawn(runnerBinary, runnerArgs, {
                stdio: ["ignore", "pipe", "pipe"]
            });

            activeProcess = childProcess;
            activePid = childProcess.pid ?? null;
            const runnerState = getRunnerStateStore();
            runnerState.setState("running");
            runnerState.appendLog({
                kind: "runtime",
                level: "info",
                message: `Runner started (${runnerBinary})${options.debug ? " [debug]" : ""}`
            });
            attachProcessLogs(childProcess);

            return { pid: activePid };
        },
        status() {
            return {
                pid: activePid,
                running: activeProcess !== null && !activeProcess.killed
            };
        },
        stop() {
            if (!activeProcess || activeProcess.killed) {
                getRunnerStateStore().setState("stopped");
                return { stopped: false };
            }

            const current = activeProcess;
            current.kill("SIGTERM");
            activeProcess = null;
            activePid = null;
            getRunnerStateStore().setState("stopped");
            getRunnerStateStore().appendLog({
                kind: "runtime",
                level: "info",
                message: "Runner stop requested."
            });
            return { stopped: true };
        }
    };
}

const sharedRunnerController = createRunnerController();

export function getRunnerController(): RunnerController {
    return sharedRunnerController;
}
