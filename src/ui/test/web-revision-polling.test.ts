import assert from "node:assert/strict";
import test from "node:test";

import { startServerUiRevisionPolling } from "../src/web/index.js";

const TIMER_KEY = Symbol.for("gmloop.ui.pollTimer");

void test("startServerUiRevisionPolling stores the poll timer on globalThis", () => {
    // Clear any leftover timer from previous test runs.
    const prevId = (globalThis as unknown as Record<symbol, unknown>)[TIMER_KEY];
    if (prevId !== undefined) {
        clearInterval(prevId as Parameters<typeof clearInterval>[0]);
        delete (globalThis as unknown as Record<symbol, unknown>)[TIMER_KEY];
    }

    startServerUiRevisionPolling(true);

    // The function should have stored the timer on globalThis via a Symbol key.
    // Node 22+ returns a Timeout object from setInterval; verify it's stored.
    const storedTimer = (globalThis as unknown as Record<symbol, unknown>)[TIMER_KEY];
    assert.notEqual(storedTimer, undefined, "pollTimer should be set on globalThis");
});

void test("startServerUiRevisionPolling does not start polling when isServerMode is false", () => {
    // Clear any previous timer from prior tests.
    const previousTimer = Object.getOwnPropertyDescriptor(globalThis, TIMER_KEY)?.value;
    if (previousTimer !== undefined) {
        clearInterval(previousTimer);
    }
    delete (globalThis as unknown as Record<symbol, unknown>)[TIMER_KEY];

    startServerUiRevisionPolling(false);

    const timerDescriptor = Object.getOwnPropertyDescriptor(globalThis, TIMER_KEY);
    assert.equal(timerDescriptor, undefined, "no timer should be stored when isServerMode is false");
});

void test("poll timer can be cleanly cleared with clearInterval", () => {
    startServerUiRevisionPolling(true);

    const timerId = Object.getOwnPropertyDescriptor(globalThis, TIMER_KEY)?.value as number | undefined;
    assert.notEqual(timerId, undefined, "timer should be set");

    clearInterval(timerId);

    // After clearing, the timer ID is no longer active (no assertion needed on
    // Node side since setInterval already ran at least once by this point).
    // Verify we can still delete the property without errors.
    delete (globalThis as unknown as Record<symbol, unknown>)[TIMER_KEY];
});
