import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import * as Cli from "@gmloop/cli";

import { findAvailablePort } from "./free-port.js";
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
        const statusPort = await findAvailablePort();

        const mergedOptions = {
            extensions: [".gml"],
            polling: false,
            verbose: false,
            quiet: true,
            statusPort,
            websocketServer: false,
            runtimeServer: false,
            abortSignal: abortController.signal,
            ...options
        };

        // Ensure quiet is disabled if verbose is enabled
        if (mergedOptions.verbose) {
            mergedOptions.quiet = false;
        }

        watchPromise = Cli.CLI.Commands.runWatchCommand(testDir, mergedOptions);

        if (mergedOptions.statusServer) {
            await waitForStatusReady(`http://127.0.0.1:${statusPort}`);
        }

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
