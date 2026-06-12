import assert from "node:assert/strict";
import { test } from "node:test";

import { runWatchCommand } from "../src/commands/watch.js";
import { captureCliErrorOutput } from "./test-helpers/capture-cli-error-output.js";

void test("runWatchCommand logs the formatted error and exits 1 when the target path is missing", async () => {
    const nonExistentPath = "/tmp/non-existent-watch-error-handling-12345";

    const { logged, exitCodes } = await captureCliErrorOutput(async () => {
        await assert.rejects(
            () =>
                runWatchCommand(nonExistentPath, {
                    extensions: [".gml"],
                    polling: false,
                    pollingInterval: 1000,
                    verbose: false
                }),
            /process\.exit called/u
        );
    });

    assert.equal(exitCodes.length, 1);
    assert.equal(exitCodes[0], 1);
    assert.equal(logged.length, 1);
    assert.match(logged[0], new RegExp(`Cannot access ${nonExistentPath.replaceAll("/", String.raw`\/`)}`));
});

void test("runWatchCommand logs and exits 1 when verbose and quiet are combined", async () => {
    const testDir = "/tmp";

    const { logged, exitCodes } = await captureCliErrorOutput(async () => {
        await assert.rejects(
            () =>
                runWatchCommand(testDir, {
                    extensions: [".gml"],
                    polling: false,
                    pollingInterval: 1000,
                    verbose: true,
                    quiet: true
                }),
            /process\.exit called/u
        );
    });

    assert.equal(exitCodes.length, 1);
    assert.equal(exitCodes[0], 1);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /--verbose and --quiet cannot be used together/u);
});
