import assert from "node:assert/strict";
import type { WatchListener } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { fetchStatusPayload, waitForStatus } from "./test-helpers/status-polling.js";
import { setupWatchChangeTest } from "./test-helpers/watch-change-setup.js";
import { createMockWatchFactory } from "./test-helpers/watch-fixtures.js";
import { runWatchTest } from "./test-helpers/watch-runner.js";

type AwaitableWatchListener = (...args: Parameters<WatchListener<string>>) => void | Promise<void>;

async function triggerWatchChangeAndWait(listener: WatchListener<string> | undefined, filename: string): Promise<void> {
    assert.ok(listener, "watch listener should be registered");
    const awaitableListener: AwaitableWatchListener = listener;
    await awaitableListener("change", filename);
}

void describe("watch command duplicate change handling", () => {
    void it("skips duplicate change events when file mtime is unchanged", { timeout: 10_000 }, async () => {
        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        await runWatchTest(
            "watch-duplicate-change",
            {
                watchFactory,
                debounceDelay: 0
            },
            async (context) => {
                const { testFile, firstStatus } = await setupWatchChangeTest(context, listenerCapture);

                await triggerWatchChangeAndWait(listenerCapture.listener, path.basename(testFile));
                const secondStatus = await fetchStatusPayload(context.baseUrl);

                assert.equal(
                    secondStatus.totalPatchCount,
                    firstStatus.totalPatchCount,
                    "duplicate events should not increase patch count"
                );
            }
        );
    });

    void it("skips duplicate events after startup for unchanged live content", { timeout: 10_000 }, async () => {
        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        await runWatchTest(
            "watch-live-content-duplicate",
            {
                watchFactory,
                debounceDelay: 0
            },
            async (context) => {
                const { testDir, baseUrl } = context;
                const testFile = path.join(testDir, "script1.gml");
                await writeFile(testFile, "var startup_value = 1;", "utf8");

                await waitForStatus(baseUrl, (status) => status.scanComplete === true, 1000);

                await writeFile(testFile, "var startup_value = 2;", "utf8");
                listenerCapture.listener?.("change", path.basename(testFile));
                await waitForStatus(baseUrl, (status) => (status.totalPatchCount ?? 0) >= 1, 1000);

                const afterLiveChange = await fetchStatusPayload(baseUrl);
                assert.equal(afterLiveChange.totalPatchCount, 1, "live change should emit one runtime patch");

                await triggerWatchChangeAndWait(listenerCapture.listener, path.basename(testFile));
                const afterDuplicateEvent = await fetchStatusPayload(baseUrl);
                assert.equal(
                    afterDuplicateEvent.totalPatchCount,
                    1,
                    "duplicate event after startup should not retranspile unchanged live content"
                );
            }
        );
    });
});
