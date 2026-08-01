import assert from "node:assert/strict";
import type { WatchListener } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";

import { fetchStatusPayload, waitForStatus } from "./test-helpers/status-polling.js";
import { createMockWatchFactory } from "./test-helpers/watch-fixtures.js";
import { runWatchTest } from "./test-helpers/watch-runner.js";

void describe("watch command unknown multi-file change handling", () => {
    void it("processes multiple new files discovered during a single unknown-filename scan", async () => {
        const listenerCapture: { listener: WatchListener<string> | undefined } = { listener: undefined };
        const watchFactory = createMockWatchFactory(listenerCapture);

        await runWatchTest(
            "watch-unknown-multi-file",
            {
                watchFactory,
                debounceDelay: 0
            },
            async (context) => {
                await waitForStatus(context.baseUrl, (status) => status.scanComplete === true, 2000);

                const beforeStatus = await fetchStatusPayload(context.baseUrl);
                const beforePatchCount = beforeStatus.totalPatchCount ?? 0;

                const fileCount = 4;
                const writePromises: Array<Promise<void>> = [];

                for (let i = 0; i < fileCount; i++) {
                    const filePath = path.join(context.testDir, `multi_${i}.gml`);
                    writePromises.push(writeFile(filePath, `function multi_${i}() {\n    return ${i};\n}`, "utf8"));
                }

                await Promise.all(writePromises);

                assert.ok(listenerCapture.listener, "watch listener should be captured");

                const triggerUnknownEvent = listenerCapture.listener as (eventType: string, filename?: string) => void;
                triggerUnknownEvent("rename");

                const afterStatus = await waitForStatus(
                    context.baseUrl,
                    (status) => (status.totalPatchCount ?? 0) >= beforePatchCount + fileCount,
                    3000
                );

                assert.ok(
                    (afterStatus.totalPatchCount ?? 0) >= beforePatchCount + fileCount,
                    `expected at least ${fileCount} new patches from unknown scan, got ${(afterStatus.totalPatchCount ?? 0) - beforePatchCount}`
                );
            }
        );
    });
});
