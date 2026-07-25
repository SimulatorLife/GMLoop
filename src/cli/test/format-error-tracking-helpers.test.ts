/**
 * Unit tests for the single-responsibility helpers extracted from the
 * previous `reportAndTrackFormattingError` orchestrator. Each helper owns
 * one change-triggering responsibility (suppression decision, counter
 * tracking, stderr output, policy dispatch) so the orchestrator reads as a
 * linear sequence of named steps. These tests pin down the contract of
 * each helper individually rather than re-asserting the end-to-end CLI
 * behaviour (which is covered by `parse-error-formatting.test.ts` and
 * `prettier-wrapper.test.ts`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";

import { __formatTest__ } from "../src/commands/format.js";

const {
    shouldSuppressParseErrorTrackingForTests,
    recordFormattingErrorForTests,
    logFormattingErrorForTests,
    triggerFormattingRevertForTests,
    requestFormattingAbortForTests,
    applyFormattingErrorPolicyForTests,
    reportAndTrackFormattingErrorForTests,
    resetFormattingErrorTrackingForTests,
    setParseErrorActionForTests,
    getFormattingErrorTrackingForTests,
    configureConsoleMethodsForTests,
    addFormattedFileSnapshotForTests,
    clearFormattedFileSnapshotsForTests
} = __formatTest__;

interface FormattingErrorTracking {
    encounteredFormattingError: boolean;
    formattingErrorCount: number;
    abortRequested: boolean;
    revertTriggered: boolean;
    parseErrorAction: string;
}

function readState(): FormattingErrorTracking {
    return getFormattingErrorTrackingForTests();
}

function restoreConsole(): void {
    configureConsoleMethodsForTests("warn");
}

interface StderrCapture {
    text(): string;
    restore(): void;
}

/**
 * Replace `process.stderr.write` so tests can read what production code emits
 * via `console.error`. Mirrors the capture pattern used by
 * `format-console-diagnostic-filters.test.ts`.
 */
function captureStderr(): StderrCapture {
    const chunks: Array<string> = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    let restored = false;

    process.stderr.write = ((chunk: string | Uint8Array, ...rest: Array<unknown>) => {
        chunks.push(typeof chunk === "string" ? chunk : chunk.toString());
        return originalWrite(chunk, ...rest);
    }) as typeof process.stderr.write;

    return {
        text: () => chunks.join(""),
        restore: () => {
            if (restored) {
                return;
            }
            restored = true;
            process.stderr.write = originalWrite;
        }
    };
}

/**
 * Build a stub that quacks like a GameMaker syntax error so the suppression
 * helper can rely on `Core.isGmlParseError`. The parser tag is the only
 * structural detail the helper inspects.
 */
function buildParseErrorLike(message = "Syntax Error: unexpected end of file"): Error {
    const error = new Error(message);
    error.name = "GameMakerSyntaxError";
    return error;
}

function buildGenericError(message = "boom"): Error {
    return new Error(message);
}

