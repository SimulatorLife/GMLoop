import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createThrottledCounterLogger } from "../src/shared/throttled-counter-logger.js";

void describe("createThrottledCounterLogger", () => {
    void it("increments the counter on every tick without emitting during the throttle window", () => {
        const emitted: Array<string> = [];
        let currentTime = 1_000_000;
        const logger = createThrottledCounterLogger({
            intervalMs: 1000,
            formatMessage: (count) => `[format] Checking GML files... (${count} processed)`,
            sink: (message) => emitted.push(message),
            now: () => currentTime
        });

        // Emit on the first tick because the throttle window has not yet
        // closed (mirrors the original inline `now - lastLogTime > 1000`
        // behaviour with `lastLogTime` initialised to 0).
        assert.strictEqual(logger.tick(), 1);
        assert.deepStrictEqual(emitted, ["[format] Checking GML files... (1 processed)"]);

        currentTime += 100;
        assert.strictEqual(logger.tick(), 2);
        currentTime += 100;
        assert.strictEqual(logger.tick(), 3);

        // No further emits while still inside the throttle window.
        assert.deepStrictEqual(emitted, ["[format] Checking GML files... (1 processed)"]);
        assert.strictEqual(logger.getCount(), 3);
    });

    void it("emits a formatted line when the throttle window has elapsed", () => {
        const emitted: Array<string> = [];
        let currentTime = 1_000_000;
        const logger = createThrottledCounterLogger({
            intervalMs: 1000,
            formatMessage: (count) => `[format] Checking GML files... (${count} processed)`,
            sink: (message) => emitted.push(message),
            now: () => currentTime
        });

        assert.strictEqual(logger.tick(), 1);
        currentTime += 1500;
        assert.strictEqual(logger.tick(), 2);
        currentTime += 1500;
        assert.strictEqual(logger.tick(), 3);

        assert.deepStrictEqual(emitted, [
            "[format] Checking GML files... (1 processed)",
            "[format] Checking GML files... (2 processed)",
            "[format] Checking GML files... (3 processed)"
        ]);
        assert.strictEqual(logger.getCount(), 3);
    });

    void it("supports arbitrary positive deltas per tick", () => {
        const emitted: Array<string> = [];
        let currentTime = 1_000_000;
        const logger = createThrottledCounterLogger({
            intervalMs: 1000,
            formatMessage: (count) => `count=${count}`,
            sink: (message) => emitted.push(message),
            now: () => currentTime
        });

        assert.strictEqual(logger.tick(5), 5);
        currentTime += 5000;
        assert.strictEqual(logger.tick(2), 7);

        assert.deepStrictEqual(emitted, ["count=5", "count=7"]);
    });

    void it("resets the counter and the throttle window so the next tick emits immediately", () => {
        const emitted: Array<string> = [];
        let currentTime = 1_000_000;
        const logger = createThrottledCounterLogger({
            intervalMs: 1000,
            formatMessage: (count) => `count=${count}`,
            sink: (message) => emitted.push(message),
            now: () => currentTime
        });

        assert.strictEqual(logger.tick(), 1);
        currentTime += 2000;
        logger.reset();
        assert.strictEqual(logger.getCount(), 0);
        currentTime += 1;
        assert.strictEqual(logger.tick(), 1);

        assert.deepStrictEqual(emitted, ["count=1", "count=1"]);
    });

    void it("falls back to the default formatter and console sink when omitted", () => {
        let currentTime = 1_000_000;
        const logger = createThrottledCounterLogger({
            intervalMs: 1000,
            now: () => currentTime
        });

        const originalLog = console.log;
        const captured: Array<string> = [];
        console.log = (message: string) => {
            captured.push(String(message));
        };
        try {
            logger.tick(2);
            currentTime += 2000;
            logger.tick(3);
        } finally {
            console.log = originalLog;
        }

        assert.deepStrictEqual(captured, ["(2 processed)", "(5 processed)"]);
        assert.strictEqual(logger.getCount(), 5);
    });

    void it("emits every tick when the throttle window is shorter than the clock step", () => {
        const emitted: Array<string> = [];
        let currentTime = 1_000_000;
        const logger = createThrottledCounterLogger({
            intervalMs: 0,
            formatMessage: (count) => `n=${count}`,
            sink: (message) => emitted.push(message),
            now: () => currentTime
        });

        logger.tick();
        currentTime += 1;
        logger.tick();
        currentTime += 1;
        logger.tick();

        assert.deepStrictEqual(emitted, ["n=1", "n=2", "n=3"]);
    });

    void it("rejects non-finite or negative deltas", () => {
        const logger = createThrottledCounterLogger();

        assert.throws(() => logger.tick(-1), /non-negative finite number/);
        assert.throws(() => logger.tick(Number.NaN), /non-negative finite number/);
        assert.throws(() => logger.tick(Number.POSITIVE_INFINITY), /non-negative finite number/);
    });
});
