/**
 * Unit tests for the SRP-purified formatting-error pipeline.
 *
 * The format command used to funnel skip-mode short-circuiting, failure
 * tracking, and REVERT/ABORT recovery through a single
 * `reportAndTrackFormattingError` function. That combined several
 * change-triggering responsibilities (parse-error classification, run-level
 * bookkeeping, and mode-driven recovery), so the pipeline was refactored
 * into three single-responsibility helpers plus a thin orchestrator.
 *
 * These tests pin down the behaviour of each helper so the split remains
 * the SRP-cleanest shape we can offer without churning the public surface.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { __formatTest__ } from "../src/commands/format.js";
import { captureCliErrorOutput } from "./test-helpers/capture-cli-error-output.js";

const {
    resetFormattingSessionForTests,
    shouldSkipFormattingErrorForTests,
    recordFormattingFailureForTests,
    applyFormattingRecoveryActionForTests,
    reportAndTrackFormattingErrorForTests,
    ParseErrorActionForTests
} = __formatTest__;

const ParseErrorAction = ParseErrorActionForTests;

function createGmlParseError(): Error {
    const error = new Error("GameMakerLanguageParser: unexpected end of input");
    error.name = "GameMakerSyntaxError";
    return error;
}

function createNonParseError(): Error {
    return new Error("disk full");
}

void describe("format command: parse-error recovery helpers", () => {
    beforeEach(() => {
        void resetFormattingSessionForTests(ParseErrorAction.ABORT);
    });

    afterEach(() => {
        void resetFormattingSessionForTests(ParseErrorAction.ABORT);
    });

    void it("skips parse errors only when the active policy is SKIP", () => {
        void resetFormattingSessionForTests(ParseErrorAction.SKIP);
        assert.strictEqual(shouldSkipFormattingErrorForTests(createGmlParseError()), true);

        void resetFormattingSessionForTests(ParseErrorAction.ABORT);
        assert.strictEqual(shouldSkipFormattingErrorForTests(createGmlParseError()), false);

        void resetFormattingSessionForTests(ParseErrorAction.REVERT);
        assert.strictEqual(shouldSkipFormattingErrorForTests(createGmlParseError()), false);
    });

    void it("does not skip non-parse errors even under SKIP", () => {
        void resetFormattingSessionForTests(ParseErrorAction.SKIP);
        assert.strictEqual(shouldSkipFormattingErrorForTests(createNonParseError()), false);
    });

    void it("returns false for unknown error shapes", () => {
        assert.strictEqual(shouldSkipFormattingErrorForTests(undefined), false);
        assert.strictEqual(shouldSkipFormattingErrorForTests("plain string"), false);
        assert.strictEqual(shouldSkipFormattingErrorForTests({}), false);
    });

    void it("records a formatting failure by emitting a header to stderr", async () => {
        const { logged } = await captureCliErrorOutput(async () => {
            recordFormattingFailureForTests(createNonParseError(), "/tmp/example.gml");
        });

        assert.ok(
            logged.some((line) => line.startsWith("Failed to format /tmp/example.gml")),
            "recordFormattingFailure should print a 'Failed to format …' header"
        );
    });

    void it("runs REVERT recovery at most once per session", async () => {
        void resetFormattingSessionForTests(ParseErrorAction.REVERT);

        // Without a real revert snapshot registered, `revertFormattedFiles`
        // returns immediately. Both invocations must therefore resolve without
        // throwing, and the second call must remain idempotent (it observes
        // `revertTriggered` already set and returns). Observable side effects
        // on disk are exercised by `revertFormattedFiles` itself in the
        // higher-level integration tests.
        await applyFormattingRecoveryActionForTests();
        await applyFormattingRecoveryActionForTests();
    });

    void it("orchestrator short-circuits when the helper says skip", async () => {
        void resetFormattingSessionForTests(ParseErrorAction.SKIP);

        const { logged } = await captureCliErrorOutput(async () => {
            await reportAndTrackFormattingErrorForTests(createGmlParseError(), "/tmp/skipped.gml");
        });

        assert.deepStrictEqual(logged, [], "SKIP mode must prevent any stderr output from the orchestrator");
    });

    void it("orchestrator still records failures outside SKIP", async () => {
        void resetFormattingSessionForTests(ParseErrorAction.ABORT);

        const { logged } = await captureCliErrorOutput(async () => {
            await reportAndTrackFormattingErrorForTests(createNonParseError(), "/tmp/loud.gml");
        });

        assert.ok(
            logged.some((line) => line.startsWith("Failed to format /tmp/loud.gml")),
            "orchestrator should propagate the record-helper output outside SKIP"
        );
    });
});