void describe("shouldSuppressParseErrorTracking", () => {
    void it("returns true only when SKIP mode meets a parser error", () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("skip");
        configureConsoleMethodsForTests("silent");
        try {
            const parseError = buildParseErrorLike();
            assert.strictEqual(
                shouldSuppressParseErrorTrackingForTests(parseError),
                true,
                "SKIP mode should suppress parser errors so neither counters nor stderr fire"
            );

            const generic = buildGenericError("disk full");
            assert.strictEqual(
                shouldSuppressParseErrorTrackingForTests(generic),
                false,
                "Non-parse errors must remain tracked even in SKIP mode"
            );
        } finally {
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("returns false when the parse-error action is REVERT", () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("revert");
        configureConsoleMethodsForTests("silent");
        try {
            assert.strictEqual(
                shouldSuppressParseErrorTrackingForTests(buildParseErrorLike()),
                false,
                "REVERT mode treats parse errors as actionable and must track them"
            );
        } finally {
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("returns false when the parse-error action is ABORT", () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("abort");
        configureConsoleMethodsForTests("silent");
        try {
            assert.strictEqual(
                shouldSuppressParseErrorTrackingForTests(buildParseErrorLike()),
                false,
                "ABORT mode treats parse errors as actionable and must track them"
            );
        } finally {
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });
});

void describe("recordFormattingError", () => {
    void it("flips the encountered flag and increments the failure counter exactly once per call", () => {
        resetFormattingErrorTrackingForTests();
        try {
            assert.deepStrictEqual(readState(), {
                encounteredFormattingError: false,
                formattingErrorCount: 0,
                abortRequested: false,
                revertTriggered: false,
                parseErrorAction: "abort"
            });

            recordFormattingErrorForTests();
            assert.strictEqual(readState().encounteredFormattingError, true);
            assert.strictEqual(readState().formattingErrorCount, 1);

            recordFormattingErrorForTests();
            recordFormattingErrorForTests();
            assert.strictEqual(readState().encounteredFormattingError, true);
            assert.strictEqual(
                readState().formattingErrorCount,
                3,
                "Each call must contribute exactly one to the failure counter"
            );
        } finally {
            resetFormattingErrorTrackingForTests();
        }
    });
});

void describe("logFormattingError", () => {
    void it("writes the per-file header and an indented error block to stderr", () => {
        resetFormattingErrorTrackingForTests();
        configureConsoleMethodsForTests("silent");
        const capture = captureStderr();
        try {
            logFormattingErrorForTests(buildParseErrorLike("Syntax Error: x"), "scripts/foo.gml");
            const output = capture.text();
            assert.ok(output.includes("Failed to format scripts/foo.gml"), "Header should identify the failing file");
            assert.ok(output.includes("Syntax Error: x"), "Indented body must include the original error message");
        } finally {
            capture.restore();
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });
});

void describe("requestFormattingAbort", () => {
    void it("flips abortRequested without touching the other tracking fields", () => {
        resetFormattingErrorTrackingForTests();
        try {
            requestFormattingAbortForTests();
            const state = readState();
            assert.strictEqual(state.abortRequested, true);
            assert.strictEqual(state.revertTriggered, false, "ABORT mode must not silently trigger revert bookkeeping");
            assert.strictEqual(state.formattingErrorCount, 0);
            assert.strictEqual(state.encounteredFormattingError, false);
        } finally {
            resetFormattingErrorTrackingForTests();
        }
    });
});

void describe("triggerFormattingRevert", () => {
    void it("is idempotent so multiple parse failures only rewind files once", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("revert");
        configureConsoleMethodsForTests("silent");
        clearFormattedFileSnapshotsForTests();
        // Pre-populate a snapshot so the revert pipeline has at least one entry
        // to iterate over without doing real disk I/O.
        addFormattedFileSnapshotForTests("scripts/alpha.gml", "var a=1;\n", null);
        try {
            await triggerFormattingRevertForTests();
            const afterFirst = readState();
            assert.strictEqual(afterFirst.revertTriggered, true);
            assert.strictEqual(
                afterFirst.abortRequested,
                true,
                "REVERT mode also requests an abort so the walker stops"
            );

            await triggerFormattingRevertForTests();
            await triggerFormattingRevertForTests();
            const afterLater = readState();
            assert.strictEqual(
                afterLater.revertTriggered,
                true,
                "Repeat invocations must remain a no-op once revert has fired"
            );
            assert.strictEqual(afterLater.abortRequested, true);
        } finally {
            clearFormattedFileSnapshotsForTests();
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });
});

void describe("applyFormattingErrorPolicy", () => {
    void it("dispatches REVERT mode to the revert pipeline", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("revert");
        configureConsoleMethodsForTests("silent");
        clearFormattedFileSnapshotsForTests();
        try {
            await applyFormattingErrorPolicyForTests();
            const state = readState();
            assert.strictEqual(state.revertTriggered, true);
            assert.strictEqual(state.abortRequested, true);
        } finally {
            clearFormattedFileSnapshotsForTests();
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("dispatches ABORT mode to the abort flag without firing revert", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("abort");
        configureConsoleMethodsForTests("silent");
        try {
            await applyFormattingErrorPolicyForTests();
            const state = readState();
            assert.strictEqual(state.abortRequested, true);
            assert.strictEqual(state.revertTriggered, false, "ABORT must not trigger revert — the run simply halts");
        } finally {
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("does nothing for SKIP mode because suppression happens earlier", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("skip");
        configureConsoleMethodsForTests("silent");
        try {
            await applyFormattingErrorPolicyForTests();
            const state = readState();
            assert.strictEqual(state.abortRequested, false);
            assert.strictEqual(state.revertTriggered, false);
        } finally {
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });
});

void describe("reportAndTrackFormattingError orchestrator", () => {
    void it("returns early in SKIP mode for parser errors without mutating counters or stderr", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("skip");
        configureConsoleMethodsForTests("silent");
        const capture = captureStderr();
        try {
            await reportAndTrackFormattingErrorForTests(buildParseErrorLike(), "scripts/skip.gml");
            const state = readState();
            assert.strictEqual(
                state.formattingErrorCount,
                0,
                "SKIP mode must not increment the failure counter for parser errors"
            );
            assert.strictEqual(state.encounteredFormattingError, false);
            assert.strictEqual(state.abortRequested, false);
            assert.strictEqual(state.revertTriggered, false);
            assert.strictEqual(capture.text(), "", "SKIP mode must remain silent for parser errors");
        } finally {
            capture.restore();
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("tracks generic errors even in SKIP mode because they are not parser errors", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("skip");
        configureConsoleMethodsForTests("silent");
        const capture = captureStderr();
        try {
            await reportAndTrackFormattingErrorForTests(buildGenericError("disk full"), "scripts/disk.gml");
            const state = readState();
            assert.strictEqual(state.formattingErrorCount, 1);
            assert.strictEqual(state.encounteredFormattingError, true);
            assert.ok(capture.text().includes("Failed to format scripts/disk.gml"));
        } finally {
            capture.restore();
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("tracks and applies the ABORT policy for parser errors", async () => {
        resetFormattingErrorTrackingForTests();
        setParseErrorActionForTests("abort");
        configureConsoleMethodsForTests("silent");
        const capture = captureStderr();
        try {
            await reportAndTrackFormattingErrorForTests(buildParseErrorLike(), "scripts/abort.gml");
            const state = readState();
            assert.strictEqual(state.formattingErrorCount, 1);
            assert.strictEqual(state.encounteredFormattingError, true);
            assert.strictEqual(state.abortRequested, true);
            assert.strictEqual(state.revertTriggered, false, "ABORT mode must not run the revert pipeline");
            assert.ok(capture.text().includes("Failed to format scripts/abort.gml"));
        } finally {
            capture.restore();
            restoreConsole();
            resetFormattingErrorTrackingForTests();
        }
    });

    void it("verifies Core.isGmlParseError integrates with the suppression helper", () => {
        // Guard the contract that the suppression decision uses the same
        // detector the rest of the CLI relies on.
        assert.strictEqual(
            Core.isGmlParseError(buildParseErrorLike()),
            true,
            "Synthetic GameMakerSyntaxError instances must satisfy the parser-error predicate"
        );
        assert.strictEqual(
            Core.isGmlParseError(buildGenericError()),
            false,
            "Plain errors must not be classified as parser errors"
        );
    });
});
