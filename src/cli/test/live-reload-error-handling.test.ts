import assert from "node:assert/strict";
import { test } from "node:test";

import { runLiveReloadBuildCommand, runLiveReloadPrepareCommand } from "../src/commands/live-reload.js";
import { captureCliErrorOutput } from "./test-helpers/capture-cli-error-output.js";

void test("runLiveReloadPrepareCommand routes prepare errors through handleCliError", async () => {
    const nonExistentOutput = "/tmp/non-existent-live-reload-prepare-12345";

    const { logged, exitCodes } = await captureCliErrorOutput(async () => {
        await assert.rejects(
            () =>
                runLiveReloadPrepareCommand({
                    html5Output: nonExistentOutput,
                    gmTempRoot: nonExistentOutput,
                    quiet: true,
                    verbose: false
                }),
            /process\.exit/u
        );
    });

    assert.equal(exitCodes.length, 1);
    assert.equal(exitCodes[0], 1);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /Error: /u);
    assert.match(logged[0], new RegExp(nonExistentOutput.replaceAll("/", String.raw`\/`)));
});

void test("runLiveReloadBuildCommand routes build errors through handleCliError", async () => {
    const nonExistentPath = "/tmp/non-existent-live-reload-build-12345";

    const { logged, exitCodes } = await captureCliErrorOutput(async () => {
        await assert.rejects(
            () => runLiveReloadBuildCommand(nonExistentPath, { quiet: true, verbose: false }),
            /process\.exit/u
        );
    });

    assert.equal(exitCodes.length, 1);
    assert.equal(exitCodes[0], 1);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /GameMaker HTML5 build is not configured/u);
});
