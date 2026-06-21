import assert from "node:assert/strict";
import { test } from "node:test";

import { __formatTest__, isDiagnosticErrorMessage, isDiagnosticStdoutMessage } from "../src/commands/format.js";

const { configureConsoleMethodsForTests, getDefaultPrettierLogLevelForTests } = __formatTest__;

// ---------------------------------------------------------------------------
// isDiagnosticErrorMessage
// ---------------------------------------------------------------------------

void test("isDiagnosticErrorMessage returns false for empty input", () => {
    assert.strictEqual(isDiagnosticErrorMessage(""), false);
});

void test("isDiagnosticErrorMessage returns false for null/undefined", () => {
    assert.strictEqual(isDiagnosticErrorMessage(null), false);
    assert.strictEqual(isDiagnosticErrorMessage(undefined as unknown as string), false);
});

void test("isDiagnosticErrorMessage returns false for non-string values", () => {
    assert.strictEqual(isDiagnosticErrorMessage(123), false);
    assert.strictEqual(isDiagnosticErrorMessage({}), false);
});

void test("isDiagnosticErrorMessage returns true for [feather:diagnostic] prefix", () => {
    assert.strictEqual(isDiagnosticErrorMessage("[feather:diagnostic] something went wrong"), true);
});

void test("isDiagnosticErrorMessage returns true for [feather:debug] prefix", () => {
    assert.strictEqual(isDiagnosticErrorMessage("[feather:debug] internal trace info"), true);
});

void test("isDiagnosticErrorMessage returns true for [doc:debug] prefix", () => {
    assert.strictEqual(isDiagnosticErrorMessage("[doc:debug] doc comment processing"), true);
});

void test("isDiagnosticErrorMessage returns false for normal error messages", () => {
    assert.strictEqual(isDiagnosticErrorMessage("Error: something failed"), false);
    assert.strictEqual(isDiagnosticErrorMessage("TypeError: undefined is not a function"), false);
    assert.strictEqual(isDiagnosticErrorMessage("SomeOtherError"), false);
});

void test("isDiagnosticErrorMessage is case-sensitive", () => {
    assert.strictEqual(isDiagnosticErrorMessage("[FEATHER:diagnostic]"), false);
    assert.strictEqual(isDiagnosticErrorMessage("[Feather:diagnostic]"), false);
});

// ---------------------------------------------------------------------------
// isDiagnosticStdoutMessage
// ---------------------------------------------------------------------------

void test("isDiagnosticStdoutMessage returns false for empty input", () => {
    assert.strictEqual(isDiagnosticStdoutMessage(""), false);
});

void test("isDiagnosticStdoutMessage returns false for null/undefined", () => {
    assert.strictEqual(isDiagnosticStdoutMessage(null), false);
    assert.strictEqual(isDiagnosticStdoutMessage(undefined as unknown as string), false);
});

void test("isDiagnosticStdoutMessage returns false for non-string values", () => {
    assert.strictEqual(isDiagnosticStdoutMessage(123), false);
    assert.strictEqual(isDiagnosticStdoutMessage({}), false);
});

