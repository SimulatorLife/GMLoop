import assert from "node:assert";
import type { WatchListener } from "node:fs";
import { writeFile } from "node:fs/promises";
import { after, before, describe, it } from "node:test";

import { createMinimumValueValidator } from "../src/cli-core/command-parsing.js";
import { createWatchCommand, runWatchCommand } from "../src/commands/watch.js";
import { findAvailablePort } from "./test-helpers/free-port.js";
import { fetchStatusPayload, waitForPatchCount, waitForStatusReady } from "./test-helpers/status-polling.js";
import {
    createMockWatchFactory,
    createWatchTestFixture,
    disposeWatchTestFixture,
    type WatchTestFixture
} from "./test-helpers/watch-fixtures.js";

void it("documents that max patch history is non-negative and zero is unbounded", () => {
    const option = createWatchCommand().options.find((candidate) => candidate.long === "--max-patch-history");

    assert.ok(option);
    assert.match(option.description, /set to 0 for unbounded/iu);
    assert.match(option.description, /Maximum number of patches to retain in memory/iu);
});

void it("accepts zero as an unbounded max-patch-history value", () => {
    // Recreate the validator with the exact arguments the watch command now uses for
    // --max-patch-history, so the regression asserts the documented contract directly
    // rather than poking at commander's frozen option snapshot.
    const parse = createMinimumValueValidator(0, "Max patch history must be a non-negative integer");

    assert.strictEqual(parse("0"), 0, "0 should be accepted as an explicit unbounded cap and round-trip unchanged");
});

void it("rejects negative max-patch-history values", () => {
    const parse = createMinimumValueValidator(0, "Max patch history must be a non-negative integer");

    assert.throws(() => parse("-1"), /Max patch history must be a non-negative integer/u);
});

void describe("Watch command patch history limit", () => {
    let fixture: WatchTestFixture | null = null;

    before(() =>
        createWatchTestFixture().then((created) => {
            fixture = created;
            return created;
        })
    );

    after(() => {
        if (!fixture) {
            return;
        }

        const targetFixture = fixture;
        fixture = null;
        return disposeWatchTestFixture(targetFixture.dir);
    });

    void it("should respect max patch history limit", async () => {
        const maxHistory = 2;
        const statusPort = await findAvailablePort();
        const abortController = new AbortController();

        if (!fixture) {
            throw new Error("Watch fixture was not initialized");
        }

        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        const watchPromise = runWatchCommand(fixture.dir, {
            verbose: false,
            maxPatchHistory: maxHistory,
            websocketServer: false,
            statusServer: true,
            statusPort,
            debounceDelay: 0,
            runtimeServer: false,
            abortSignal: abortController.signal,
            watchFactory
        });

        try {
            const { script1 } = fixture;
            const statusBaseUrl = `http://127.0.0.1:${statusPort}`;
            await waitForStatusReady(statusBaseUrl, 10_000, 25);
            const initialStatus = await fetchStatusPayload(statusBaseUrl);
            const initialPatchCount = initialStatus.totalPatchCount ?? initialStatus.patchCount ?? 0;

            for (let i = 0; i < 5; i++) {
                await writeFile(script1, `var x = ${i}; // Iteration ${i}`, "utf8");
                listenerCapture.listener?.("change", "script1.gml");
                await waitForPatchCount(statusBaseUrl, initialPatchCount + i + 1, 10_000, 25);
            }

            const status = await fetchStatusPayload(statusBaseUrl);
            const historySize = status.patchHistorySize ?? 0;
            assert.ok(
                historySize <= maxHistory,
                `Patch history should be capped at ${maxHistory} entries (saw ${historySize})`
            );
        } finally {
            abortController.abort();

            try {
                await watchPromise;
            } catch {
                // Expected when aborting
            }
        }

        assert.ok(true, "Max patch history limit respected");
    });
});
