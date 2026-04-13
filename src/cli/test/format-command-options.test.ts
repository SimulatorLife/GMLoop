import assert from "node:assert/strict";
import { test } from "node:test";

import type { CommanderCommandLike } from "../src/cli-core/commander-types.js";
import { collectFormatCommandOptions } from "../src/cli-core/format-command-options.js";

const DEFAULTS = Object.freeze({
    defaultParseErrorAction: "skip",
    defaultPrettierLogLevel: "warn"
});

function createStubCommand({
    args = [],
    opts = () => ({}),
    helpInformation = () => "usage"
}: {
    args?: Array<string>;
    opts?: () => Record<string, unknown>;
    helpInformation?: () => string;
}): CommanderCommandLike {
    return {
        args,
        opts,
        helpInformation
    };
}

void test("collectFormatCommandOptions tolerates commands without option state", () => {
    let helpCalled = false;
    const command = createStubCommand({
        opts: () => ({}),
        helpInformation() {
            helpCalled = true;
            return "usage";
        }
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.ok(helpCalled, "helpInformation should be consulted for usage text");
    assert.deepStrictEqual(result.targetPathInput, null);
    assert.strictEqual(result.targetPathProvided, false);
    assert.strictEqual(result.prettierLogLevel, DEFAULTS.defaultPrettierLogLevel);
    assert.strictEqual(result.onParseError, DEFAULTS.defaultParseErrorAction);
    assert.strictEqual(result.dryRunMode, true);
    assert.strictEqual(result.skippedDirectorySampleLimit, undefined);
    assert.strictEqual(result.ignoredFileSampleLimit, undefined);
    assert.strictEqual(result.unsupportedExtensionSampleLimit, undefined);
    assert.strictEqual(result.usage, "usage");
    assert.strictEqual(result.list, false);
});

void test("collectFormatCommandOptions derives target path from --path option", () => {
    const command = createStubCommand({
        opts: () => ({ path: " ./project  " })
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.targetPathInput, "./project");
    assert.strictEqual(result.targetPathProvided, true);
    assert.strictEqual(result.rawTargetPathInput, " ./project  ");
});

void test("collectFormatCommandOptions reads --list option", () => {
    const command = createStubCommand({
        opts: () => ({ list: true })
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.list, true);
});

void test("collectFormatCommandOptions treats blank --path as provided but empty", () => {
    const command = createStubCommand({
        opts: () => ({ path: "   " })
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.targetPathInput, null);
    assert.strictEqual(result.targetPathProvided, true);
});

void test("collectFormatCommandOptions ignores positional targets", () => {
    const command = createStubCommand({
        args: [" ./script.gml  "],
        opts: () => ({})
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.targetPathInput, null);
    assert.strictEqual(result.targetPathProvided, false);
});

void test("collectFormatCommandOptions sets apply mode when --write is provided", () => {
    const command = createStubCommand({
        opts: () => ({
            write: true
        })
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.dryRunMode, false);
});

void test("collectFormatCommandOptions honours ignored directory samples alias", () => {
    const command = createStubCommand({
        opts: () => ({
            ignoredDirectorySampleLimit: 5,
            ignoredDirectorySamples: 2
        })
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.skippedDirectorySampleLimit, 2);
});

void test("collectFormatCommandOptions sets log level to debug when verbose is true", () => {
    const command = createStubCommand({
        opts: () => ({
            verbose: true
        })
    });

    const result = collectFormatCommandOptions(command, DEFAULTS);

    assert.strictEqual(result.verbose, true);
    assert.strictEqual(result.prettierLogLevel, "debug");
});
