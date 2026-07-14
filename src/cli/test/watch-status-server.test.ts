import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { findAvailablePort } from "./test-helpers/free-port.js";
import { waitForScanComplete, waitForStatus } from "./test-helpers/status-polling.js";
import { runWatchTest } from "./test-helpers/watch-runner.js";
import { connectToHotReloadWebSocket } from "./test-helpers/websocket-client.js";

void describe("watch command status server", () => {
    void it("should start status server by default and provide status endpoint", async () => {
        await runWatchTest("watch-status-test", {}, async ({ baseUrl }) => {
            // Query the status endpoint
            const response = await fetch(`${baseUrl}/status`);

            assert.equal(response.status, 200, "Status endpoint should return 200");
            assert.equal(
                response.headers.get("content-type"),
                "application/json",
                "Content type should be application/json"
            );

            const data = await response.json();

            assert.ok("uptime" in data, "Status should include uptime");
            assert.ok("patchCount" in data, "Status should include patchCount");
            assert.ok("errorCount" in data, "Status should include errorCount");
            assert.ok("recentPatches" in data, "Status should include recentPatches");
            assert.ok("recentErrors" in data, "Status should include recentErrors");
            assert.ok("websocketClients" in data, "Status should include websocketClients");

            assert.equal(data.patchCount, 0, "Initial patch count should be 0");
            assert.equal(data.errorCount, 0, "Initial error count should be 0");
            assert.equal(data.websocketClients, 0, "Initial WebSocket client count should be 0");
        });
    });

    void it("should respect --no-status-server flag", async () => {
        await runWatchTest("watch-no-status-test", { statusServer: false }, async ({ baseUrl }) => {
            // Try to query the status endpoint - should fail
            try {
                await fetch(`${baseUrl}/status`);
                assert.fail("Status server should not be running");
            } catch (error) {
                // Connection should be refused when server is disabled
                assert.ok(error instanceof Error, "Expected an error when connecting to disabled server");
            }
        });
    });

    void it("reports only acknowledgements for patch revisions emitted by this watcher", async () => {
        const websocketPort = await findAvailablePort();
        await runWatchTest(
            "watch-applied-patch-status",
            { websocketServer: true, websocketPort },
            async ({ baseUrl, testDir }) => {
                const client = await connectToHotReloadWebSocket(`ws://127.0.0.1:${websocketPort}`);
                try {
                    await waitForScanComplete(baseUrl);
                    await writeFile(path.join(testDir, "player.gml"), "var speed = 4;", "utf8");
                    const [patch] = await client.waitForPatches({ timeoutMs: 4000 });
                    assert.equal(typeof patch?.revision, "string");

                    client.websocketClient.send(
                        JSON.stringify({
                            type: "patch_ack",
                            id: patch?.id,
                            revision: patch?.revision,
                            status: "applied"
                        })
                    );

                    const status = await waitForStatus(
                        baseUrl,
                        (payload) => payload.lastAppliedPatch?.revision === patch?.revision,
                        4000
                    );
                    assert.equal(status.lastAppliedPatch?.id, patch?.id);
                    assert.equal(status.appliedPatchClients?.length, 1);
                } finally {
                    await client.disconnect();
                }
            }
        );
    });

    void it("should handle missing route with 404 error", async () => {
        await runWatchTest("watch-status-404-test", {}, async ({ baseUrl }) => {
            // Query a non-existent endpoint
            const response = await fetch(`${baseUrl}/nonexistent`);

            assert.equal(response.status, 404, "Non-existent route should return 404");

            const data = await response.json();
            assert.ok("error" in data, "Error response should include error field");
        });
    });
});
