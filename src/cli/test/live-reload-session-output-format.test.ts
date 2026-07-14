import assert from "node:assert/strict";
import { test } from "node:test";

import { Command, InvalidArgumentError, Option } from "commander";

import { runCliTestCommand } from "../src/cli.js";
import { wrapInvalidArgumentResolver } from "../src/cli-core/command-parsing.js";
import {
    coerceLiveReloadSessionOutputFormat,
    DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT,
    LIVE_RELOAD_SESSION_OUTPUT_FORMATS,
    type LiveReloadSessionOutputFormat
} from "../src/modules/live-reload/config.js";

void test("LIVE_RELOAD_SESSION_OUTPUT_FORMATS is frozen and contains the canonical values", () => {
    assert.ok(Object.isFrozen(LIVE_RELOAD_SESSION_OUTPUT_FORMATS));
    assert.equal(LIVE_RELOAD_SESSION_OUTPUT_FORMATS.json, "json");
    assert.equal(LIVE_RELOAD_SESSION_OUTPUT_FORMATS.pretty, "pretty");
});

void test("DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT points at the json value", () => {
    assert.equal(DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT, "json");
    assert.equal(DEFAULT_LIVE_RELOAD_SESSION_OUTPUT_FORMAT, LIVE_RELOAD_SESSION_OUTPUT_FORMATS.json);
});

void test("coerceLiveReloadSessionOutputFormat returns the canonical string for valid values", () => {
    const valid: ReadonlyArray<LiveReloadSessionOutputFormat> = [
        LIVE_RELOAD_SESSION_OUTPUT_FORMATS.json,
        LIVE_RELOAD_SESSION_OUTPUT_FORMATS.pretty
    ];

    for (const value of valid) {
        assert.equal(coerceLiveReloadSessionOutputFormat(value), value);
    }
});

void test("coerceLiveReloadSessionOutputFormat trims surrounding whitespace", () => {
    assert.equal(coerceLiveReloadSessionOutputFormat("  json  "), "json");
    assert.equal(coerceLiveReloadSessionOutputFormat("\tpretty\n"), "pretty");
});

void test("coerceLiveReloadSessionOutputFormat rejects unknown string values with a descriptive message", () => {
    const candidates: ReadonlyArray<string> = ["xml", "JSON", "Pretty", "yaml", "toml", "json,pretty"];

    for (const candidate of candidates) {
        assert.throws(
            () => coerceLiveReloadSessionOutputFormat(candidate),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(
                    error.message,
                    new RegExp(String.raw`Invalid --format value: "${candidate}".*Allowed values: json, pretty\.`)
                );
                return true;
            }
        );
    }
});

void test("coerceLiveReloadSessionOutputFormat rejects empty strings", () => {
    assert.throws(() => coerceLiveReloadSessionOutputFormat(""), /Invalid --format value/u);
});

void test("coerceLiveReloadSessionOutputFormat rejects non-string inputs", () => {
    const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, [], {}, Symbol("json")];

    for (const value of nonStrings) {
        assert.throws(
            () => coerceLiveReloadSessionOutputFormat(value),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /expected a string/u);
                return true;
            }
        );
    }
});

void test("wrapInvalidArgumentResolver converts coerceLiveReloadSessionOutputFormat errors to InvalidArgumentError", () => {
    const parser = wrapInvalidArgumentResolver(coerceLiveReloadSessionOutputFormat);

    assert.throws(
        () => parser("xml"),
        (error: unknown) => error instanceof InvalidArgumentError && /xml/u.test(error.message)
    );
    assert.throws(
        () => parser(null),
        (error: unknown) => error instanceof InvalidArgumentError && /expected a string/u.test(error.message)
    );
});

void test("wrapped parser still accepts the canonical values", () => {
    const parser = wrapInvalidArgumentResolver(coerceLiveReloadSessionOutputFormat);

    assert.equal(parser("json"), LIVE_RELOAD_SESSION_OUTPUT_FORMATS.json);
    assert.equal(parser("pretty"), LIVE_RELOAD_SESSION_OUTPUT_FORMATS.pretty);
});

void test("a Commander option using the validator reports both the bad value and the allowed set", () => {
    const command = new Command()
        .exitOverride()
        .allowExcessArguments(false)
        .addOption(
            new Option("--format <format>", "Output format").argParser(
                wrapInvalidArgumentResolver(coerceLiveReloadSessionOutputFormat)
            )
        );

    assert.throws(
        () => command.parse(["node", "test", "--format", "xml"], { from: "user" }),
        (error: unknown) => {
            if (!(error instanceof Error)) {
                return false;
            }
            // Commander wraps InvalidArgumentError into a CommanderError with code
            // `commander.invalidArgument`. Check the code instead of the constructor
            // identity so the assertion reflects the public contract.
            const commanderError = error as Error & { code?: string };
            return (
                commanderError.code === "commander.invalidArgument" &&
                /xml/u.test(commanderError.message) &&
                /json, pretty/u.test(commanderError.message)
            );
        }
    );
});

void test("live-reload session --help documents the --format option", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["live-reload", "session", "--help"] });

    assert.match(stdout, /--format <format>/u);
});

void test("live-reload session --format rejects an unknown string with a descriptive error", async () => {
    const result = await runCliTestCommand({
        argv: ["live-reload", "session", "--format", "xml", "--path", "/tmp/non-existent-project-12345"]
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr + result.stdout, /Invalid --format value: "xml"\. Allowed values: json, pretty\./u);
});

void test("live-reload session --format rejects an empty string with a descriptive error", async () => {
    const result = await runCliTestCommand({
        argv: ["live-reload", "session", "--format", "", "--path", "/tmp/non-existent-project-12345"]
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr + result.stdout, /Invalid --format value/u);
});
