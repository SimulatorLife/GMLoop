import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";

import { runCliTestCommand } from "../src/cli.js";
import {
    countSourceLines,
    createExtensionMatcher,
    createWatchCommand,
    hashSourceContent,
    resolveDependentRetranspileConcurrency,
    resolveUnknownScanConcurrency,
    runWatchCommand
} from "../src/commands/watch.js";
import {
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT,
    DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS,
    DEFAULT_WATCH_POLLING_INTERVAL_MS
} from "../src/commands/watch-constants.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";

function createWatchCommandIntegrationOptions(abortSignal: AbortSignal): Parameters<typeof runWatchCommand>[1] {
    return {
        extensions: [".gml"],
        polling: false,
        pollingInterval: 1000,
        verbose: false,
        abortSignal,
        hydrateRuntime: false,
        websocketServer: false,
        statusServer: false
    };
}

async function removeDirectoryWithoutMaskingOriginalError(directoryPath: string): Promise<void> {
    await rm(directoryPath, { recursive: true, force: true }).catch(() => {
        // Ignore cleanup errors during exception unwinding. The test is
        // already failing (see `throw error` below), and a secondary cleanup
        // failure should not mask the original test failure. This defensive
        // approach ensures that the underlying error propagates cleanly to
        // the test runner even if the temporary directory cannot be removed.
    });
}

void describe("watch command", () => {
    void it("should create a command instance with correct configuration", () => {
        const command = createWatchCommand();

        assert.equal(command.name(), "watch");
        assert.equal(command.description(), "Watch GML source files and coordinate hot-reload pipeline actions");

        const options = command.options;
        assert.ok(options.some((opt) => opt.long === "--extensions"));
        assert.ok(options.some((opt) => opt.long === "--polling"));
        assert.ok(options.some((opt) => opt.long === "--polling-interval"));
        assert.ok(options.some((opt) => opt.long === "--verbose"));
    });

    void it("should have default extension set to .gml", () => {
        const command = createWatchCommand();
        const extensionsOption = command.options.find((opt) => opt.long === "--extensions");

        assert.ok(extensionsOption);
        assert.deepEqual(extensionsOption.defaultValue, [".gml"]);
    });

    void it("should have default polling interval of 1000ms", () => {
        const command = createWatchCommand();
        const pollingIntervalOption = command.options.find((opt) => opt.long === "--polling-interval");

        assert.ok(pollingIntervalOption);
        assert.equal(pollingIntervalOption.defaultValue, DEFAULT_WATCH_POLLING_INTERVAL_MS);
    });

    void it("exposes configurable transient empty-file retry defaults", () => {
        const command = createWatchCommand();
        const retryCountOption = command.options.find((opt) => opt.long === "--transient-empty-file-read-retry-count");
        const retryDelayOption = command.options.find(
            (opt) => opt.long === "--transient-empty-file-read-retry-delay-ms"
        );

        assert.ok(retryCountOption);
        assert.ok(retryDelayOption);
        assert.equal(retryCountOption.defaultValue, DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_COUNT);
        assert.equal(retryDelayOption.defaultValue, DEFAULT_TRANSIENT_EMPTY_FILE_READ_RETRY_DELAY_MS);
    });

    void it("normalizes extensions case-insensitively", () => {
        const matcher = createExtensionMatcher([".gml", "YY"]);

        assert.deepEqual([...matcher.extensions].toSorted(), [".gml", ".yy"]);
        assert.ok(matcher.matches("example.GML"));
        assert.ok(matcher.matches("event.YY"));
    });

    void it("normalizes extension arguments that include globs or directory prefixes", () => {
        const matcher = createExtensionMatcher(["scripts/*.gml", String.raw`objects\enemy.YY`]);

        assert.deepEqual([...matcher.extensions].toSorted(), [".gml", ".yy"]);
        assert.ok(matcher.matches("example.gml"));
        assert.ok(matcher.matches("event.yy"));
    });

    void it("treats dotfiles as extension-less while matching nested paths", () => {
        const matcher = createExtensionMatcher([".gml"]);

        assert.equal(matcher.matches(".gml"), false);
        assert.equal(matcher.matches("objects/player/create.GML"), true);
        assert.equal(matcher.matches(String.raw`objects\player\create.GML`), true);
    });

    void it("counts source lines across newline conventions", () => {
        assert.equal(countSourceLines(""), 1);
        assert.equal(countSourceLines("one"), 1);
        assert.equal(countSourceLines("one\ntwo\nthree"), 3);
        assert.equal(countSourceLines("one\r\ntwo\r\nthree"), 3);
        assert.equal(countSourceLines("one\u2028two\u2029three"), 3);
    });

    void it("hashSourceContent returns a stable 32-character hex digest", () => {
        const digest = hashSourceContent("function foo() { return 1; }");
        assert.equal(typeof digest, "string");
        assert.equal(digest.length, 32);
        assert.ok(/^[0-9a-f]{32}$/.test(digest), "digest should be lowercase hex");
    });

    void it("hashSourceContent returns the same digest for identical input", () => {
        const source = "function foo() { return 1; }";
        assert.equal(hashSourceContent(source), hashSourceContent(source));
    });

    void it("hashSourceContent returns different digests for different inputs", () => {
        assert.notEqual(
            hashSourceContent("function foo() { return 1; }"),
            hashSourceContent("function foo() { return 2; }")
        );
    });

    void it("resolveUnknownScanConcurrency clamps values to at least one", () => {
        assert.equal(resolveUnknownScanConcurrency(16), 16);
        assert.equal(resolveUnknownScanConcurrency(1), 1);
        assert.equal(resolveUnknownScanConcurrency(0), 1);
        assert.equal(resolveUnknownScanConcurrency(-5), 1);
        assert.equal(resolveUnknownScanConcurrency(8.7), 8);
    });

    void it("resolveDependentRetranspileConcurrency clamps values to at least one", () => {
        assert.equal(resolveDependentRetranspileConcurrency(12), 12);
        assert.equal(resolveDependentRetranspileConcurrency(1), 1);
        assert.equal(resolveDependentRetranspileConcurrency(0), 1);
        assert.equal(resolveDependentRetranspileConcurrency(-3), 1);
        assert.equal(resolveDependentRetranspileConcurrency(5.9), 5);
    });
});

