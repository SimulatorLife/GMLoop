/**
 * Integration tests for incremental transpilation with dependency tracking.
 *
 * Covers two complementary scenarios:
 * 1. When a file changes without changing its exported symbol set,
 *    dependent files are NOT retranspiled (latency saving).
 * 2. When a file's exported symbols change, only files that reference the
 *    changed symbol names are retranspiled.
 */

import assert from "node:assert";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { fetchStatusPayload, waitForScanComplete, waitForStatus } from "./test-helpers/status-polling.js";
import {
    connectToHotReloadWebSocket,
    type HotReloadScriptPatch,
    type WebSocketPatchStream
} from "./test-helpers/websocket-client.js";

void describe("Hot reload incremental transpilation", () => {
    let testDir: string;
    let baseFile: string;
    let dependentFile: string;
    let websocketContextPromise: Promise<WebSocketPatchStream> | null = null;

    before(async () => {
        testDir = path.join(process.cwd(), "tmp", `test-incremental-${Date.now()}`);
        await mkdir(testDir, { recursive: true });

        // Create a base script that defines a function
        baseFile = path.join(testDir, "base_script.gml");
        await writeFile(
            baseFile,
            `function helper_function() {
    return 42;
}`,
            "utf8"
        );

        // Create a dependent script that calls the function from base_script
        dependentFile = path.join(testDir, "dependent_script.gml");
        await writeFile(
            dependentFile,
            `function use_helper() {
    var result = helper_function();
    return result;
}`,
            "utf8"
        );
    });

    after(async () => {
        const contextPromise = websocketContextPromise;
        websocketContextPromise = null;

        if (contextPromise !== null) {
            try {
                const context = await contextPromise;
                await context.disconnect();
            } catch {
                // Ignore cleanup failures; tests already handle connection lifecycle
            }
        }

        if (testDir) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("should skip dependent retranspilation when definitions are unchanged", async () => {
        const websocketPort = await findAvailablePort();
        const statusPort = await findAvailablePort();
        const abortController = new AbortController();

        // Start the watch command
        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketPort,
            websocketHost: "127.0.0.1",
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        let context: WebSocketPatchStream | null = null;

        try {
            // Connect WebSocket client
            const contextPromise = connectToHotReloadWebSocket(`ws://127.0.0.1:${websocketPort}`, {
                connectionTimeoutMs: 8000,
                retryIntervalMs: 50
            });
            websocketContextPromise = contextPromise;
            context = await contextPromise;

            await waitForScanComplete(`http://127.0.0.1:${statusPort}`, 10_000, 50);

            const initialHelperCount = context.receivedPatches.filter((patch) =>
                patch.id.includes("helper_function")
            ).length;

            // Modify the base script
            await writeFile(
                baseFile,
                `function helper_function() {
    return 100;  // Changed from 42
}`,
                "utf8"
            );

            // Wait for transpilation and dependent file retranspilation
            await context.waitForPatches({
                timeoutMs: 2000,
                minCount: 1,
                predicate: (patch: HotReloadScriptPatch): patch is HotReloadScriptPatch =>
                    patch.id.includes("helper_function"),
                startCount: initialHelperCount
            });

            await delay(300);
        } finally {
            // Stop the watch command
            abortController.abort();

            if (context) {
                await context.disconnect();
            }

            try {
                await watchPromise;
            } catch {
                // Expected to be aborted
            }
        }

        // Verify that we received patches for the base file and no extra patch for the dependent file.
        // The base file should be transpiled because it changed.
        // The dependent file should not be retranspiled when symbol definitions stay the same.
        assert.ok(context, "WebSocket client should be connected");
        const basePatches = context.receivedPatches.filter((p) => p.id.includes("helper_function"));
        const dependentPatches = context.receivedPatches.filter((p) => p.id.includes("use_helper"));

        assert.ok(basePatches.length >= 2, "Should have received initial and updated patch for base_script");
        assert.strictEqual(
            dependentPatches.length,
            1,
            "Dependent script should only receive the initial patch when definitions are unchanged"
        );

        assert.ok(basePatches.length > 0, "Should record patches for helper_function");
        assert.ok(dependentPatches.length > 0, "Should record patches for use_helper");
    });
});

void describe("Hot reload targeted dependent retranspilation on definition change", () => {
    let testDir: string;
    let baseFile: string;
    let dependentFile: string;

    before(async () => {
        testDir = path.join(process.cwd(), "tmp", `test-def-change-${Date.now()}`);
        await mkdir(testDir, { recursive: true });

        baseFile = path.join(testDir, "base_defs.gml");
        await writeFile(
            baseFile,
            `function original_func() {
    return 1;
}`,
            "utf8"
        );

        // consumer_defs.gml calls original_func so the dependency tracker registers
        // base_defs.gml as a dependency for the existing exported symbol.
        dependentFile = path.join(testDir, "consumer_defs.gml");
        await writeFile(
            dependentFile,
            `function consume_defs() {
    return original_func();
}`,
            "utf8"
        );
    });

    after(async () => {
        if (testDir) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    // Adding an unrelated exported symbol should not force existing dependents to
    // retranspile when they do not reference the new name. This keeps the hot-reload
    // loop focused on concrete symbol deltas and avoids unnecessary recompilation.
    void it("should skip dependent retranspilation when base file adds an unrelated exported symbol", async () => {
        const statusPort = await findAvailablePort();
        const websocketPort = await findAvailablePort();
        const abortController = new AbortController();
        const statusUrl = `http://127.0.0.1:${statusPort}`;

        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketPort,
            websocketHost: "127.0.0.1",
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        let patchCountAfterChange: number;

        try {
            // Wait for the initial scan to finish – both files are transpiled at this point.
            await waitForScanComplete(statusUrl, 10_000, 50);

            const initialStatus = await fetchStatusPayload(statusUrl);
            // The initial scan transpiles all GML files in the directory.
            const initialPatchCount = initialStatus.patchCount ?? 0;

            // Sanity: both base_defs and consumer_defs should have been transpiled.
            assert.ok(initialPatchCount >= 2, `Initial scan should transpile both files (got ${initialPatchCount})`);

            // Rewrite the base file with an additional exported symbol that the
            // consumer file does not reference.
            await writeFile(
                baseFile,
                `function original_func() {
    return 1;
}

function new_exported_func() {
    return 2;
}`,
                "utf8"
            );

            // Only the changed definition file should be retranspiled.
            await waitForStatus(statusUrl, (status) => (status.patchCount ?? 0) >= initialPatchCount + 1, 8000, 50);

            const finalStatus = await fetchStatusPayload(statusUrl);
            patchCountAfterChange = (finalStatus.patchCount ?? 0) - initialPatchCount;
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected to be aborted
            }
        }

        assert.strictEqual(
            patchCountAfterChange,
            1,
            "Adding an unrelated export should retranspile only the changed definition file"
        );
    });

    void it("should retranspile a dependent file when a newly added export satisfies its reference", async () => {
        const statusPort = await findAvailablePort();
        const websocketPort = await findAvailablePort();
        const missingReferenceDir = path.join(testDir, "missing-reference");
        await mkdir(missingReferenceDir, { recursive: true });

        const defsFile = path.join(missingReferenceDir, "defs.gml");
        const consumerFile = path.join(missingReferenceDir, "consumer.gml");

        await writeFile(
            defsFile,
            `function existing_func() {
    return 1;
}`,
            "utf8"
        );

        await writeFile(
            consumerFile,
            `function consume_defs() {
    return future_func();
}`,
            "utf8"
        );

        const abortController = new AbortController();
        const statusUrl = `http://127.0.0.1:${statusPort}`;

        const watchPromise = runWatchCommand(missingReferenceDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketPort,
            websocketHost: "127.0.0.1",
            runtimeServer: false,
            statusServer: true,
            statusPort,
            abortSignal: abortController.signal
        });

        let patchCountAfterChange: number;
        let liveLatencyPatchCount: number;

        try {
            await waitForScanComplete(statusUrl, 10_000, 50);

            const initialStatus = await fetchStatusPayload(statusUrl);
            const initialPatchCount = initialStatus.patchCount ?? 0;
            assert.ok(initialPatchCount >= 2, `Initial scan should transpile both files (got ${initialPatchCount})`);

            await writeFile(
                defsFile,
                `function existing_func() {
    return 1;
}

function future_func() {
    return 2;
}`,
                "utf8"
            );

            await waitForStatus(statusUrl, (status) => (status.patchCount ?? 0) >= initialPatchCount + 2, 8000, 50);

            const finalStatus = await fetchStatusPayload(statusUrl);
            patchCountAfterChange = (finalStatus.patchCount ?? 0) - initialPatchCount;
            liveLatencyPatchCount = (finalStatus.recentPatches ?? []).filter(
                (patch) => typeof patch.hotReloadLatencyMs === "number"
            ).length;
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected to be aborted
            }
        }

        assert.strictEqual(
            patchCountAfterChange,
            2,
            "Adding a newly referenced export should retranspile both the changed file and its waiting consumer"
        );
        assert.ok(
            liveLatencyPatchCount >= 2,
            "Changed file and dependent retranspile should both record end-to-end hot-reload latency"
        );
    });
});
