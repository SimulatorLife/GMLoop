import assert from "node:assert/strict";
import test from "node:test";

import type { ReactiveControllerHost } from "lit";

import { LiveReloadPollingController } from "../src/app/components/live-reload-polling-controller.js";

const STATUS_URL = "http://127.0.0.1:55530/status";

function createTestHost(): ReactiveControllerHost {
    return {
        addController: () => {},
        removeController: () => {},
        requestUpdate: () => {},
        updateComplete: Promise.resolve(true)
    };
}

void test("live-reload status polling identifies an unreachable status server", async () => {
    const originalFetch = globalThis.fetch;
    const testFetch = async () => {
        throw new TypeError("Failed to fetch");
    };
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: testFetch,
        writable: true
    });

    try {
        let observedErrorMessage: string | null = null;
        let resolvePoll: (() => void) | null = null;
        const pollCompleted = new Promise<void>((resolve) => {
            resolvePoll = resolve;
        });
        const controller = new LiveReloadPollingController(createTestHost(), {
            onErrorMessageChange: (message) => {
                observedErrorMessage = message;
                resolvePoll?.();
            },
            onStatusChange: () => {},
            requestUpdate: () => {}
        });

        controller.restartPollingIfNeeded(STATUS_URL, 60_000);
        await pollCompleted;
        controller.stopPolling();

        assert.equal(
            observedErrorMessage,
            `Unable to reach the live-reload status server at ${STATUS_URL}. Check that the server is running and try again.`
        );
        assert.equal(controller.state.pollErrorMessage, observedErrorMessage);
    } finally {
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            value: originalFetch,
            writable: true
        });
    }
});

void test("live-reload status polling preserves HTTP errors from the status server", async () => {
    const originalFetch = globalThis.fetch;
    const testFetch = async () => new Response(null, { status: 503 });
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        value: testFetch,
        writable: true
    });

    try {
        let observedErrorMessage: string | null = null;
        let resolvePoll: (() => void) | null = null;
        const pollCompleted = new Promise<void>((resolve) => {
            resolvePoll = resolve;
        });
        const controller = new LiveReloadPollingController(createTestHost(), {
            onErrorMessageChange: (message) => {
                observedErrorMessage = message;
                resolvePoll?.();
            },
            onStatusChange: () => {},
            requestUpdate: () => {}
        });

        controller.restartPollingIfNeeded(STATUS_URL, 60_000);
        await pollCompleted;
        controller.stopPolling();

        assert.equal(observedErrorMessage, "Status request failed with HTTP 503");
    } finally {
        Object.defineProperty(globalThis, "fetch", {
            configurable: true,
            value: originalFetch,
            writable: true
        });
    }
});
