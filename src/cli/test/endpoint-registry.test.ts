import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, it } from "node:test";

import { EndpointRegistry, startStatusServer, type StatusSnapshot } from "../src/modules/status/server.js";

// Stand-in `StatusEndpointHandler` used as the "first" registration in tests
// that only need a single placeholder value to compare against (lookup,
// iteration, listing). The signature is satisfied but the body is empty —
// the registry tests never invoke it, they only assert that the same function
// reference round-trips through register/get.
const mockHandler = (_req: IncomingMessage, _res: ServerResponse, _getSnapshot: () => StatusSnapshot) => {
    // Body intentionally empty: registry tests assert reference identity,
    // not behavior.
};

const handler1 = (_req: IncomingMessage, _res: ServerResponse, _getSnapshot: () => StatusSnapshot) => {
    // Distinct placeholder so the override test can confirm a later
    // registration replaces the earlier one for the same path.
};

const handler2 = (_req: IncomingMessage, _res: ServerResponse, _getSnapshot: () => StatusSnapshot) => {
    // Distinct placeholder that the override test expects to "win" the
    // lookup for the shared `/test` path; iteration tests also use it as the
    // second registered entry to verify ordering.
};

void describe("EndpointRegistry", () => {
    void it("should register and retrieve handlers", () => {
        const registry = new EndpointRegistry();

        registry.register("/test", mockHandler);

        const retrieved = registry.getHandler("/test");
        assert.equal(retrieved, mockHandler, "Should retrieve registered handler");
    });

    void it("should return undefined for unregistered paths", () => {
        const registry = new EndpointRegistry();

        const retrieved = registry.getHandler("/nonexistent");
        assert.equal(retrieved, undefined, "Should return undefined for unregistered path");
    });

    void it("should allow overriding handlers", () => {
        const registry = new EndpointRegistry();

        registry.register("/test", handler1);
        registry.register("/test", handler2);

        const retrieved = registry.getHandler("/test");
        assert.equal(retrieved, handler2, "Should retrieve most recently registered handler");
    });

    void it("should list registered paths", () => {
        const registry = new EndpointRegistry();

        registry.register("/path1", mockHandler);
        registry.register("/path2", mockHandler);
        registry.register("/path3", mockHandler);

        const paths = Array.from(registry.paths());
        assert.equal(paths.length, 3, "Should have 3 registered paths");
        assert.ok(paths.includes("/path1"), "Should include /path1");
        assert.ok(paths.includes("/path2"), "Should include /path2");
        assert.ok(paths.includes("/path3"), "Should include /path3");
    });

    void it("should iterate over entries", () => {
        const registry = new EndpointRegistry();

        registry.register("/path1", handler1);
        registry.register("/path2", handler2);

        const entries = Array.from(registry.entries());
        assert.equal(entries.length, 2, "Should have 2 entries");

        const [path1, h1] = entries[0];
        const [path2, h2] = entries[1];

        assert.equal(path1, "/path1", "First entry should be /path1");
        assert.equal(h1, handler1, "First entry should have handler1");
        assert.equal(path2, "/path2", "Second entry should be /path2");
        assert.equal(h2, handler2, "Second entry should have handler2");
    });
});

void describe("Status server with custom endpoints", () => {
    void it("should serve default endpoints when no custom endpoints provided", async () => {
        let snapshotCallCount = 0;
        const mockSnapshot: StatusSnapshot = {
            uptime: 1000,
            patchCount: 0,
            errorCount: 0,
            recentPatches: [],
            recentErrors: [],
            websocketClients: 0
        };

        const handle = await startStatusServer({
            host: "127.0.0.1",
            port: 0, // Let OS assign port
            getSnapshot: () => {
                snapshotCallCount++;
                return mockSnapshot;
            }
        });

        try {
            const response = await fetch(`${handle.url}`);
            assert.equal(response.status, 200, "Default /status endpoint should return 200");

            const data = await response.json();
            assert.ok("uptime" in data, "Should include uptime");
            assert.equal(data.uptime, 1000, "Should return correct uptime");
            assert.ok(snapshotCallCount > 0, "Should have called getSnapshot");
        } finally {
            await handle.stop();
        }
    });

    void it("should serve custom endpoints alongside default endpoints", async () => {
        const mockSnapshot: StatusSnapshot = {
            uptime: 2000,
            patchCount: 5,
            errorCount: 1,
            recentPatches: [],
            recentErrors: [],
            websocketClients: 2
        };

        const customEndpoints = new EndpointRegistry();
        customEndpoints.register("/metrics", (_req, res, getSnapshot) => {
            const snapshot = getSnapshot();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ patches: snapshot.patchCount, errors: snapshot.errorCount }));
        });

        const handle = await startStatusServer({
            host: "127.0.0.1",
            port: 0,
            getSnapshot: () => mockSnapshot,
            customEndpoints
        });

        try {
            // Test default endpoint still works
            const statusResponse = await fetch(`http://${handle.host}:${handle.port}/status`);
            assert.equal(statusResponse.status, 200, "Default /status endpoint should still work");

            // Test custom endpoint
            const metricsResponse = await fetch(`http://${handle.host}:${handle.port}/metrics`);
            assert.equal(metricsResponse.status, 200, "Custom /metrics endpoint should return 200");

            const metricsData = await metricsResponse.json();
            assert.equal(metricsData.patches, 5, "Should return correct patch count");
            assert.equal(metricsData.errors, 1, "Should return correct error count");
        } finally {
            await handle.stop();
        }
    });

    void it("should allow custom endpoints to override default endpoints", async () => {
        const mockSnapshot: StatusSnapshot = {
            uptime: 3000,
            patchCount: 10,
            errorCount: 0,
            recentPatches: [],
            recentErrors: [],
            websocketClients: 0
        };

        const customEndpoints = new EndpointRegistry();
        customEndpoints.register("/status", (_req, res, _getSnapshot) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ custom: true, message: "Custom status endpoint" }));
        });

        const handle = await startStatusServer({
            host: "127.0.0.1",
            port: 0,
            getSnapshot: () => mockSnapshot,
            customEndpoints
        });

        try {
            const response = await fetch(`http://${handle.host}:${handle.port}/status`);
            assert.equal(response.status, 200, "Custom /status endpoint should return 200");

            const data = await response.json();
            assert.equal(data.custom, true, "Should use custom endpoint");
            assert.equal(data.message, "Custom status endpoint", "Should return custom message");
            assert.ok(!("uptime" in data), "Should not include default uptime field");
        } finally {
            await handle.stop();
        }
    });

    void it("should return 404 for undefined custom endpoints", async () => {
        const mockSnapshot: StatusSnapshot = {
            uptime: 4000,
            patchCount: 0,
            errorCount: 0,
            recentPatches: [],
            recentErrors: [],
            websocketClients: 0
        };

        const customEndpoints = new EndpointRegistry();
        customEndpoints.register("/custom", (_req, res, _getSnapshot) => {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end("Custom endpoint");
        });

        const handle = await startStatusServer({
            host: "127.0.0.1",
            port: 0,
            getSnapshot: () => mockSnapshot,
            customEndpoints
        });

        try {
            const response = await fetch(`http://${handle.host}:${handle.port}/undefined`);
            assert.equal(response.status, 404, "Undefined endpoint should return 404");

            const data = await response.json();
            assert.ok("error" in data, "Should include error field");
        } finally {
            await handle.stop();
        }
    });
});
