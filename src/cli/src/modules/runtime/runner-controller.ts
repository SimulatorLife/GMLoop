import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";

import { getRunnerStateStore } from "./runner-state.js";

type RunnerController = {
    restart(options: RunnerStartOptions): { pid: number | null };
    start(options: RunnerStartOptions): { pid: number | null };
    status(projectRoot: string): { pid: number | null; running: boolean };
    stop(projectRoot: string): { stopped: boolean };
};

/**
 * Resolved runner launch options for starting or restarting the runner process.
 */
export type RunnerStartOptions = Readonly<{
    args: ReadonlyArray<string>;
    command: string;
    debug?: boolean;
    projectRoot: string;
}>;

/**
 * Minimal spawn interface used by the runner controller.
 * Typed as a function that returns `ChildProcessWithoutNullStreams` so callers
 * can substitute a lightweight mock for unit testing without spawning real
 * processes.
 */
export type RunnerSpawnFn = (
    command: string,
    args: ReadonlyArray<string>,
    options: { stdio: ["ignore", "pipe", "pipe"] }
) => ChildProcessWithoutNullStreams;

/**
 * Creates a new, isolated runner controller instance.
 *
 * Production code should use `getRunnerController()` to obtain the shared
 * singleton. This factory is exported so that unit tests can inject a mock
 * spawn implementation to exercise lifecycle behaviour without spawning real
 * child processes.
 *
 * @param spawnFn - Process-spawn implementation; defaults to Node's built-in
 *   `child_process.spawn`.
 */
export function createRunnerController(spawnFn: RunnerSpawnFn = spawn as RunnerSpawnFn): RunnerController {
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
            // Guard: only update shared state when `processHandle` is still the
            // active process. `restart()` synchronously replaces `activeProcess`
            // with the new handle before the old process's async `exit` event
            // fires. Without this check the stale handler would null out the new
            // process reference and corrupt `status()` / `stop()` behaviour.
            if (activeProcess !== processHandle) {
                return;
            }
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
            this.stop(options.projectRoot);
            return this.start(options);
        },
        start(options) {
            if (activeProcess && !activeProcess.killed) {
                throw new Error("Runner process is already running.");
            }

            const childProcess = spawnFn(options.command, [...options.args], {
                stdio: ["ignore", "pipe", "pipe"]
            });

            activeProcess = childProcess;
            activePid = childProcess.pid ?? null;
            const runnerState = getRunnerStateStore();
            runnerState.bindProjectRoot(options.projectRoot);
            runnerState.setState("running");
            runnerState.appendLog({
                kind: "runtime",
                level: "info",
                message: `Runner started (${options.command})${options.debug ? " [debug]" : ""}`
            });
            attachProcessLogs(childProcess);

            return { pid: activePid };
        },
        status(projectRoot) {
            getRunnerStateStore().bindProjectRoot(projectRoot);
            return {
                pid: activePid,
                running: activeProcess !== null && !activeProcess.killed
            };
        },
        stop(projectRoot) {
            const runnerStateStore = getRunnerStateStore();
            runnerStateStore.bindProjectRoot(projectRoot);
            if (!activeProcess || activeProcess.killed) {
                runnerStateStore.setState("stopped");
                return { stopped: false };
            }

            const current = activeProcess;
            current.kill("SIGTERM");
            activeProcess = null;
            activePid = null;
            runnerStateStore.setState("stopped");
            runnerStateStore.appendLog({
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
