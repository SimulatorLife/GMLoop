import type { WatchListener } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Cli from "@gmloop/cli";

import { withTemporaryProperty } from "./temporary-property.js";
import { createMockWatchFactory } from "./watch-fixtures.js";

export interface FileRemovalTestOptions {
    tmpPrefix: string;
    eventType: "change" | "rename";
}

export interface FileRemovalTestResult {
    removedFilePath: string | null;
    targetFile: string;
}

/**
 * Shared test helper for file removal scenarios in watch command.
 * Sets up a temporary directory with a test file, configures dependency tracking,
 * removes the file, and triggers the specified watch event.
 */
export async function runFileRemovalTest(options: FileRemovalTestOptions): Promise<FileRemovalTestResult> {
    const root = await mkdtemp(path.join(tmpdir(), options.tmpPrefix));
    const targetFile = path.join(root, "script1.gml");
    await writeFile(targetFile, "var x = 1;", "utf8");

    const abortController = new AbortController();
    const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
    const removeFileDescriptor = Object.getOwnPropertyDescriptor(
        Cli.CLI.Modules.DependencyTracker.prototype,
        "removeFile"
    );
    if (!removeFileDescriptor || typeof removeFileDescriptor.value !== "function") {
        throw new Error("Expected DependencyTracker.removeFile to be defined");
    }
    const callOriginalRemoveFile = Function.prototype.call.bind(removeFileDescriptor.value) as (
        tracker: Cli.CLI.Modules.DependencyTracker,
        filePath: string
    ) => void;
    let removedFilePath: string | null = null;
    let resolveRemoval: (() => void) | null = null;
    const removalPromise = new Promise<void>((resolve) => {
        resolveRemoval = resolve;
    });

    const watchFactory = createMockWatchFactory(listenerCapture);

    await withTemporaryProperty(
        Cli.CLI.Modules.DependencyTracker.prototype,
        "removeFile",
        function (this: Cli.CLI.Modules.DependencyTracker, filePath: string): void {
            removedFilePath = filePath;
            resolveRemoval?.();
            return callOriginalRemoveFile(this, filePath);
        },
        async () => {
            const watchPromise = Cli.CLI.Commands.runWatchCommand(root, {
                extensions: [".gml"],
                verbose: false,
                quiet: true,
                debounceDelay: 0,
                runtimeServer: false,
                websocketServer: false,
                statusServer: false,
                abortSignal: abortController.signal,
                watchFactory
            });

            // Wait for watch listener to be registered (up to 2000ms)
            const start = Date.now();
            while (!listenerCapture.listener && Date.now() - start < 2000) {
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            if (!listenerCapture.listener) {
                throw new Error("Timeout waiting for watch listener registration");
            }

            // Keep standard brief delay to let initial scan setup progress
            await new Promise((resolve) => setTimeout(resolve, 50));

            await rm(targetFile, { force: true });
            listenerCapture.listener?.(options.eventType, path.basename(targetFile));

            await Promise.race([removalPromise, new Promise((resolve) => setTimeout(resolve, 500))]);

            abortController.abort();
            await watchPromise;
        }
    );

    await rm(root, { recursive: true, force: true });

    return { removedFilePath, targetFile };
}
