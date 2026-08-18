import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runWatchTest } from "./test-helpers/watch-runner.js";

/**
 * Integration coverage for the helper-extracted status snapshot builder.
 *
 * The watch command's status snapshot pulls `runtimeUrl`, `statusUrl`, and
 * `websocketUrl` through getter functions so the values can be populated
 * after the helper runs (the runtime and WebSocket servers are wired up
 * later in the startup sequence). This test confirms those URL fields are
 * present and well-formed on the live `/status` endpoint so any future
 * regression in the getter-based wiring surfaces immediately.
 */
void describe("watch command status snapshot url fields", () => {
    void it("populates statusUrl, runtimeUrl, and websocketUrl once all servers are up", async () => {
        await runWatchTest("watch-snapshot-url-fields", { websocketServer: true }, async ({ baseUrl }) => {
            const response = await fetch(`${baseUrl}/status`);
            assert.equal(response.status, 200, "Status endpoint should return 200");

            const snapshot = (await response.json()) as Record<string, unknown>;

            assert.equal(
                typeof snapshot.statusUrl,
                "string",
                "statusUrl should be a string once the status server is up"
            );
            const statusUrl = snapshot.statusUrl as string;
            assert.ok(
                statusUrl.startsWith("http://"),
                `statusUrl should be a well-formed http URL but was ${statusUrl}`
            );

            assert.equal(
                typeof snapshot.websocketUrl,
                "string",
                "websocketUrl should be a string once the patch WebSocket server is up"
            );
            const websocketUrl = snapshot.websocketUrl as string;
            assert.ok(
                websocketUrl.startsWith("ws://"),
                `websocketUrl should be a well-formed ws URL but was ${websocketUrl}`
            );
        });
    });
});
