import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readProjectOperationState } from "../../../modules/runtime/project-operation-state.js";
import type { GraphCommandSharedOptions, GraphResolutionContext } from "../shared.js";
import type { GraphVisualizationProjectWorkflow } from "./types.js";

const SEMANTIC_INDEX_OPERATION_KIND = "semantic-index";

function createGraphVisualizationWorkflowArguments(
    workflow: GraphVisualizationProjectWorkflow,
    projectRoot: string
): ReadonlyArray<string> {
    switch (workflow) {
        case "fix": {
            return ["fix", "--write", "--path", projectRoot];
        }
        case "format": {
            return ["format", "--write", "--path", projectRoot, "--on-parse-error", "skip"];
        }
        case "lint": {
            return ["lint", projectRoot, "--write", "--path", projectRoot, "--project-strict"];
        }
        case "refactor": {
            return ["refactor", "codemod", projectRoot, "--write", "--path", projectRoot];
        }
    }
}

function isSemanticIndexBuildActiveForProject(projectRoot: string): boolean {
    const activeOperation = readProjectOperationState(projectRoot).active;
    return (
        activeOperation !== null &&
        activeOperation.status === "running" &&
        (activeOperation.kind === SEMANTIC_INDEX_OPERATION_KIND ||
            activeOperation.phase === SEMANTIC_INDEX_OPERATION_KIND ||
            activeOperation.semanticIndex !== null)
    );
}

/**
 * Stream child-process output incrementally and invoke a callback for each completed line.
 * Removes all registered listeners on the stream before resolving so the stream
 * is fully dissociated from this promise chain regardless of how it settles.
 *
 * @param stream - Child-process stdout/stderr stream.
 * @param onLogLine - Callback invoked with each parsed line.
 */
function streamProcessOutputByLine(stream: NodeJS.ReadableStream, onLogLine: (logLine: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        let bufferedText = "";
        stream.setEncoding("utf8");

        const handleData = (chunk: string): void => {
            bufferedText += chunk;
            let nextLineBreakIndex = bufferedText.search(/\r?\n/u);
            while (nextLineBreakIndex >= 0) {
                const completeLine = bufferedText.slice(0, nextLineBreakIndex);
                if (completeLine.length > 0) {
                    onLogLine(completeLine);
                }
                const lineBreakLength = bufferedText[nextLineBreakIndex] === "\r" ? 2 : 1;
                bufferedText = bufferedText.slice(nextLineBreakIndex + lineBreakLength);
                nextLineBreakIndex = bufferedText.search(/\r?\n/u);
            }
        };

        const handleError = (error: unknown): void => {
            stream.removeListener("data", handleData);
            stream.removeListener("error", handleError);
            stream.removeListener("end", handleEnd);
            reject(error instanceof Error ? error : new Error("Unknown stream error"));
        };

        const handleEnd = (): void => {
            stream.removeListener("data", handleData);
            stream.removeListener("error", handleError);
            stream.removeListener("end", handleEnd);
            if (bufferedText.length > 0) {
                onLogLine(bufferedText);
            }
            resolve();
        };

        stream.on("data", handleData);
        stream.on("error", handleError);
        stream.on("end", handleEnd);
    });
}

/**
 * Await a child process close event and return its exit code.
 *
 * @param childProcess - Child process to observe.
 */
function awaitChildProcessExitCode(childProcess: ChildProcessWithoutNullStreams): Promise<number | null> {
    return new Promise((resolve, reject) => {
        childProcess.once("error", reject);
        childProcess.once("close", (code) => {
            resolve(code);
        });
    });
}

