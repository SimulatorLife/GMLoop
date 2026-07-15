import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDuration, resolveVerboseFlag, timeSync } from "../src/shared/timing/verbose-timing.js";

function createCollectingLogger() {
    const calls: unknown[][] = [];
    return {
        log: (...args: unknown[]) => {
            calls.push(args);
        },
        calls
    };
}

function withMockedDateNow<T>(mockNow: () => number, callback: () => T): T {
    const originalDateNow = Date.now;
    try {
        Date.now = mockNow;
        return callback();
    } finally {
        Date.now = originalDateNow;
    }
}

void describe("time-utils", () => {
    void describe("formatDuration", () => {
        void it("returns millisecond precision for sub-second durations", () => {
            const result = withMockedDateNow(
                () => 200,
                () => formatDuration(0)
            );
            assert.equal(result, "200ms");
        });

        void it("returns seconds with a decimal when duration exceeds a second", () => {
            const result = withMockedDateNow(
                () => 1500,
                () => formatDuration(0)
            );
            assert.equal(result, "1.5s");
        });

        void it("rounds noisy millisecond values near one second up to seconds", () => {
            const result = withMockedDateNow(
                () => 999.999_999_999_7,
                () => formatDuration(0)
            );
            assert.equal(result, "1.0s");
        });
    });

    void it("logs progress when verbose parsing is enabled", () => {
        const timeline = [1000, 1300];
        const logger = createCollectingLogger();

        const value = withMockedDateNow(
            () => timeline.shift() ?? 1300,
            () =>
                timeSync("sample task", () => 42, {
                    verbose: { parsing: true },
                    logger
                })
        );

        assert.equal(value, 42);
        assert.deepEqual(
            logger.calls.map(([message]) => message),
            ["→ sample task", "  sample task completed in 300ms."]
        );
    });

    void it("skips logging when verbose parsing is disabled", () => {
        const logger = createCollectingLogger();
        const result = timeSync("quiet task", () => "done", {
            verbose: { parsing: false },
            logger
        });

        assert.equal(result, "done");
        assert.equal(logger.calls.length, 0);
    });

    void describe("resolveVerboseFlag", () => {
        void it("enables parsing when quiet is false", () => {
            assert.deepEqual(resolveVerboseFlag({ quiet: false }), { parsing: true });
        });

        void it("disables parsing when quiet is true", () => {
            assert.deepEqual(resolveVerboseFlag({ quiet: true }), { parsing: false });
        });

        void it("defaults to enabled parsing when no options are provided", () => {
            assert.deepEqual(resolveVerboseFlag(), { parsing: true });
        });

        void it("feeds the verbose flag straight into timeSync", () => {
            const logger = createCollectingLogger();
            const result = timeSync("quiet-resolved task", () => "ok", {
                verbose: resolveVerboseFlag({ quiet: true }),
                logger
            });

            assert.equal(result, "ok");
            assert.equal(logger.calls.length, 0);
        });
    });
});
