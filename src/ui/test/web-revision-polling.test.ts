import assert from "node:assert/strict";
import test from "node:test";

import { startServerUiRevisionPolling, stopServerUiRevisionPolling } from "../src/web/index.js";

// After each test, stop any polling timer that was started.
// Using test.afterEach ensures deterministic teardown regardless of
// test execution order, eliminating cross-test timer pollution that
// could cause a dangling setInterval to outlive its test.
test.afterEach(() => {
    stopServerUiRevisionPolling();
});

void test("startServerUiRevisionPolling stores the poll timer on globalThis", () => {
    startServerUiRevisionPolling(true);

    // The function stores the timer on globalThis via a well-known Symbol key.
    // Read it back via Symbol.for so we match the production lookup path.
    const timerKey = Symbol.for("gmloop.ui.pollTimer");
    const storedTimer = (globalThis as unknown as Record<symbol, unknown>)[timerKey];
    assert.notEqual(storedTimer, undefined, "pollTimer should be set on globalThis");
});

void test("startServerUiRevisionPolling does not start polling when isServerMode is false", () => {
    startServerUiRevisionPolling(false);

    const timerKey = Symbol.for("gmloop.ui.pollTimer");
    const storedTimer = (globalThis as unknown as Record<symbol, unknown>)[timerKey];
    assert.equal(storedTimer, undefined, "no timer should be stored when isServerMode is false");
});

void test("poll timer can be cleanly cleared with stopServerUiRevisionPolling", () => {
    startServerUiRevisionPolling(true);

    const timerKey = Symbol.for("gmloop.ui.pollTimer");
    const storedTimer = (globalThis as unknown as Record<symbol, unknown>)[timerKey];
    assert.notEqual(storedTimer, undefined, "timer should be set before stop");

    stopServerUiRevisionPolling();

    const afterStop = (globalThis as unknown as Record<symbol, unknown>)[timerKey];
    assert.equal(afterStop, undefined, "timer should be removed after stop");
});
