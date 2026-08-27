import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    type ConsoleOutput,
    createChangeEventLogger,
    createLogger,
    type LogLevel,
    LogLevels,
    parseLogLevel
} from "../src/browser/runtime/logger.js";
import type { Patch, RegistryChangeEvent } from "../src/browser/runtime/types.js";

/**
 * Captured log entry produced by a {@link MockConsoleOutput}.
 */
interface MockLogEntry {
    level: string;
    args: Array<unknown>;
}

/**
 * Minimal console stub that records every call for assertion in tests.
 *
 * Satisfies {@link ConsoleOutput} — the narrow interface the logger actually
 * uses — without implementing the full Node.js `Console` API.  This keeps
 * the setup from breaking whenever the global `Console` type gains new
 * required members.
 */
interface MockConsoleOutput extends ConsoleOutput {
    readonly logs: Array<MockLogEntry>;
    /** Discard all previously captured entries. */
    clear(): void;
}

function createMockConsole(): MockConsoleOutput {
    const logs: Array<MockLogEntry> = [];
    return {
        logs,
        log(...args: Array<unknown>): void {
            logs.push({ level: "log", args });
        },
        error(...args: Array<unknown>): void {
            logs.push({ level: "error", args });
        },
        warn(...args: Array<unknown>): void {
            logs.push({ level: "warn", args });
        },
        debug(...args: Array<unknown>): void {
            logs.push({ level: "debug", args });
        },
        clear(): void {
            logs.length = 0;
        }
    };
}

/**
 * Helper for asserting that a logger call routed the message to the expected
 * console level while carrying the relevant data. We assert on observable
 * data (patch id, version number, error text, URL, attempt count, etc.)
 * rather than on the exact wording of the message — the contract is that the
 * caller-supplied information reaches the console, not the prose around it.
 */
function assertLogEntry(
    mockConsole: MockConsoleOutput,
    index: number,
    expected: { level: string; includes: Array<string> }
): void {
    assert.ok(index < mockConsole.logs.length, `expected at least ${index + 1} log entries`);
    const entry = mockConsole.logs[index];
    assert.equal(entry.level, expected.level, `entry ${index} should route to ${expected.level}`);
    const message = entry.args[0] as string;
    for (const fragment of expected.includes) {
        assert.ok(
            message.includes(fragment),
            `entry ${index} message ${JSON.stringify(message)} should include ${JSON.stringify(fragment)}`
        );
    }
}

