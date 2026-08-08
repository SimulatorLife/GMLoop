/**
 * True end-to-end test for the hot-reload integration loop.
 *
 * Every other hot-reload test in this suite exercises the CLI's watch/transpile/
 * broadcast pipeline with a bespoke raw WebSocket test client (see
 * `test-helpers/websocket-client.ts`). That leaves the actual consumer of the
 * broadcast patches — the `@gmloop/runtime-wrapper` browser client and its
 * in-memory function registry — unverified against the real patch payloads the
 * CLI produces. This test wires the two packages together for real: it starts
 * `runWatchCommand`, connects with `RuntimeWrapper.createWebSocketClient`, and
 * applies incoming patches to a real `RuntimeWrapper.createRuntimeWrapper()`
 * registry, then calls the resulting function to confirm the new GML logic
 * actually runs.
 */

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { RuntimeWrapper } from "@gmloop/runtime-wrapper";

import { runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";

const SCRIPT_ID = "gml/script/hot_reload_e2e_check";

/**
 * The runtime-wrapper client only flushes patches once it detects the real
 * GameMaker HTML5 runtime (see `resolveRuntimeReadiness`), which probes for a
 * `JSON_game.ScriptNames`/`Scripts` global pair with at least one function
 * entry. Node has no such runtime, so tests stand in a minimal readiness
 * signal the same way `runtime-wrapper`'s own websocket tests do.
 */
function installRuntimeReadinessSignal(): void {
    const globals = globalThis as Record<string, unknown>;
    globals.JSON_game = {
        ScriptNames: ["gml_Script_bootstrap"],
        Scripts: [() => void 0]
    };
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, pollIntervalMs = 10): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await delay(pollIntervalMs);
    }

    if (!predicate()) {
        throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
    }
}

void describe("Hot reload integration loop (real runtime wrapper)", () => {
    let testDir: string;
    let testFile: string;

    before(async () => {
        testDir = path.join(process.cwd(), "tmp", `test-runtime-wrapper-${Date.now()}`);
        await mkdir(testDir, { recursive: true });
        testFile = path.join(testDir, "hot_reload_e2e_check.gml");
        await writeFile(testFile, "function hot_reload_e2e_check() {\n    return 1;\n}\n", "utf8");
    });

    after(async () => {
        if (testDir) {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("delivers a transpiled patch through the WebSocket client into a callable runtime function", async () => {
        installRuntimeReadinessSignal();

        const websocketPort = await findAvailablePort();
        const abortController = new AbortController();

        const watchPromise = runWatchCommand(testDir, {
            verbose: false,
            quiet: true,
            websocketPort,
            websocketHost: "127.0.0.1",
            runtimeServer: false,
            statusServer: false,
            abortSignal: abortController.signal
        });

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        const client = RuntimeWrapper.createWebSocketClient({
            url: `ws://127.0.0.1:${websocketPort}`,
            wrapper
        });

        try {
            await waitUntil(() => client.isConnected(), 8000);

            // The initial startup scan only builds the dependency graph — it does
            // not transpile a runtime patch (see `performInitialScan` in
            // `watch.ts`). The registry only gains an entry once a live file
            // change flows through `handleFileChange`, so drive two successive
            // edits end-to-end: file write -> watcher -> transpiler -> WebSocket
            // broadcast -> runtime-wrapper client -> registry.
            await writeFile(testFile, "function hot_reload_e2e_check() {\n    return 2;\n}\n", "utf8");
            await waitUntil(() => wrapper.getScript(SCRIPT_ID)?.() === 2, 4000);
            assert.equal(wrapper.getScript(SCRIPT_ID)?.(), 2, "First live edit should reach the runtime registry");

            await writeFile(testFile, "function hot_reload_e2e_check() {\n    return 3;\n}\n", "utf8");
            await waitUntil(() => wrapper.getScript(SCRIPT_ID)?.() === 3, 4000);
            assert.equal(
                wrapper.getScript(SCRIPT_ID)?.(),
                3,
                "Second live edit should replace the registered function again"
            );
        } finally {
            client.disconnect();
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting the watch loop.
            }
        }
    });
});
