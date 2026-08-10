import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import * as Cli from "@gmloop/cli";

import type { StatusServerHandle } from "../../src/modules/status/server.js";
import { waitForStatusReady } from "./status-polling.js";

type WatchCommandOptions = Parameters<typeof Cli.CLI.Commands.runWatchCommand>[1];

export interface WatchTestContext {
    testDir: string;
    statusPort: number;
    baseUrl: string;
    abortController: AbortController;
}

export async function runWatchTest(
    testName: string,
    options: WatchCommandOptions,
    testFn: (context: WatchTestContext) => Promise<void>
): Promise<void> {
    const testDir = path.join("/tmp", `${testName}-${Date.now()}-${randomUUID()}`);

    await mkdir(testDir, { recursive: true });

    const abortController = new AbortController();
    let watchPromise: Promise<void> | undefined;

    try {
        const statusServerEnabled = options.statusServer !== false;

        // Resolved once the status server reports its real address via
        // `onStatusServerReady`. We intentionally do NOT pre-probe a free port
        // with a bind-then-close helper: closing the probe socket and later
        // rebinding the same port number is a time-of-check/time-of-use race —
        // another test (or process) can grab the port in between, producing a
        // sporadic `EADDRINUSE` failure with no deterministic reproduction.
        // Passing `statusPort: 0` lets the OS assign an ephemeral port at the
        // moment the real listener binds, which is race-free by construction.
        let resolvedStatusUrl = "";

        const mergedOptions = {
            polling: false,
            verbose: false,
            quiet: true,
            statusPort: 0,
            websocketServer: false,
            runtimeServer: false,
            abortSignal: abortController.signal,
            ...options,
            onStatusServerReady: (server: StatusServerHandle) => {
                resolvedStatusUrl = server.url;
                options.onStatusServerReady?.(server);
            }
        };

        // Ensure quiet is disabled if verbose is enabled
        if (mergedOptions.verbose) {
            mergedOptions.quiet = false;
        }

        watchPromise = Cli.CLI.Commands.runWatchCommand(testDir, mergedOptions);

        if (statusServerEnabled) {
            const deadline = Date.now() + 5000;
            while (resolvedStatusUrl.length === 0 && Date.now() < deadline) {
                await new Promise((resolve) => {
                    setTimeout(resolve, 25);
                });
            }
            if (resolvedStatusUrl.length === 0) {
                throw new Error("Timed out waiting for the status server to report its address.");
            }
            await waitForStatusReady(`http://127.0.0.1:${new URL(resolvedStatusUrl).port}`);
        }

        // When the status server is disabled there is no real port to report;
        // fall back to an arbitrary value so `baseUrl` still resolves to a
        // valid-but-unreachable address for tests that expect connections to fail.
        const statusPort = resolvedStatusUrl.length === 0 ? 0 : Number(new URL(resolvedStatusUrl).port);

        await testFn({
            testDir,
            statusPort,
            baseUrl: `http://127.0.0.1:${statusPort}`,
            abortController
        });

        abortController.abort();
        if (watchPromise !== undefined) {
            await watchPromise;
        }
    } finally {
        if (!abortController.signal.aborted) {
            abortController.abort();
            if (watchPromise !== undefined) {
                try {
                    await watchPromise;
                } catch {
                    // Ignore errors during cleanup
                }
            }
        }
        await rm(testDir, { recursive: true, force: true });
    }
}