void describe("Logger", () => {
    void it("should create logger with default options", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole });

        assert.equal(logger.getLevel(), "error");
    });

    void it("should create logger with custom level", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "debug" });

        assert.equal(logger.getLevel(), "debug");
    });

    void it("should reject invalid log level strings", () => {
        const mockConsole = createMockConsole();
        const invalidLevel = "verbose" as LogLevel;

        assert.equal(parseLogLevel(LogLevels.info), LogLevels.info);
        // Contract: invalid level must throw an Error whose message identifies
        // the failure as an invalid log level so operators can grep for it.
        assert.throws(() => createLogger({ console: mockConsole, level: invalidLevel }), /Invalid log level/);
    });

    void it("should respect log levels", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "warn" });

        logger.debug("debug message");
        logger.info("info message");
        logger.warn("warn message");
        logger.error("error message");

        // Only warn and error should be logged
        assert.equal(mockConsole.logs.length, 2);
        assert.equal(mockConsole.logs[0].level, "warn");
        assert.equal(mockConsole.logs[1].level, "error");
    });

    void it("should log nothing when level is silent", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "silent" });

        logger.debug("debug");
        logger.info("info");
        logger.warn("warn");
        logger.error("error");

        assert.equal(mockConsole.logs.length, 0);
    });

    void it("should allow changing log level", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "error" });

        logger.info("before");
        assert.equal(mockConsole.logs.length, 0);

        logger.setLevel("info");
        logger.info("after");
        assert.equal(mockConsole.logs.length, 1);
    });

    void it("should route patchApplied to the info level and include patch id and version", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });

        const patch: Patch = { kind: "script", id: "script:test", js_body: "return 42;" };
        logger.patchApplied(patch, 5);

        assertLogEntry(mockConsole, 0, {
            level: "log",
            includes: [patch.id, String(5)]
        });
        // The version is rendered with a `v` prefix so logs stay greppable and
        // visually unambiguous against arbitrary digits elsewhere in the line.
        assert.match(mockConsole.logs[0].args[0] as string, /v5/);
    });

    void it("should include duration when provided", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });

        const patch: Patch = { kind: "script", id: "script:test", js_body: "return 42;" };
        const durationMs = 123.456;
        logger.patchApplied(patch, 5, durationMs);

        // Contract: the duration must reach the operator. Asserting on the
        // rounded numeric value (123) avoids coupling to "ms"/"s"/"<1ms" wording
        // which is covered by the dedicated formatter test below.
        const message = mockConsole.logs[0].args[0] as string;
        assert.ok(
            message.includes(String(Math.round(durationMs))),
            `message ${JSON.stringify(message)} should include rounded duration ${Math.round(durationMs)}`
        );
    });

    void it("should route patchUndone to the info level and include patch id and version", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });

        logger.patchUndone("script:test", 4);

        assertLogEntry(mockConsole, 0, {
            level: "log",
            includes: ["script:test", String(4)]
        });
        // Both the "Undone" action label and the `v`-prefixed version are part
        // of the public log contract, not just internal formatting.
        const message = mockConsole.logs[0].args[0] as string;
        assert.match(message, /Undone/);
        assert.match(message, /v4/);
    });

    void it("should route patchRolledBack to the error level and include patch id, version, and error", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "error", styled: false });

        const patch: Patch = { kind: "script", id: "script:test", js_body: "bad" };
        logger.patchRolledBack(patch, 3, "Syntax error");

        assertLogEntry(mockConsole, 0, {
            level: "error",
            includes: [patch.id, String(3), "Syntax error"]
        });
        // The "Rollback" action label is part of the public log contract so
        // operators can grep for rollback events.
        assert.match(mockConsole.logs[0].args[0] as string, /Rollback/);
    });

    void it("should route registryCleared to the info level and include the version", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });

        logger.registryCleared(10);

        assertLogEntry(mockConsole, 0, {
            level: "log",
            includes: [String(10)]
        });
        // The "cleared" label and `v`-prefixed version are part of the public
        // log contract, not just internal formatting.
        const message = mockConsole.logs[0].args[0] as string;
        assert.match(message, /cleared/);
        assert.match(message, /v10/);
    });

    void it("should route validationError to the error level and include patch id and error", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "error", styled: false });

        logger.validationError("script:bad", "Missing js_body");

        assertLogEntry(mockConsole, 0, {
            level: "error",
            includes: ["script:bad", "Missing js_body"]
        });
        // The "Validation failed" label is part of the public log contract so
        // operators can identify validation failures in the log stream.
        assert.match(mockConsole.logs[0].args[0] as string, /Validation failed/);
    });

    void it("should route shadowValidationFailed to the warn level and include patch id and error", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "warn", styled: false });

        logger.shadowValidationFailed("script:test", "Cannot create function");

        assertLogEntry(mockConsole, 0, {
            level: "warn",
            includes: ["script:test", "Cannot create function"]
        });
        // The "Shadow validation failed" label is part of the public log
        // contract so operators can distinguish shadow from primary failures.
        assert.match(mockConsole.logs[0].args[0] as string, /Shadow validation failed/);
    });

    void it("should route WebSocket lifecycle events and forward connection metadata", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });

        logger.websocketConnected("ws://localhost:17890");
        logger.websocketReconnecting(2, 1000);
        logger.websocketDisconnected("Connection closed");
        logger.websocketError("Network error");

        assert.equal(mockConsole.logs.length, 4);
        assertLogEntry(mockConsole, 0, { level: "log", includes: ["ws://localhost:17890"] });
        assertLogEntry(mockConsole, 1, { level: "log", includes: [String(2)] });
        assertLogEntry(mockConsole, 2, { level: "log", includes: ["Connection closed"] });
        assertLogEntry(mockConsole, 3, { level: "error", includes: ["Network error"] });
        // The "Connected" / "Reconnecting" / "Disconnected" lifecycle labels
        // are part of the public log contract, not just internal formatting.
        assert.match(mockConsole.logs[0].args[0] as string, /Connected/);
        assert.match(mockConsole.logs[1].args[0] as string, /Reconnecting/);
        assert.match(mockConsole.logs[2].args[0] as string, /Disconnected/);
    });

    void it("should route patch queue operations and forward patch id, queue depth, and flush count", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "debug", styled: false });

        logger.patchQueued("script:test", 5);
        logger.patchQueueFlushed(5, 10.5);

        assert.equal(mockConsole.logs.length, 2);
        assertLogEntry(mockConsole, 0, { level: "debug", includes: ["script:test", String(5)] });
        assertLogEntry(mockConsole, 1, { level: "debug", includes: [String(5)] });
        // The "Queued" / "Flushed" action labels and the "depth: N" /
        // "N patches" formatting are part of the public log contract.
        assert.match(mockConsole.logs[0].args[0] as string, /Queued/);
        assert.match(mockConsole.logs[0].args[0] as string, /depth: 5/);
        assert.match(mockConsole.logs[1].args[0] as string, /Flushed/);
        assert.match(mockConsole.logs[1].args[0] as string, /5 patches/);
    });

    void it("should include prefix in messages", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({
            console: mockConsole,
            level: "info",
            prefix: "[test-prefix]",
            styled: false
        });

        logger.info("test message");

        assert.equal(mockConsole.logs.length, 1);
        const message = mockConsole.logs[0].args[0] as string;
        assert.ok(message.includes("[test-prefix]"), `expected prefix in: "${message}"`);
    });

    void it("should include timestamps when enabled", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({
            console: mockConsole,
            level: "info",
            timestamps: true,
            styled: false
        });

        logger.info("test message");

        assert.equal(mockConsole.logs.length, 1);
        const message = mockConsole.logs[0].args[0] as string;
        // Timestamp format (HH:MM:SS.mmm) is part of the public contract.
        assert.match(message, /\d{2}:\d{2}:\d{2}\.\d{3}/);
    });

    void it("should format durations correctly", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });

        const patch: Patch = { kind: "script", id: "script:test", js_body: "return 42;" };

        // Less than 1ms
        logger.patchApplied(patch, 1, 0.5);
        assert.ok(
            (mockConsole.logs[0].args[0] as string).includes("<1ms"),
            "sub-millisecond durations should render as <1ms"
        );

        mockConsole.clear();

        // Milliseconds
        logger.patchApplied(patch, 2, 123);
        assert.ok(
            (mockConsole.logs[0].args[0] as string).includes("123ms"),
            "millisecond durations should render as Nms"
        );

        mockConsole.clear();

        // Seconds
        logger.patchApplied(patch, 3, 1500);
        assert.ok((mockConsole.logs[0].args[0] as string).includes("1.50s"), "second durations should render as N.NNs");
    });

    void it("should support custom console implementation", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info" });

        logger.info("test");

        assert.equal(mockConsole.logs.length, 1);
    });

    void it("styled output includes the operation emoji; unstyled output omits it", () => {
        const styledConsole = createMockConsole();
        const unstyledConsole = createMockConsole();
        const styledLogger = createLogger({ console: styledConsole, level: "info", styled: true });
        const unstyledLogger = createLogger({ console: unstyledConsole, level: "info", styled: false });

        const patch: Patch = { kind: "script", id: "script:test", js_body: "return 42;" };

        styledLogger.patchApplied(patch, 1);
        const styledMessage = styledConsole.logs[0].args[0] as string;

        unstyledLogger.patchApplied(patch, 1);
        const unstyledMessage = unstyledConsole.logs[0].args[0] as string;

        // Styled output must contain the success emoji for patch-applied.
        assert.ok(styledMessage.includes("✅"), `expected ✅ in styled message: "${styledMessage}"`);
        // Unstyled output must not contain that emoji.
        assert.ok(!unstyledMessage.includes("✅"), `unexpected ✅ in unstyled message: "${unstyledMessage}"`);
        // Both messages still contain the patch id and version.
        assert.ok(styledMessage.includes(patch.id));
        assert.ok(unstyledMessage.includes(patch.id));
    });
});

