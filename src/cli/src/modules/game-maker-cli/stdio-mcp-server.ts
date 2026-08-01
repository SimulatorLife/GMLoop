import { spawn } from "node:child_process";

export type StdioMcpServerProbeResult = Readonly<{
    serverName: string;
    serverVersion: string;
    tools: ReadonlyArray<{
        description: string;
        inputSchema: unknown;
        name: string;
    }>;
}>;

/**
 * Start a stdio-backed MCP server, perform initialize + tools/list, and
 * return the live tool catalog exposed by that process.
 */
export async function probeStdioMcpServer(
    options: Readonly<{
        args: ReadonlyArray<string>;
        command: string;
        cwd: string;
        displayName: string;
        env?: Readonly<Record<string, string>>;
        timeoutMs?: number;
    }>
): Promise<StdioMcpServerProbeResult> {
    return await new Promise<StdioMcpServerProbeResult>((resolve, reject) => {
        const childProcess = spawn(options.command, [...options.args], {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ["pipe", "pipe", "pipe"]
        });

        childProcess.stdout.setEncoding("utf8");
        childProcess.stderr.setEncoding("utf8");

        let stdoutBuffer = "";
        let stderrBuffer = "";
        const pendingMessages: Array<Record<string, unknown>> = [];
        let settled = false;

        // Track all polling intervals so they can be cleared atomically during cleanup.
        // This prevents resource leaks if the child process exits unexpectedly before
        // the intervals are cleared by their respective match handlers.
        const activeIntervals = new Set<ReturnType<typeof setInterval>>();

        /**
         * Detach every listener we registered on the child process and its
         * stdio streams, then terminate the child if it is still alive.
         *
         * Node keeps listeners attached to an EventEmitter alive for the
         * emitter's lifetime. The closures we registered for `data`, `error`,
         * and `close` capture `stdoutBuffer`, `stderrBuffer`, `pendingMessages`,
         * and `finalize`, so leaving them attached keeps the parent's stdio
         * pipes referenced (and their underlying file descriptors open) for as
         * long as the child runs. Sending SIGTERM lets the child close its
         * end of the pipes, which then becomes observable here through the
         * `close` event — but we already removed those listeners below, so the
         * process can exit silently without re-entering `finalize`. The
         * `settled` guard at the top of `finalize` keeps that path idempotent
         * even if a stray `close` arrives mid-shutdown.
         */
        const terminateChildProcess = (): void => {
            childProcess.stdout?.removeAllListeners();
            childProcess.stderr?.removeAllListeners();
            childProcess.removeAllListeners();

            if (childProcess.exitCode === null && childProcess.signalCode === null && childProcess.killed === false) {
                childProcess.kill("SIGTERM");
            }
        };

        const cleanup = () => {
            for (const interval of activeIntervals) {
                clearInterval(interval);
            }
            activeIntervals.clear();
            terminateChildProcess();
        };

        const timeout = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            reject(new Error(`Timed out while inspecting MCP tools from ${options.displayName}.`));
        }, options.timeoutMs ?? 30_000);

        const finalize = (callback: () => void) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timeout);
            // Remove all intervals from the tracking set *before* clearing them.
            // This prevents a race where an interval callback fires after
            // settled=true but before clearInterval() runs — the callback checks
            // pendingMessages.findIndex and returns early without side effects.
            for (const interval of activeIntervals) {
                activeIntervals.delete(interval);
                clearInterval(interval);
            }
            activeIntervals.clear();
            // Tear down the child even on the success path. Without this, the
            // child process — which is only required to deliver one round of
            // initialize + tools/list responses — keeps running indefinitely,
            // holding its stdio pipes (and the file descriptors backing them)
            // open in the parent. On long-lived CLI invocations that probe many
            // MCP servers, that accumulated cost eventually surfaces as `EMFILE`
            // when the process tries to open one too many descriptors.
            terminateChildProcess();
            callback();
        };

        const flushStdoutMessages = () => {
            let newlineIndex = stdoutBuffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const rawLine = stdoutBuffer.slice(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                if (rawLine.length > 0) {
                    try {
                        const parsedLine = JSON.parse(rawLine);
                        if (isValidJsonRpcMessage(parsedLine)) {
                            pendingMessages.push(parsedLine);
                        }
                    } catch {
                        // Ignore stdout log lines that are not JSON-RPC payloads.
                    }
                }
                newlineIndex = stdoutBuffer.indexOf("\n");
            }
        };

        const sendMessage = (payload: Record<string, unknown>) => {
            childProcess.stdin.write(`${JSON.stringify(payload)}\n`);
        };

        const waitForMessage = (
            predicate: (message: Record<string, unknown>) => boolean,
            onMatch: (message: Record<string, unknown>) => void
        ): ReturnType<typeof setInterval> => {
            const interval = setInterval(() => {
                // Skip processing if the promise has already settled. This guards
                // against a race where the close handler calls finalize() (setting
                // settled=true) before this tick runs — without this check, the
                // callback would still execute after the promise is settled.
                if (settled) {
                    return;
                }

                const messageIndex = pendingMessages.findIndex(predicate);
                if (messageIndex === -1) {
                    return;
                }

                clearInterval(interval);
                activeIntervals.delete(interval);
                const [message] = pendingMessages.splice(messageIndex, 1);
                if (message === undefined) {
                    finalize(() => reject(new Error(`Received an empty MCP response from ${options.displayName}.`)));
                    return;
                }

                onMatch(message);
            }, 20);

            activeIntervals.add(interval);
            return interval;
        };

        childProcess.stdout.on("data", (chunk: string) => {
            stdoutBuffer += chunk;
            flushStdoutMessages();
        });
        childProcess.stderr.on("data", (chunk: string) => {
            stderrBuffer += chunk;
        });

        childProcess.on("error", (error) => {
            finalize(() => reject(error));
        });
        childProcess.on("close", (code, signal) => {
            if (settled) {
                return;
            }

            finalize(() => {
                if (signal !== null) {
                    reject(new Error(`${options.displayName} exited with signal ${signal}.`));
                    return;
                }

                reject(
                    new Error(
                        stderrBuffer.trim() ||
                            `${options.displayName} exited before returning tools (code ${String(code ?? 1)}).`
                    )
                );
            });
        });

        sendMessage({
            id: 1,
            jsonrpc: "2.0",
            method: "initialize",
            params: {
                capabilities: {},
                clientInfo: {
                    name: "gmloop-config-probe",
                    version: "0.0.1"
                },
                protocolVersion: "2025-03-26"
            }
        });

        waitForMessage(
            (message) => message.id === 1,
            (message) => {
                const result = isObjectRecord(message.result) ? message.result : null;
                if (result === null) {
                    finalize(() =>
                        reject(new Error(`${options.displayName} returned an invalid initialize response.`))
                    );
                    return;
                }

                sendMessage({
                    jsonrpc: "2.0",
                    method: "notifications/initialized",
                    params: {}
                });
                sendMessage({
                    id: 2,
                    jsonrpc: "2.0",
                    method: "tools/list",
                    params: {}
                });

                waitForMessage(
                    (toolsMessage) => toolsMessage.id === 2,
                    (toolsMessage) => {
                        const toolsResult = isObjectRecord(toolsMessage.result) ? toolsMessage.result : null;
                        const toolsValue = Array.isArray(toolsResult?.tools) ? toolsResult.tools : [];
                        const serverInfo = isObjectRecord(result.serverInfo) ? result.serverInfo : null;

                        finalize(() =>
                            resolve(
                                Object.freeze({
                                    serverName:
                                        typeof serverInfo?.name === "string" ? serverInfo.name : options.displayName,
                                    serverVersion:
                                        typeof serverInfo?.version === "string" ? serverInfo.version : "unknown",
                                    tools: Object.freeze(
                                        toolsValue
                                            .map((entry) => {
                                                if (!isObjectRecord(entry) || typeof entry.name !== "string") {
                                                    return null;
                                                }

                                                return Object.freeze({
                                                    description:
                                                        typeof entry.description === "string" ? entry.description : "",
                                                    inputSchema: entry.inputSchema,
                                                    name: entry.name
                                                });
                                            })
                                            .filter(
                                                (
                                                    entry
                                                ): entry is Readonly<{
                                                    description: string;
                                                    inputSchema: unknown;
                                                    name: string;
                                                }> => entry !== null
                                            )
                                    )
                                })
                            )
                        );
                    }
                );
            }
        );
    });
}

/**
 * Type guard: true when `value` is a plain Record (non-null object that is not
 * an Array).  Useful for narrowing unknown JSON-deserialized payloads.
 */
function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && Array.isArray(value) === false;
}

/**
 * Type guard: true when `value` is a valid JSON-RPC 2.0 message object.
 *
 * JSON-RPC 2.0 requires that every message is a JSON object with a "jsonrpc"
 * property set to exactly "2.0". This guard rejects null, arrays, primitives,
 * and objects that lack the required field, preventing malformed payloads from
 * entering the message queue where they could cause downstream type errors.
 *
 * @see https://www.jsonrpc.org/specification
 */
function isValidJsonRpcMessage(value: unknown): value is Record<string, unknown> {
    return isObjectRecord(value) && value.jsonrpc === "2.0";
}