void test("isDiagnosticStdoutMessage returns true for functionName: pattern", () => {
    assert.strictEqual(
        isDiagnosticStdoutMessage("promoteLeadingDocCommentTextToDescription: filteredResult pre-promotion"),
        true
    );
    assert.strictEqual(isDiagnosticStdoutMessage("someFunction:"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("deep.nested.function.name:"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("a:"), true);
});

void test("isDiagnosticStdoutMessage returns false for messages starting with uppercase (not diagnostic)", () => {
    assert.strictEqual(isDiagnosticStdoutMessage("SomeFunction:"), false);
    assert.strictEqual(isDiagnosticStdoutMessage("PromoteLeading:"), false);
    assert.strictEqual(isDiagnosticStdoutMessage("Error: something"), false);
});

void test("isDiagnosticStdoutMessage returns true for known debug tag prefixes", () => {
    assert.strictEqual(isDiagnosticStdoutMessage("[feather:diagnostic]"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("[feather:debug]"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("[doc:debug]"), true);
});

void test("isDiagnosticStdoutMessage returns false for normal user-facing output", () => {
    assert.strictEqual(isDiagnosticStdoutMessage("Formatted 5 files"), false);
    assert.strictEqual(isDiagnosticStdoutMessage("Checked src/script.gml"), false);
    assert.strictEqual(isDiagnosticStdoutMessage("Would format example.gml (12ms)"), false);
});

void test("isDiagnosticStdoutMessage handles mixed case after lowercase start", () => {
    assert.strictEqual(isDiagnosticStdoutMessage("myFunction:"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("myFunction:SomeText"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("my-special-function:"), true);
    assert.strictEqual(isDiagnosticStdoutMessage("my_special_function:"), true);
});

// ---------------------------------------------------------------------------
// Silent-mode console wiring
//
// These tests exercise the real production console wrappers installed by
// `configureConsoleMethods("silent")` instead of re-implementing the wrapping
// logic in the test. This proves the actual contract: when the CLI requests
// silent log level, every console method dispatches through the correct
// diagnostic filter — and, just as importantly, restoring the previous log
// level puts the wrappers back to the originals.
// ---------------------------------------------------------------------------

const RESTORE_LOG_LEVEL = getDefaultPrettierLogLevelForTests();

void test("configureConsoleMethods('silent') suppresses function-name warnings via console.warn", (t) => {
    const originalWarn = console.warn;
    const originalLog = console.log;

    t.after(() => {
        configureConsoleMethodsForTests(RESTORE_LOG_LEVEL);
        assert.strictEqual(console.warn, originalWarn, "console.warn should be restored to original");
        assert.strictEqual(console.log, originalLog, "console.log should be restored to original");
    });

    configureConsoleMethodsForTests("silent");

    // Spy on stderr/stdout so we can observe exactly what the production
    // wrappers choose to forward to the underlying console. This avoids
    // re-implementing the wrapper logic in the test.
    const capture = startConsoleOutputCapture();

    try {
        console.warn("someInternalFunction: pre-promotion snapshot");
        console.warn("Warning: real user-facing message");
    } finally {
        capture.restore();
    }

    const stderr = capture.stderrText();
    assert.ok(
        !stderr.includes("someInternalFunction: pre-promotion snapshot"),
        `expected the function-name warning to be suppressed, but stderr got: ${stderr}`
    );
    assert.ok(
        stderr.includes("Warning: real user-facing message"),
        `expected the user-facing warning to be forwarded, but stderr got: ${stderr}`
    );
});

void test("configureConsoleMethods('silent') suppresses bracket-tag messages via console.log", (t) => {
    const originalWarn = console.warn;
    const originalLog = console.log;

    t.after(() => {
        configureConsoleMethodsForTests(RESTORE_LOG_LEVEL);
        assert.strictEqual(console.warn, originalWarn, "console.warn should be restored to original");
        assert.strictEqual(console.log, originalLog, "console.log should be restored to original");
    });

    configureConsoleMethodsForTests("silent");

    const capture = startConsoleOutputCapture();

    try {
        console.log("[feather:diagnostic] internal info");
        console.log("Formatted 5 files");
    } finally {
        capture.restore();
    }

    const stdout = capture.stdoutText();
    assert.ok(
        !stdout.includes("[feather:diagnostic]"),
        `expected the bracket-tag message to be suppressed, but stdout got: ${stdout}`
    );
    assert.ok(
        stdout.includes("Formatted 5 files"),
        `expected the regular log message to be forwarded, but stdout got: ${stdout}`
    );
});

void test("configureConsoleMethods('silent') assigns the asymmetric filter pairing the contract requires", (t) => {
    const originalWarn = console.warn;
    const originalLog = console.log;

    t.after(() => {
        configureConsoleMethodsForTests(RESTORE_LOG_LEVEL);
        assert.strictEqual(console.warn, originalWarn, "console.warn should be restored to original");
        assert.strictEqual(console.log, originalLog, "console.log should be restored to original");
    });

    configureConsoleMethodsForTests("silent");

    const capture = startConsoleOutputCapture();

    try {
        console.warn("someInternalFunction: hello from warn");
        console.log("someInternalFunction: hello from log");
    } finally {
        capture.restore();
    }

    // The same diagnostic input (a function-name message) is intentionally
    // routed to two different console channels by callers in the wild. The
    // contract: only console.warn filters function-name diagnostics; console
    // .log must forward them untouched.
    const stderr = capture.stderrText();
    const stdout = capture.stdoutText();
    assert.ok(
        !stderr.includes("someInternalFunction: hello from warn"),
        `console.warn must filter function-name diagnostics, but stderr got: ${stderr}`
    );
    assert.ok(
        stdout.includes("someInternalFunction: hello from log"),
        `console.log must forward function-name diagnostics untouched, but stdout got: ${stdout}`
    );
});

void test("configureConsoleMethods with non-silent level restores the original console methods", (t) => {
    const originalWarn = console.warn;
    const originalLog = console.log;

    t.after(() => {
        configureConsoleMethodsForTests(RESTORE_LOG_LEVEL);
    });

    configureConsoleMethodsForTests("silent");
    assert.notStrictEqual(console.warn, originalWarn, "silent mode must install a filtered wrapper");

    configureConsoleMethodsForTests(RESTORE_LOG_LEVEL);
    assert.strictEqual(console.warn, originalWarn, "non-silent level must restore the original console.warn");
    assert.strictEqual(console.log, originalLog, "non-silent level must restore the original console.log");
});

interface ConsoleOutputCapture {
    stdoutText(): string;
    stderrText(): string;
    restore(): void;
}

/**
 * Replace the underlying stdout/stderr writers so the test can observe what
 * `console.warn` and `console.log` actually emit after production installs its
 * silent-mode wrappers. The handle's `restore()` puts the writers back; the
 * buffered chunks remain available via {@link ConsoleOutputCapture.stdoutText}
 * and {@link ConsoleOutputCapture.stderrText}.
 */
function startConsoleOutputCapture(): ConsoleOutputCapture {
    const stdoutChunks: Array<string> = [];
    const stderrChunks: Array<string> = [];

    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.stdout.write = ((chunk: string | Uint8Array, ...rest: Array<unknown>) => {
        stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return originalStdoutWrite(chunk, ...rest);
    }) as typeof process.stdout.write;

    process.stderr.write = ((chunk: string | Uint8Array, ...rest: Array<unknown>) => {
        stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return originalStderrWrite(chunk, ...rest);
    }) as typeof process.stderr.write;

    let restored = false;
    return {
        stdoutText: () => stdoutChunks.join(""),
        stderrText: () => stderrChunks.join(""),
        restore: () => {
            if (restored) {
                return;
            }
            restored = true;
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    };
}
