/**
 * Tests for the live-reload status command.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import { createLiveReloadCommand } from "../src/commands/live-reload.js";
import { runWatchStatusCommand } from "../src/commands/watch/status.js";
import { withTemporaryProperty } from "./test-helpers/temporary-property.js";

function createLiveReloadStatusCommand() {
    const command = createLiveReloadCommand();
    const statusCommand = command.commands.find((entry) => entry.name() === "status");
    assert.ok(statusCommand);
    return statusCommand;
}

void describe("live-reload status command", () => {
    void it("should create live-reload status command with correct options", () => {
        const command = createLiveReloadStatusCommand();

        assert.strictEqual(command.name(), "status");
        assert.ok(command.description().includes("status server"));
    });

    void it("should handle connection refused error gracefully", async () => {
        let errorThrown = false;

        const errorMessages: Array<string> = [];

        await withTemporaryProperty(
            console,
            "error",
            (...args: Array<unknown>) => {
                errorMessages.push(args.map(String).join(" "));
            },
            () =>
                withTemporaryProperty(
                    process,
                    "exit",
                    ((code?: number) => {
                        errorThrown = true;
                        throw new Error(`Process exit: ${code ?? 0}`);
                    }) as typeof process.exit,
                    async () => {
                        try {
                            await runWatchStatusCommand({
                                statusHost: "127.0.0.1",
                                statusPort: 54_321 // unlikely to be in use
                            });
                        } catch {
                            // Expected to throw when process.exit is called
                        }
                    }
                )
        );

        assert.ok(errorThrown, "Should have attempted to exit");
        assert.ok(
            errorMessages.some((msg) => msg.includes("Failed to connect")),
            "Should show connection error"
        );
        assert.ok(
            errorMessages.some((msg) => msg.includes("Is the live-reload dev command running?")),
            "Should suggest live-reload dev is not running"
        );
        assert.ok(
            errorMessages.some((msg) => msg.includes("pnpm run cli -- live-reload status --status-host")),
            "Should explain how to target a custom status host and port"
        );
    });

    void it("should accept format option", () => {
        const command = createLiveReloadStatusCommand();
        const formatOption = command.options.find((opt) => opt.long === "--format");

        assert.ok(formatOption, "Should have --format option");
        assert.deepStrictEqual(formatOption?.argChoices, ["pretty", "json"]);
    });

    void it("should accept endpoint option", () => {
        const command = createLiveReloadStatusCommand();
        const endpointOption = command.options.find((opt) => opt.long === "--endpoint");

        assert.ok(endpointOption, "Should have --endpoint option");
        assert.deepStrictEqual(endpointOption?.argChoices, ["status", "health", "ping", "ready"]);
    });

    void it("should have --status-port option matching live-reload dev naming", () => {
        const command = createLiveReloadStatusCommand();
        const portOption = command.options.find((opt) => opt.long === "--status-port");

        assert.ok(portOption, "Should have --status-port option (not --port) to match live-reload dev");
        assert.strictEqual(portOption?.envVar, "WATCH_STATUS_PORT");
    });

    void it("should have --status-host option matching live-reload dev naming", () => {
        const command = createLiveReloadStatusCommand();
        const hostOption = command.options.find((opt) => opt.long === "--status-host");

        assert.ok(hostOption, "Should have --status-host option (not --host) to match live-reload dev");
        assert.strictEqual(hostOption?.envVar, "WATCH_STATUS_HOST");
    });
});

void describe("live-reload status command help consistency", () => {
    void it("shows 'Show this help message.' for --help flag, matching all other commands", async () => {
        const { stdout } = await runCliTestCommand({ argv: ["live-reload", "status", "--help"] });

        assert.match(stdout, /--help.*Show this help message\./);
    });

    void it("shows help hint on unknown option, matching the pattern of lint and format", async () => {
        const { stdout, stderr } = await runCliTestCommand({ argv: ["live-reload", "status", "--unknown-flag-xyz"] });

        const combined = stdout + stderr;
        assert.match(combined, /add --help for usage information/);
    });

    void it("exits non-zero when an unknown option is passed", async () => {
        const { exitCode } = await runCliTestCommand({ argv: ["live-reload", "status", "--unknown-flag-xyz"] });

        assert.notEqual(exitCode, 0);
    });
});
