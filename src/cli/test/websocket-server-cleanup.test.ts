import assert from "node:assert/strict";
import { describe, it } from "node:test";

import WebSocket, { type RawData, type WebSocket as WebSocketType } from "ws";

import { startPatchWebSocketServer } from "../src/modules/websocket/server.js";

function waitForOpen(client: WebSocketType): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            client.off("open", handleOpen);
            client.off("error", handleError);
        };
        const handleOpen = () => {
            cleanup();
            resolve();
        };
        const handleError = (error: Error) => {
            cleanup();
            reject(error);
        };
        client.on("open", handleOpen);
        client.on("error", handleError);
    });
}

function waitForMessage(client: WebSocketType): Promise<unknown> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            client.off("message", handleMessage);
            client.off("error", handleError);
        };
        const rejectOnce = (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            reject(error);
        };
        const handleMessage = (data: RawData) => {
            if (settled) {
                return;
            }
            try {
                const payload = JSON.parse(data.toString());
                settled = true;
                cleanup();
                resolve(payload);
            } catch (error) {
                rejectOnce(error instanceof Error ? error : new Error(String(error)));
            }
        };
        const handleError = (error: Error) => {
            rejectOnce(error);
        };
        client.on("message", handleMessage);
        client.on("error", handleError);
    });
}

function waitForDisconnect(timeoutMs = 500): { done: Promise<void>; resolve: () => void } {
    let resolveFn: (value: void) => void;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const done = new Promise<void>((resolve, reject) => {
        resolveFn = resolve;
        timeoutId = setTimeout(() => {
            reject(new Error("Timed out waiting for client cleanup"));
        }, timeoutMs);
    });

    return {
        done,
        resolve: () => {
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            resolveFn(undefined);
        }
    };
}

void describe("patch websocket server client cleanup", () => {
    void it("releases client tracking on socket error", async () => {
        let disconnectCount = 0;
        let serverSocket: WebSocketType;
        const disconnectSignal = waitForDisconnect();

        const server = await startPatchWebSocketServer({
            host: "127.0.0.1",
            port: 0,
            onClientConnect: (_clientId, socket) => {
                serverSocket = socket;
            },
            onClientDisconnect: () => {
                disconnectCount += 1;
                disconnectSignal.resolve();
            }
        });

        const client = new WebSocket(server.url);

        try {
            await waitForOpen(client);

            assert.ok(serverSocket, "expected server-side socket to be available");

            serverSocket.emit("error", new Error("synthetic client error"));

            await disconnectSignal.done;

            assert.equal(disconnectCount, 1, "expected disconnect cleanup to run once");
        } finally {
            client.terminate();
            await server.stop();
        }
    });

    void it("sends queued replay patches as one ordered batch when clients connect", async () => {
        const replayPatches = [
            { kind: "script", id: "gml/script/first", js_body: "return 1;" },
            { kind: "script", id: "gml/script/second", js_body: "return 2;" },
            { kind: "script", id: "gml/script/third", js_body: "return 3;" }
        ];
        const server = await startPatchWebSocketServer({
            host: "127.0.0.1",
            port: 0,
            prepareInitialMessages: () => replayPatches
        });
        const client = new WebSocket(server.url);

        try {
            const replayPayloadPromise = waitForMessage(client);

            await waitForOpen(client);

            assert.deepEqual(await replayPayloadPromise, replayPatches);
        } finally {
            client.terminate();
            await server.stop();
        }
    });

    void it("logs structured close errors when client shutdown fails", async (testContext) => {
        let serverSocket: WebSocketType;
        const loggedErrors: Array<string> = [];

        testContext.mock.method(console, "error", (...args: Array<unknown>): void => {
            loggedErrors.push(args.map(String).join(" "));
        });

        const server = await startPatchWebSocketServer({
            host: "127.0.0.1",
            port: 0,
            verbose: true,
            onClientConnect: (_clientId, socket) => {
                serverSocket = socket;
            }
        });

        const client = new WebSocket(server.url);

        try {
            await waitForOpen(client);
            assert.ok(serverSocket, "expected server-side socket to be available");

            serverSocket.close = () => {
                throw new Error("socket close crash");
            };

            serverSocket.emit("error", new Error("synthetic client error"));

            await new Promise((resolve) => setTimeout(resolve, 10));

            const hasCloseFailureLog = loggedErrors.some(
                (entry) =>
                    entry.includes("[WebSocket] Failed to close client socket") && entry.includes("socket close crash")
            );
            assert.equal(hasCloseFailureLog, true, "expected close failure to be logged with fallback error details");
        } finally {
            client.terminate();
            await server.stop();
        }
    });
});
