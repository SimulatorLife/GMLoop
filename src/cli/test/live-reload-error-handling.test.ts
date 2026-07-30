import assert from "node:assert/strict";
import { test } from "node:test";

import { runLiveReloadBuildCommand, runLiveReloadPrepareCommand } from "../src/commands/live-reload.js";
import { captureCliErrorOutput } from "./test-helpers/capture-cli-error-output.js";

interface LiveReloadErrorRoutingCase {
    readonly description: string;
    readonly invoke: () => Promise<unknown>;
    readonly errorPattern: RegExp;
}

const liveReloadErrorRoutingCases: ReadonlyArray<LiveReloadErrorRoutingCase> = [
    {
        description: "runLiveReloadPrepareCommand routes prepare errors through handleCliError",
        errorPattern: /Error: /u,
        invoke: () =>
            runLiveReloadPrepareCommand({
                html5Output: "/tmp/non-existent-live-reload-prepare-12345",
                gmTempRoot: "/tmp/non-existent-live-reload-prepare-12345",
                quiet: true,
                verbose: false
            })
    },
    {
        description: "runLiveReloadBuildCommand routes build errors through handleCliError",
        errorPattern: /does not exist/u,
        invoke: () =>
            runLiveReloadBuildCommand("/tmp/non-existent-live-reload-build-12345", {
                quiet: true,
                verbose: false
            })
    }
];

for (const { description, errorPattern, invoke } of liveReloadErrorRoutingCases) {
    void test(description, async () => {
        const { logged, exitCodes } = await captureCliErrorOutput(() => {
            return assert.rejects(invoke(), /process\.exit/u);
        });

        assert.deepEqual(exitCodes, [1]);
        assert.equal(logged.length, 1);
        assert.match(logged[0], errorPattern);
    });
}
