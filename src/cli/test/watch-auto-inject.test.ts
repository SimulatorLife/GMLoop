/**
 * Tests for the watch command's --auto-inject flag.
 *
 * Verifies that the watch command can automatically prepare the hot-reload
 * environment by injecting the runtime wrapper into the HTML5 output before
 * starting the file watcher.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";

import { runWatchCommand } from "../src/commands/watch.js";
import { LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH } from "../src/modules/live-reload/config.js";

const AUTO_INJECT_WAIT_TIMEOUT_MS = 5000;
const AUTO_INJECT_POLL_INTERVAL_MS = 25;

async function waitForIndexContentMatch(
    indexHtmlPath: string,
    matcher: (indexContent: string) => boolean,
    timeoutMs = AUTO_INJECT_WAIT_TIMEOUT_MS
): Promise<string> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const indexContent = await readFile(indexHtmlPath, "utf8");
        if (matcher(indexContent)) {
            return indexContent;
        }

        await setTimeoutPromise(AUTO_INJECT_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for index.html content update after ${timeoutMs} ms`);
}

async function waitForFileContentMatch(
    filePath: string,
    matcher: (contents: string) => boolean,
    timeoutMs = AUTO_INJECT_WAIT_TIMEOUT_MS
): Promise<string> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const contents = await readFile(filePath, "utf8").catch(() => null);
        if (contents !== null && matcher(contents)) {
            return contents;
        }

        await setTimeoutPromise(AUTO_INJECT_POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for file content update after ${timeoutMs} ms: ${filePath}`);
}

void describe("Watch command auto-inject flag", () => {
    void it("should inject hot-reload runtime when --auto-inject is enabled", async () => {
        const testDir = path.join("/tmp", `watch-auto-inject-${Date.now()}-${randomUUID()}`);
        const html5OutputDir = path.join(testDir, "html5-output");
        const indexHtmlPath = path.join(html5OutputDir, "index.html");

        await mkdir(html5OutputDir, { recursive: true });
        await writeFile(
            indexHtmlPath,
            "<html><head><title>Test</title></head><body><p>Test game</p></body></html>",
            "utf8"
        );

        const abortController = new AbortController();
        const configPath = path.join(html5OutputDir, ".gml-hot-reload", LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH);

        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: false,
            runtimeServer: false,
            autoInject: true,
            html5Output: html5OutputDir,
            abortSignal: abortController.signal,
            watchFactory: () => {
                return {
                    close: () => {},
                    on: () => {}
                } as any;
            }
        });

        try {
            const indexContent = await waitForIndexContentMatch(indexHtmlPath, (content) =>
                content.includes("gml-hot-reload:start")
            );
            const configContent = await waitForFileContentMatch(configPath, (content) =>
                content.includes("ws://127.0.0.1:17890")
            );
            assert.ok(indexContent.includes("gml-hot-reload:start"), "Should contain hot-reload marker start");
            assert.ok(indexContent.includes("gml-hot-reload:end"), "Should contain hot-reload marker end");
            assert.ok(
                indexContent.includes("runtime-wrapper/browser/index.js"),
                "Should reference the browser bootstrap entry"
            );
            assert.ok(
                configContent.includes("ws://127.0.0.1:17890"),
                "Should write the default WebSocket URL to config"
            );
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("should use custom WebSocket URL when both --auto-inject and custom port are provided", async () => {
        const testDir = path.join("/tmp", `watch-auto-inject-custom-${Date.now()}-${randomUUID()}`);
        const html5OutputDir = path.join(testDir, "html5-output");
        const indexHtmlPath = path.join(html5OutputDir, "index.html");

        await mkdir(html5OutputDir, { recursive: true });
        await writeFile(
            indexHtmlPath,
            "<html><head><title>Test</title></head><body><p>Test game</p></body></html>",
            "utf8"
        );

        const abortController = new AbortController();
        const customPort = 18_000;
        const customHost = "localhost";
        const configPath = path.join(html5OutputDir, ".gml-hot-reload", LIVE_RELOAD_BOOTSTRAP_CONFIG_RELATIVE_PATH);

        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: false,
            runtimeServer: false,
            autoInject: true,
            html5Output: html5OutputDir,
            websocketPort: customPort,
            websocketHost: customHost,
            abortSignal: abortController.signal,
            watchFactory: () => {
                return {
                    close: () => {},
                    on: () => {}
                } as any;
            }
        });

        try {
            const configContent = await waitForFileContentMatch(configPath, (content) =>
                content.includes(`ws://${customHost}:${customPort}`)
            );
            assert.ok(
                configContent.includes(`ws://${customHost}:${customPort}`),
                `Should contain custom WebSocket URL ws://${customHost}:${customPort}`
            );
        } finally {
            abortController.abort();
            await watchPromise;
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("should not inject when --auto-inject is not provided", async () => {
        const testDir = path.join("/tmp", `watch-no-inject-${Date.now()}-${randomUUID()}`);
        const html5OutputDir = path.join(testDir, "html5-output");
        const indexHtmlPath = path.join(html5OutputDir, "index.html");
        const originalContent = "<html><head><title>Test</title></head><body><p>Test game</p></body></html>";

        await mkdir(html5OutputDir, { recursive: true });
        await writeFile(indexHtmlPath, originalContent, "utf8");

        const abortController = new AbortController();

        const watchPromise = runWatchCommand(testDir, {
            extensions: [".gml"],
            verbose: false,
            quiet: true,
            websocketServer: false,
            statusServer: false,
            runtimeServer: false,
            autoInject: false,
            abortSignal: abortController.signal,
            watchFactory: () => {
                return {
                    close: () => {},
                    on: () => {}
                } as any;
            }
        });

        await setTimeoutPromise(200);
        abortController.abort();
        await watchPromise;

        const indexContent = await readFile(indexHtmlPath, "utf8");
        assert.strictEqual(indexContent, originalContent, "Should not modify index.html when auto-inject is disabled");

        await rm(testDir, { recursive: true, force: true });
    });
});
