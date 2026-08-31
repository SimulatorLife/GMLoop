import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";

import { __graphCommandTest__ } from "../src/commands/graph/index.js";

function listenServer(server: net.Server, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const handleError = (error: Error) => {
            server.off("listening", handleListening);
            reject(error);
        };
        const handleListening = () => {
            server.off("error", handleError);
            resolve();
        };
        server.once("error", handleError);
        server.once("listening", handleListening);
        server.listen(port, "127.0.0.1");
    });
}

function closeServer(server: net.Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close((error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

const PROBE_COUNT = 5;

void describe("graph visualize live-reload port probe cleanup", () => {
    void it("releases every allocated probe port before returning", async () => {
        const ports = await Promise.all(
            Array.from({ length: PROBE_COUNT }, () =>
                __graphCommandTest__.allocateGraphVisualizationLiveReloadPort("127.0.0.1")
            )
        );

        assert.equal(new Set(ports).size, PROBE_COUNT, "each concurrent probe should allocate a distinct port");

        await Promise.all(
            ports.map(async (port) => {
                const server = net.createServer();
                try {
                    await listenServer(server, port);
                } finally {
                    if (server.listening) {
                        await closeServer(server);
                    }
                }
            })
        );
    });

    void it("treats an already-closed probe server as successfully cleaned up", async () => {
        const server = net.createServer();
        await assert.doesNotReject(() => __graphCommandTest__.closeGraphVisualizationLiveReloadProbeServer(server));
        assert.equal(server.listening, false);
    });

    void it("propagates unexpected close errors while allowing deterministic teardown", async () => {
        const server = net.createServer();
        await listenServer(server, 0);
        const originalClose = server.close;
        const syntheticError = Object.assign(new Error("synthetic close failure"), { code: "EBADF" });

        server.close = function failingClose(callback?: (error?: Error) => void): net.Server {
            callback?.(syntheticError);
            return this;
        };

        try {
            await assert.rejects(
                () => __graphCommandTest__.closeGraphVisualizationLiveReloadProbeServer(server),
                /synthetic close failure/
            );
        } finally {
            server.close = originalClose;
            await closeServer(server);
        }
    });

    void it("allocates distinct status and websocket endpoint ports", async () => {
        const endpoints = await __graphCommandTest__.allocateGraphVisualizationLiveReloadEndpointOptions();

        assert.ok(endpoints.statusPort > 0);
        assert.ok(endpoints.websocketPort > 0);
        assert.notEqual(endpoints.statusPort, endpoints.websocketPort);
    });
});
