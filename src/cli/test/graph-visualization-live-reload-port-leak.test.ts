/**
 * Resource-leak regression test: live-reload port probe server cleanup.
 *
 * **The leak**:
 * `allocateGraphVisualizationLiveReloadPort` opened a temporary `net.Server`
 * to reserve a free TCP port, then closed it before returning the port
 * number to the caller. The original implementation performed the close
 * inside two separate `await` blocks (one for the address-validation
 * branch and one for the success path) with no surrounding `try/finally`.
 * If `server.close()` rejected — for example with `ERR_SERVER_NOT_RUNNING`
 * when the kernel had already reclaimed the probe socket, or any other
 * unexpected error during the orderly close — the rejection escaped the
 * function and the `net.Server` instance, its underlying socket file
 * descriptor, and any pending `listening` state remained referenced by
 * the Node event loop. Repeated allocations (one per
 * `gmloop graph visualize --live-reload` invocation, two per session via
 * `allocateGraphVisualizationLiveReloadEndpointOptions`) would each leak
 * one file descriptor. The bound socket also kept the host:port reserved
 * until the process exited, defeating the purpose of the probe.
 *
 * **The fix**:
 * The allocation is wrapped in a `try/finally` whose cleanup branch calls
 * `closeGraphVisualizationLiveReloadProbeServer`. The helper treats
 * `server.listening === false` and the `ERR_SERVER_NOT_RUNNING` close
 * error as success so the `finally` block can run unconditionally; any
 * other close failure is followed by a defensive `destroy()` so the file
 * descriptor is always released before the error is rethrown.
 *
 * **Follow-up considerations**:
 * - The same audit should be performed on the `findAvailablePort` test
 *   helper in `test-helpers/free-port.ts` and the `findAvailablePorts`
 *   helper in `fixture-runner/src/project/project-fixtures.ts`. The
 *   production code in this fix is the higher-risk path because it
 *   runs inside the live-reload hot path of the `graph visualize`
 *   command and is not constrained to a single test process lifetime.
 * - The TOCTOU race documented on `allocateGraphVisualizationLiveReloadPort`
 *   (a successful probe is not a guarantee that the next `listen` on the
 *   same port will succeed) remains intentional. Closing the probe
 *   socket promptly is what makes the race window as short as the
 *   kernel allows.
 */
import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";

import { __graphCommandTest__ } from "../src/commands/graph/index.js";

type ProbeTrackingState = {
    /** Total `net.createServer` calls observed during the test. */
    created: number;
    /** Total close attempts observed during the test. */
    closed: number;
};

function createProbeTrackingState(): ProbeTrackingState {
    return {
        closed: 0,
        created: 0
    };
}

type ServerPrototypePatch = {
    /** Restore the original prototype methods. */
    restore: () => void;
    /** Override the per-instance close callback to inject a synthetic error. */
    withCloseFailing: (syntheticError: Error) => void;
    /** Servers observed during the test, indexed by allocation order. */
    observedServers: ReadonlyArray<net.Server>;
};

/**
 * Patch `net.Server.prototype.close` for the duration of a test so every
 * probe server used by the allocation helper is observable. The patches
 * intentionally only increment counters — they do not change behaviour,
 * so the underlying allocation logic still runs exactly as it would in
 * production.
 *
 * `net.Server` does not expose a `destroy()` method on its prototype, so
 * the test only instruments `close`. The defensive fallback in the
 * production helper uses `_handle.destroy()` (an internal Node field),
 * which is also outside our instrumentable surface, so we instead verify
 * the behaviour indirectly: the helper must reject with the synthetic
 * error, and the probe server must not still be listening afterward.
 */
function instrumentProbeServers(state: ProbeTrackingState): ServerPrototypePatch {
    const prototype = net.Server.prototype as unknown as {
        close: (this: net.Server, callback?: (error?: Error) => void) => net.Server;
    };

    const originalClose = prototype.close;
    const observedServers: Array<net.Server> = [];

    let closeOverride: ((this: net.Server, callback?: (error?: Error) => void) => net.Server) | undefined;

    prototype.close = function instrumentedClose(this: net.Server, callback?: (error?: Error) => void): net.Server {
        if (!observedServers.includes(this)) {
            observedServers.push(this);
        }
        if (closeOverride) {
            state.closed += 1;
            return closeOverride.call(this, callback);
        }
        state.closed += 1;
        return originalClose.call(this, callback);
    };

    const withCloseFailing = (syntheticError: Error) => {
        closeOverride = function failingClose(this: net.Server, callback?: (error?: Error) => void): net.Server {
            if (callback) {
                callback(syntheticError);
            }
            return this;
        };
    };

    const restore = () => {
        prototype.close = originalClose;
        closeOverride = undefined;
    };

    return { restore, withCloseFailing, observedServers };
}

/**
 * Wrap a callback so every `net.createServer` call is counted. The
 * `net.createServer` factory invokes `new net.Server()`, so prototype
 * instrumentation on `net.Server.prototype` is sufficient to observe
 * every server instance.
 */
