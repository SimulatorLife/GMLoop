import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { createWatchCommand, runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { fetchStatusPayload, waitForScanComplete } from "./test-helpers/status-polling.js";

void describe("watch command max-concurrent-dirs option", () => {
    void it("should have max-concurrent-dirs option", () => {
        const command = createWatchCommand();
        const maxConcurrentDirsOption = command.options.find((opt) => opt.long === "--max-concurrent-dirs");

        assert.ok(maxConcurrentDirsOption, "Should have --max-concurrent-dirs option");
        assert.equal(maxConcurrentDirsOption.defaultValue, 4, "Default max concurrent directories should be 4");
    });

    void it("should have max-concurrent-dirs with correct description", () => {
        const command = createWatchCommand();
        const maxConcurrentDirsOption = command.options.find((opt) => opt.long === "--max-concurrent-dirs");

        assert.ok(maxConcurrentDirsOption, "Should have --max-concurrent-dirs option");
        assert.ok(
            maxConcurrentDirsOption.description.includes("Maximum number of directories"),
            "Should have descriptive help text"
        );
        assert.ok(
            maxConcurrentDirsOption.description.includes("initial file discovery"),
            "Should mention initial file discovery"
        );
    });

    void it("respects low max-concurrent-dirs values while completing initial scan", async () => {
        const fixtureDir = path.join(process.cwd(), "tmp", `watch-max-concurrent-dirs-${Date.now()}`);
        await mkdir(fixtureDir, { recursive: true });

        const nestedDirectories = ["a", "a/b", "a/b/c", "d", "d/e", "d/e/f"];
        await Promise.all(
            nestedDirectories.map(async (relativePath) =>
                mkdir(path.join(fixtureDir, relativePath), { recursive: true })
            )
        );

        const gmlFiles = [
            "root_script.gml",
            "a/alpha.gml",
            "a/b/beta.gml",
            "a/b/c/gamma.gml",
            "d/delta.gml",
            "d/e/f/epsilon.gml"
        ];
        await Promise.all(
            gmlFiles.map(async (relativePath) =>
                writeFile(path.join(fixtureDir, relativePath), "var value = 1;", "utf8")
            )
        );

        const statusPort = await findAvailablePort();
        const abortController = new AbortController();
        const statusBaseUrl = `http://127.0.0.1:${statusPort}`;

        const watchPromise = runWatchCommand(fixtureDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: true,
            statusPort,
            runtimeServer: false,
            maxConcurrentDirs: 1,
            abortSignal: abortController.signal
        });

        try {
            await waitForScanComplete(statusBaseUrl, 10_000, 25);
            const status = await fetchStatusPayload(statusBaseUrl);
            assert.equal(status.scanComplete, true, "Initial scan should complete");
            assert.ok(
                (status.totalPatchCount ?? status.patchCount ?? 0) >= gmlFiles.length,
                "Initial scan should transpile discovered files with bounded concurrency"
            );
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting.
            }

            await rm(fixtureDir, { recursive: true, force: true });
        }
    });
});
