import assert from "node:assert/strict";
import { test } from "node:test";

import { isDiagnosticErrorMessage, isDiagnosticStdoutMessage } from "../src/commands/format.js";

// ---------------------------------------------------------------------------
// isDiagnosticErrorMessage
// ---------------------------------------------------------------------------

void test("isDiagnosticErrorMessage returns false for empty input", () => {
    assert.strictEqual(isDiagnosticErrorMessage(""), false);
});

void test("isDiagnosticErrorMessage returns false for null/undefined", () => {
    assert.strictEqual(isDiagnosticErrorMessage(null as unknown as string), false);
    assert.strictEqual(isDiagnosticErrorMessage(undefined as unknown as string), false);
});

void test("isDiagnosticErrorMessage returns false for non-string values", () => {
    assert.strictEqual(isDiagnosticErrorMessage(123 as unknown as string), false);
    assert.strictEqual(isDiagnosticErrorMessage({} as unknown as string), false);
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
    assert.strictEqual(isDiagnosticStdoutMessage(null as unknown as string), false);
    assert.strictEqual(isDiagnosticStdoutMessage(undefined as unknown as string), false);
});

void test("isDiagnosticStdoutMessage returns false for non-string values", () => {
    assert.strictEqual(isDiagnosticStdoutMessage(123 as unknown as string), false);
    assert.strictEqual(isDiagnosticStdoutMessage({} as unknown as string), false);
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
// Verify filter assignment contract: in "silent" mode, console.warn should
// suppress stdout-style messages (functionName:) and console.log should
// suppress error-style messages ([feather:diagnostic]).
// ---------------------------------------------------------------------------

void test("in silent mode console.warn uses isDiagnosticStdoutMessage and suppresses functionName: messages", () => {
    const warnCalls: string[] = [];

    const originalWarn = console.warn;
    const originalLog = console.log;

    // Simulate silent mode by temporarily installing filters.
    const wrappedWarn: typeof console.warn = (...args) => {
        const firstArg = String(args[0]);
        if (!isDiagnosticStdoutMessage(firstArg)) {
            warnCalls.push(firstArg);
        }
    };
    console.warn = wrappedWarn;
    console.log = () => {};

    try {
        // A functionName: message should be suppressed by warn (stdout filter).
        console.warn("promoteLeadingDocCommentTextToDescription: filtered result");
        // A normal warning should NOT be suppressed.
        console.warn("Normal warning message");

        assert.deepStrictEqual(warnCalls, ["Normal warning message"]);
    } finally {
        console.warn = originalWarn;
        console.log = originalLog;
    }
});

void test("in silent mode console.log uses isDiagnosticErrorMessage and suppresses bracket-tag messages", () => {
    const logCalls: string[] = [];

    const originalLog = console.log;
    const originalWarn = console.warn;

    // Stub out warn - we only care about log for this test.
    console.warn = () => {};
    const wrappedLog: typeof console.log = (...args) => {
        const firstArg = String(args[0]);
        if (!isDiagnosticErrorMessage(firstArg)) {
            logCalls.push(firstArg);
        }
    };
    console.log = wrappedLog;

    try {
        // A functionName: message should NOT be suppressed by log (only warn filters it).
        console.log("someInternalFunction: processing");
        // An error-tag message should be suppressed by log (error filter).
        console.log("[feather:diagnostic] internal info");

        assert.deepStrictEqual(logCalls, ["someInternalFunction: processing"]);
    } finally {
        console.log = originalLog;
        console.warn = originalWarn;
    }
});