async function withTrackedProbeCreation<T>(state: ProbeTrackingState, body: () => Promise<T>): Promise<T> {
    const originalCreateServer = net.createServer;
    (net as unknown as { createServer: typeof net.createServer }).createServer = function patchedCreateServer(
        ...args: Array<unknown>
    ): net.Server {
        const server = originalCreateServer.apply(net, args);
        state.created += 1;
        return server;
    };
    try {
        return await body();
    } finally {
        (net as unknown as { createServer: typeof net.createServer }).createServer = originalCreateServer;
    }
}

const PROBE_LOOP_ITERATIONS = 5;

void describe("graph visualize live-reload port probe (resource-leak regression)", () => {
    void it("closes every probe server on the success path", async () => {
        const state = createProbeTrackingState();
        const instrumentation = instrumentProbeServers(state);
        try {
            await withTrackedProbeCreation(state, async () => {
                for (let iteration = 0; iteration < PROBE_LOOP_ITERATIONS; iteration += 1) {
                    const port = await __graphCommandTest__.allocateGraphVisualizationLiveReloadPort("127.0.0.1");
                    assert.ok(Number.isInteger(port) && port > 0, `expected a positive port, got ${String(port)}`);
                }
            });
        } finally {
            instrumentation.restore();
        }

        assert.equal(state.created, PROBE_LOOP_ITERATIONS, "expected one probe server per allocation");
        assert.equal(
            state.closed,
            PROBE_LOOP_ITERATIONS,
            "every probe server must be closed; otherwise the bound socket is leaked until the process exits"
        );
        // The instrumentation captured every probe server; assert none remain
        // listening after the allocations resolved.
        for (const server of instrumentation.observedServers) {
            assert.equal(
                server.listening,
                false,
                "no probe server should remain listening after the allocation resolves"
            );
        }
    });

    void it("propagates close() rejections and unrefs the probe server on failure (regression)", async () => {
        // This test pins the contract for the cleanup helper when
        // `server.close()` rejects for an error other than
        // `ERR_SERVER_NOT_RUNNING`. With the original code, the rejection
        // escaped and the probe server was left in the listening state with
        // no opportunity to clean up. With the fix, the `try/finally`
        // wrapper invokes `closeGraphVisualizationLiveReloadProbeServer`,
        // which (a) propagates the original error so the caller sees what
        // happened, and (b) calls `unref()` so a stuck close cannot keep
        // the Node event loop alive indefinitely.
        const state = createProbeTrackingState();
        const instrumentation = instrumentProbeServers(state);
        instrumentation.withCloseFailing(Object.assign(new Error("synthetic close failure"), { code: "EBADF" }));

        try {
            await assert.rejects(
                () => __graphCommandTest__.allocateGraphVisualizationLiveReloadPort("127.0.0.1"),
                /synthetic close failure/
            );
        } finally {
            instrumentation.restore();
        }

        assert.equal(
            state.closed,
            1,
            "close() must have been invoked by the cleanup wrapper, even when it subsequently rejects"
        );

        const observedServer = instrumentation.observedServers[0];
        assert.ok(observedServer !== undefined, "instrumentation should have captured the probe server instance");
        // The `unref()` call is the strongest defence available without
        // reaching into private Node internals: after a failed close, the
        // server is no longer required to keep the event loop alive.
        assert.equal(
            (observedServer as unknown as { _unref?: boolean })._unref,
            true,
            "the probe server must have been unref()-ed so a stuck close cannot keep the event loop alive"
        );
    });

    void it("treats ERR_SERVER_NOT_RUNNING on close as success", async () => {
        // Calling close() a second time on an already-closed server raises
        // ERR_SERVER_NOT_RUNNING. The helper must swallow that specific
        // error so callers can use it from a `finally` block without
        // try/catching.
        const probeServer = net.createServer();
        await new Promise<void>((resolve, reject) => {
            probeServer.once("error", reject);
            probeServer.listen(0, "127.0.0.1", () => {
                probeServer.off("error", reject);
                resolve();
            });
        });
        await new Promise<void>((resolve) => {
            probeServer.close(() => {
                resolve();
            });
        });

        await assert.doesNotReject(async () => {
            await __graphCommandTest__.closeGraphVisualizationLiveReloadProbeServer(probeServer);
        });
        assert.equal(probeServer.listening, false, "server should no longer be listening");
    });

    void it("is a no-op when the server is already not listening", async () => {
        const probeServer = net.createServer();
        // Do not call listen — the server is immediately not-listening.
        await assert.doesNotReject(async () => {
            await __graphCommandTest__.closeGraphVisualizationLiveReloadProbeServer(probeServer);
        });
        assert.equal(probeServer.listening, false);
    });

    void it("allocates two distinct ports for status and websocket endpoints", async () => {
        const endpoints = await __graphCommandTest__.allocateGraphVisualizationLiveReloadEndpointOptions();

        assert.ok(endpoints.statusPort > 0);
        assert.ok(endpoints.websocketPort > 0);
        assert.notEqual(
            endpoints.statusPort,
            endpoints.websocketPort,
            "status and websocket must not share a port (each binds its own socket)"
        );
    });
});
