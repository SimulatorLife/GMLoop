/**
 * Verifies that `yieldToEventLoop` in `src/cli/src/commands/watch.ts` throttles
 * its real (macrotask) yield to once every `EVENT_LOOP_YIELD_INTERVAL` calls
 * instead of yielding on every call.
 *
 * The startup directory/file scan calls this helper once or twice per file
 * plus once per directory. Each real yield costs at least ~1ms (a
 * `setImmediate` tick followed by a 1ms timer), so yielding unconditionally
 * turns into seconds of pure sleep for projects with thousands of files. This
 * test locks in the throttled behavior: only every Nth call should resolve
 * via the slow macrotask path, and the rest should resolve on the same
 * microtask flush as `Promise.resolve()`.
 *
 * This test file must be the first (and only) consumer of
 * `../src/commands/watch.js` in its process so the module-level yield
 * counter starts at zero.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __watchTest__ } from "../src/commands/watch.js";

const { EVENT_LOOP_YIELD_INTERVAL, yieldToEventLoop } = __watchTest__;

/**
 * Resolves to `true` when `promise` settles within the current microtask
 * queue flush (i.e. it never touched a macrotask like `setImmediate`).
 */
async function resolvesOnMicrotaskQueue(promise: Promise<void>): Promise<boolean> {
    let resolvedSynchronously = false;
    void promise.then(() => {
        resolvedSynchronously = true;
        return undefined;
    });

    // Draining one microtask tick is enough for a `Promise.resolve()`-style
    // fast path to settle, but not enough for a `setImmediate` + timer chain.
    await Promise.resolve();
    await Promise.resolve();

    return resolvedSynchronously;
}

void describe("watch startup event loop yield throttling", () => {
    void it("only performs a real yield once every EVENT_LOOP_YIELD_INTERVAL calls", async () => {
        assert.ok(EVENT_LOOP_YIELD_INTERVAL > 1, "throttling interval should batch more than one call");

        const fastResolutions: Array<boolean> = [];
        for (let call = 0; call < EVENT_LOOP_YIELD_INTERVAL; call += 1) {
            // eslint-disable-next-line no-await-in-loop -- each call must be observed before the next is issued
            fastResolutions.push(await resolvesOnMicrotaskQueue(yieldToEventLoop()));
        }

        const slowYieldCount = fastResolutions.filter((resolvedFast) => !resolvedFast).length;
        assert.strictEqual(
            slowYieldCount,
            1,
            `expected exactly one real yield per ${EVENT_LOOP_YIELD_INTERVAL} calls, saw ${slowYieldCount}`
        );
    });
});
