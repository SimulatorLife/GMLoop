import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { startStatusServer } from "../src/modules/status/server.js";
import { createHttpSocketAndWaitForResponse } from "./test-helpers/http-socket-utils.js";

void describe("status server lifecycle", () => {
    void it("closes active sockets on stop", async () => {
        const controller = await startStatusServer({
            host: "127.0.0.1",
            port: 0,
            getSnapshot: () => ({
                uptime: 0,
                patchCount: 0,
                errorCount: 0,
                recentPatches: [],
                recentErrors: [],
                websocketClients: 0
            })
        });

        const { socket, closePromise, responsePromise } = await createHttpSocketAndWaitForResponse(
            controller.host,
            controller.port,
            "GET /status HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n"
        );

        await responsePromise;
        await controller.stop();

        const closed = await Promise.race([closePromise.then(() => true), delay(500).then(() => false)]);

        if (!socket.destroyed) {
            socket.destroy();
        }

        assert.equal(closed, true, "Expected status server stop to close active sockets");
    });

    void it("stops accepting new connections after stop()", async () => {
        const controller = await startStatusServer({
            host: "127.0.0.1",
            port: 0,
            getSnapshot: () => ({
                uptime: 0,
                patchCount: 0,
                errorCount: 0,
                recentPatches: [],
                recentErrors: [],
                websocketClients: 0
            })
        });

        await controller.stop();

        // After stop(), the server should no longer accept new connections.
        // Attempting to connect should fail (connection refused or hang until timeout).
        const connectionRefused = await Promise.race([
            new Promise<boolean>((resolve) => {
                const req = http.get(`http://${controller.host}:${controller.port}/status`, (res) => {
                    res.resume();
                    resolve(false);
                });
                req.on("error", () => resolve(true));
                req.setTimeout(200, () => {
                    req.destroy();
                    resolve(false);
                });
            }),
            delay(1000).then(() => false)
        ]);

        assert.equal(
            connectionRefused,
            true,
            "Server should refuse connections after stop() — no lingering open socket"
        );
    });
});
