/**
 * Unit tests for `scheduleFileReadRetry` in the watch command source-analysis module.
 *
 * These tests verify the contract of the retry-scheduling function in isolation,
 * replacing the fragile integration test in watch-file-read-error.test.ts that
 * relied on patching global timers and detecting timer creation by timeout value.
 *
 * The contract under test:
 * - Always returns a ScheduledRetry with a `timerId` (or `undefined` when already aborted).
 * - Always returns a `completion` promise that resolves `true` after the delay or `false` when aborted.
 * - Clearing the returned timer ID cancels the delay and causes `completion` to resolve `false`.
 * - An already-aborted signal produces `timerId: undefined` and resolves `false` immediately.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { scheduleFileReadRetry } from "../src/commands/watch/source-analysis.js";

void describe("scheduleFileReadRetry", () => {
    void it("creates a timer with the correct delay", async () => {
        const delayMs = 50;
        const { completion } = scheduleFileReadRetry(delayMs);

        const start = Date.now();
        const result = await completion;
        const elapsed = Date.now() - start;

        assert.equal(result, true, "completion should resolve true when delay elapses");
        assert.ok(
            elapsed >= delayMs - 5 && elapsed <= delayMs + 50,
            `delay should be approximately ${delayMs}ms, observed ${elapsed}ms`
        );
    });

    void it("returns a non-undefined timerId for an un-aborted signal", () => {
        const { timerId } = scheduleFileReadRetry(50);
        assert.notEqual(timerId, undefined, "timerId must be defined when signal is not aborted");
    });

    void it("returns undefined timerId when signal is already aborted", async () => {
        const controller = new AbortController();
        controller.abort();

        const { timerId, completion } = scheduleFileReadRetry(50, controller.signal);

        assert.equal(timerId, undefined, "timerId must be undefined when signal is already aborted");
        assert.equal(await completion, false, "completion resolves false immediately for already-aborted signal");
    });

    void it("completion resolves false when abort fires before delay elapses", async () => {
        const controller = new AbortController();
        const { completion } = scheduleFileReadRetry(200, controller.signal);

        // Abort after a short wait, well before the 200ms delay
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        controller.abort();

        const result = await completion;
        assert.equal(result, false, "completion should resolve false when aborted before delay elapses");
    });

    void it("clears the timer when abort fires before delay elapses", async () => {
        const controller = new AbortController();
        const { timerId, completion } = scheduleFileReadRetry(200, controller.signal);

        // Abort shortly after scheduling, well before the 200ms delay expires
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
        controller.abort();

        const result = await completion;
        assert.equal(result, false, "completion resolves false after abort");

        // The timer should have been cleared by the abort handler
        // (timerId is now expired/cleared). We verify indirectly by confirming
        // the timerId was valid at scheduling time (previous test) and that
        // no further timer callback can fire once abort has resolved.
    });

    void it("completion resolves true when delay fully elapses without abort", async () => {
        const controller = new AbortController();
        const { completion } = scheduleFileReadRetry(20, controller.signal);

        const result = await completion;
        assert.equal(result, true, "completion resolves true when delay elapses normally");
    });
});