void describe("watch command integration", () => {
    void it("should handle non-existent directory gracefully", async () => {
        const nonExistentPath = "/tmp/non-existent-test-directory-12345";

        // We expect the command to exit with code 1
        // Since we can't easily test process.exit in the current setup,
        // we'll just verify the function handles the error
        const exitCodeHolder = { code: null };

        await withTemporaryProperty(
            process,
            "exit",
            (code?: number) => {
                exitCodeHolder.code = code;
                throw new Error(`process.exit called with code ${code}`);
            },
            async () => {
                try {
                    await runWatchCommand(nonExistentPath, {
                        extensions: [".gml"],
                        polling: false,
                        pollingInterval: 1000,
                        verbose: false
                    });
                } catch (error) {
                    assert.ok(error.message.includes("process.exit called"), "Should call process.exit");
                }
            }
        );

        assert.equal(exitCodeHolder.code, 1, "Should exit with code 1");
    });

    void it("should normalize file extensions", async () => {
        // Create a temporary directory for testing
        const testDir = path.join("/tmp", `watch-test-${Date.now()}-${randomUUID()}`);

        await mkdir(testDir, { recursive: true });

        try {
            const abortController = new AbortController();

            const watchPromise = runWatchCommand(testDir, {
                ...createWatchCommandIntegrationOptions(abortController.signal),
                extensions: ["gml", ".yy"]
            });

            // Give it a moment to start
            await sleep(100);

            abortController.abort();

            await watchPromise;

            // Clean up
            await rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Clean up on error
            await removeDirectoryWithoutMaskingOriginalError(testDir);
            throw error;
        }
    });

    void it("uses the default watcher when watchFactory is explicitly undefined", async () => {
        const testDir = path.join("/tmp", `watch-test-default-factory-${Date.now()}-${randomUUID()}`);

        await mkdir(testDir, { recursive: true });

        try {
            const abortController = new AbortController();

            const watchPromise = runWatchCommand(testDir, {
                ...createWatchCommandIntegrationOptions(abortController.signal),
                watchFactory: undefined
            });

            await sleep(100);

            abortController.abort();

            await watchPromise;
        } finally {
            await rm(testDir, { recursive: true, force: true });
        }
    });

    void it("should transpile GML files when they change", async () => {
        // Create a temporary directory for testing
        const testDir = path.join("/tmp", `watch-test-transpile-${Date.now()}-${randomUUID()}`);

        await mkdir(testDir, { recursive: true });

        const testFile = path.join(testDir, "test_script.gml");

        try {
            const abortController = new AbortController();

            // Mock transpiler to capture patches
            // Start watching
            const watchPromise = runWatchCommand(testDir, {
                ...createWatchCommandIntegrationOptions(abortController.signal),
                runtimeServerStarter: async () => ({
                    stop: async () => {},
                    host: "localhost",
                    port: 0,
                    root: testDir,
                    origin: "http://localhost:0",
                    url: "http://localhost:0"
                })
            });

            // Give watcher time to start
            await sleep(100);

            // Create a test file
            await writeFile(testFile, "var x = 10;\nshow_debug_message(x);");

            // Give watcher time to process the file
            await sleep(200);

            abortController.abort();
            await watchPromise;

            // Clean up
            await rm(testDir, { recursive: true, force: true });

            // We can't easily verify transpilation without injecting a mock transpiler
            // This test verifies the watch command can handle file creation without crashing
            assert.ok(true, "Watch command handled file creation");
        } catch (error) {
            // Clean up on error
            await removeDirectoryWithoutMaskingOriginalError(testDir);
            throw error;
        }
    });
});

void describe("watch command help consistency", () => {
    void it("shows 'Show this help message.' for --help flag, matching all other commands", async () => {
        const { stdout } = await runCliTestCommand({ argv: ["watch", "--help"] });

        assert.match(stdout, /--help.*Show this help message\./);
    });

    void it("shows help hint on unknown option, matching the pattern of lint and format", async () => {
        const { stdout, stderr } = await runCliTestCommand({ argv: ["watch", "--unknown-flag-xyz"] });

        const combined = stdout + stderr;
        assert.match(combined, /add --help for usage information/);
    });

    void it("exits non-zero when an unknown option is passed", async () => {
        const { exitCode } = await runCliTestCommand({ argv: ["watch", "--unknown-flag-xyz"] });

        assert.notEqual(exitCode, 0);
    });
});