void describe("createChangeEventLogger", () => {
    void it("should route patch-applied events to the info level and forward patch id and version", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });
        const eventLogger = createChangeEventLogger(logger);

        const event: RegistryChangeEvent = {
            type: "patch-applied",
            patch: { kind: "script", id: "script:test", js_body: "return 42;" },
            version: 5
        };

        eventLogger(event);

        assertLogEntry(mockConsole, 0, {
            level: "log",
            includes: ["script:test", String(5)]
        });
        // The `v`-prefixed version is part of the public log contract.
        assert.match(mockConsole.logs[0].args[0] as string, /v5/);
    });

    void it("should route patch-undone events to the info level and forward the patch id", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });
        const eventLogger = createChangeEventLogger(logger);

        const event: RegistryChangeEvent = {
            type: "patch-undone",
            patch: { kind: "script", id: "script:test" },
            version: 4
        };

        eventLogger(event);

        assertLogEntry(mockConsole, 0, {
            level: "log",
            includes: ["script:test"]
        });
        // The "Undone" action label is part of the public log contract so
        // operators can grep for patch-undone events.
        assert.match(mockConsole.logs[0].args[0] as string, /Undone/);
    });

    void it("should route patch-rolled-back events to the error level", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "error", styled: false });
        const eventLogger = createChangeEventLogger(logger);

        const event: RegistryChangeEvent = {
            type: "patch-rolled-back",
            patch: { kind: "script", id: "script:test", js_body: "bad" },
            version: 3,
            error: "Syntax error"
        };

        eventLogger(event);

        assertLogEntry(mockConsole, 0, {
            level: "error",
            includes: ["script:test", "Syntax error"]
        });
    });

    void it("should route registry-cleared events to the info level and forward the version", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });
        const eventLogger = createChangeEventLogger(logger);

        const event: RegistryChangeEvent = {
            type: "registry-cleared",
            version: 0
        };

        eventLogger(event);

        assertLogEntry(mockConsole, 0, {
            level: "log",
            includes: [String(0)]
        });
        // The "cleared" label is part of the public log contract so operators
        // can identify registry-clear events in the log stream.
        assert.match(mockConsole.logs[0].args[0] as string, /cleared/);
    });

    void it("should integrate with runtime wrapper onChange hook", () => {
        const mockConsole = createMockConsole();
        const logger = createLogger({ console: mockConsole, level: "info", styled: false });
        const eventLogger = createChangeEventLogger(logger);

        // Simulate onChange events
        const events: Array<RegistryChangeEvent> = [
            {
                type: "patch-applied",
                patch: { kind: "script", id: "script:a", js_body: "return 1;" },
                version: 1
            },
            {
                type: "patch-applied",
                patch: { kind: "script", id: "script:b", js_body: "return 2;" },
                version: 2
            },
            {
                type: "patch-undone",
                patch: { kind: "script", id: "script:b" },
                version: 1
            },
            {
                type: "registry-cleared",
                version: 0
            }
        ];

        for (const event of events) {
            eventLogger(event);
        }

        assert.equal(mockConsole.logs.length, 4);
    });
});
