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

        const cleanup = () => {
            if (childProcess.killed === false) {
                childProcess.kill("SIGTERM");
            }
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
            callback();
        };

        const flushStdoutMessages = () => {
            let newlineIndex = stdoutBuffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const rawLine = stdoutBuffer.slice(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                if (rawLine.length > 0) {
                    try {
                        const parsedLine = JSON.parse(rawLine) as Record<string, unknown>;
                        pendingMessages.push(parsedLine);
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
        ) => {
            const interval = setInterval(() => {
                const messageIndex = pendingMessages.findIndex(predicate);
                if (messageIndex === -1) {
                    return;
                }

                clearInterval(interval);
                const [message] = pendingMessages.splice(messageIndex, 1);
                if (message === undefined) {
                    finalize(() => reject(new Error(`Received an empty MCP response from ${options.displayName}.`)));
                    return;
                }

                onMatch(message);
            }, 20);

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

        const initializeInterval = waitForMessage(
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

                const toolsInterval = waitForMessage(
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

                childProcess.on("close", () => {
                    clearInterval(toolsInterval);
                });
            }
        );

        childProcess.on("close", () => {
            clearInterval(initializeInterval);
        });
    });
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && Array.isArray(value) === false;
}