async function runGraphIndexBuildInChildProcess(
    options: GraphCommandSharedOptions,
    projectRoot: string,
    force: boolean
): Promise<void> {
    const cliEntryPath = fileURLToPath(new URL("../../../../index.js", import.meta.url));
    const args = ["--disable-warning=ExperimentalWarning", cliEntryPath, "graph", "index", "--path", projectRoot];
    if (force) {
        args.push("--force");
    }
    if (options.config) {
        args.push("--config", options.config);
    }
    if (options.databasePath) {
        args.push("--database-path", options.databasePath);
    }
    if (options.toolsetRoot) {
        args.push("--toolset-root", options.toolsetRoot);
    }

    const logLines = new Array<string>();
    const appendLogLine = (logLine: string): void => {
        if (logLine.trim().length > 0) {
            logLines.push(logLine.trimEnd());
        }
    };

    // The target project is passed explicitly via --path, so the child
    // inherits this process's working directory instead of depending on the
    // project root being usable as a cwd.
    const childProcess = spawn(process.execPath, args, {
        stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutPromise = streamProcessOutputByLine(childProcess.stdout, appendLogLine);
    const stderrPromise = streamProcessOutputByLine(childProcess.stderr, appendLogLine);
    const exitCode = await awaitChildProcessExitCode(childProcess);
    await Promise.all([stdoutPromise, stderrPromise]);

    if (exitCode !== 0) {
        throw new Error(
            logLines.length > 0
                ? logLines.join("\n")
                : `Graph index process exited with code ${exitCode === null ? "unknown" : String(exitCode)}.`
        );
    }
}

/**
 * Build the graph index for the serve UI without blocking its event loop.
 *
 * The synchronous SQLite persistence inside an in-process build starves the
 * visualization server on large projects, so serve mode delegates the build to
 * a `graph index` child process. Progress flows back through the shared
 * project operation-state file, which the serve progress endpoint already
 * polls. When another process owns the semantic build, this attaches to that
 * build's shared progress instead of starting duplicate analysis.
 */
async function ensureGraphIndexForServe(
    options: GraphCommandSharedOptions,
    context: GraphResolutionContext,
    force: boolean
): Promise<void> {
    if (isSemanticIndexBuildActiveForProject(context.projectRoot)) {
        return;
    }

    try {
        await runGraphIndexBuildInChildProcess(options, context.projectRoot, force);
    } catch (error: unknown) {
        if (isSemanticIndexBuildActiveForProject(context.projectRoot)) {
            return;
        }
        throw error;
    }
}

async function runGraphVisualizationProjectWorkflow(
    context: GraphResolutionContext,
    configPath: string | undefined,
    workflow: GraphVisualizationProjectWorkflow,
    onLogLine: ((logLine: string) => void) | null = null,
    onProcessStart: ((childProcess: ChildProcessWithoutNullStreams) => void) | null = null
): Promise<Readonly<{ logLines: ReadonlyArray<string> }>> {
    const cliEntryPath = fileURLToPath(new URL("../../../../index.js", import.meta.url));
    const args = ["--disable-warning=ExperimentalWarning"];
    if (workflow === "refactor") {
        args.push("--max-old-space-size=16384");
    }
    args.push(cliEntryPath, ...createGraphVisualizationWorkflowArguments(workflow, context.projectRoot));
    if (configPath) {
        args.push("--config", configPath);
    }

    const logLines = new Array<string>();
    const appendLogLine = (logLine: string): void => {
        if (logLine.trim().length === 0) {
            return;
        }
        const normalizedLogLine = logLine.trimEnd();
        logLines.push(normalizedLogLine);
        onLogLine?.(normalizedLogLine);
    };

    const childProcess = spawn(process.execPath, args, {
        cwd: context.projectRoot,
        stdio: ["ignore", "pipe", "pipe"]
    });
    onProcessStart?.(childProcess);

    const stdoutPromise = streamProcessOutputByLine(childProcess.stdout, appendLogLine);
    const stderrPromise = streamProcessOutputByLine(childProcess.stderr, appendLogLine);

    const exitCode = await awaitChildProcessExitCode(childProcess);
    await Promise.all([stdoutPromise, stderrPromise]);

    if (exitCode !== 0) {
        throw new Error(
            logLines.length > 0
                ? logLines.join("\n")
                : `Fix workflow process exited with code ${exitCode === null ? "unknown" : String(exitCode)}.`
        );
    }

    return Object.freeze({ logLines: Object.freeze([...logLines]) });
}

export {
    awaitChildProcessExitCode,
    createGraphVisualizationWorkflowArguments,
    ensureGraphIndexForServe,
    isSemanticIndexBuildActiveForProject,
    runGraphIndexBuildInChildProcess,
    runGraphVisualizationProjectWorkflow,
    SEMANTIC_INDEX_OPERATION_KIND,
    streamProcessOutputByLine
};
