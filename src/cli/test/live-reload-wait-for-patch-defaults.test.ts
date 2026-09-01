import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLiveReloadCommand } from "../src/commands/live-reload.js";
import {
    DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS,
    DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS
} from "../src/modules/live-reload/config.js";
import * as liveReloadModule from "../src/modules/live-reload/index.js";

/**
 * Resolve the hidden `live-reload wait-for-patch` subcommand from the
 * top-level `live-reload` command tree. The subcommand is registered with
 * `hidden: true` because it is intended for tooling (e.g. `gm-cli`) rather
 * than interactive CLI use, but it remains in the `commands` array so
 * Commander still parses and dispatches it.
 */
function resolveWaitForPatchSubcommand() {
    const liveReload = createLiveReloadCommand();
    const waitForPatch = liveReload.commands.find((candidate) => candidate.name() === "wait-for-patch");
    assert.ok(waitForPatch, "live-reload wait-for-patch subcommand should be registered");
    return waitForPatch;
}

void describe("live-reload wait-for-patch defaults", () => {
    void it("exposes the timeout and poll-interval constants at their documented values", () => {
        assert.equal(DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS, 10_000);
        assert.equal(DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS, 250);
    });

    void it("wires the constants into the Commander option defaults", () => {
        const waitForPatch = resolveWaitForPatchSubcommand();
        const timeoutOption = waitForPatch.options.find((option) => option.long === "--timeout-ms");
        const pollIntervalOption = waitForPatch.options.find((option) => option.long === "--poll-interval-ms");

        assert.ok(timeoutOption, "--timeout-ms option should be registered");
        assert.ok(pollIntervalOption, "--poll-interval-ms option should be registered");
        assert.equal(timeoutOption.defaultValue, DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS);
        assert.equal(pollIntervalOption.defaultValue, DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS);
    });

    void it("re-exports the constants through the live-reload workspace's public surface", () => {
        // The wildcard export in `modules/live-reload/index.ts` keeps the
        // constants discoverable for downstream tooling that prefers the
        // workspace surface over the deep `config.js` path. If a future
        // refactor narrows that wildcard to a curated allowlist, this test
        // surfaces the regression immediately.
        assert.equal(liveReloadModule.DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_TIMEOUT_MS, 10_000);
        assert.equal(liveReloadModule.DEFAULT_LIVE_RELOAD_WAIT_FOR_PATCH_POLL_INTERVAL_MS, 250);
    });
});
