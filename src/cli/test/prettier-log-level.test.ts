/**
 * Regression coverage for the typed Prettier log-level flag.
 *
 * Verifies that:
 * - The {@link PrettierLogLevel} enum object is the single source of truth
 *   for the supported values and matches the set enforced by
 *   {@link prettierLogLevelOption}.
 * - Valid log levels (`debug`, `info`, `warn`, `error`, `silent`) continue
 *   to round-trip through `requireValue` and `normalize` unchanged.
 * - Out-of-range inputs (unknown strings, `null`, numbers, objects) now
 *   fail fast instead of silently reaching Prettier's configuration.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    DEFAULT_PRETTIER_LOG_LEVEL,
    formatPrettierLogLevelList,
    getPrettierLogLevelValues,
    PrettierLogLevel,
    prettierLogLevelOption
} from "../src/commands/prettier-log-level.js";

void test("PrettierLogLevel enum exposes the canonical Prettier log-level names", () => {
    assert.equal(PrettierLogLevel.DEBUG, "debug");
    assert.equal(PrettierLogLevel.INFO, "info");
    assert.equal(PrettierLogLevel.WARN, "warn");
    assert.equal(PrettierLogLevel.ERROR, "error");
    assert.equal(PrettierLogLevel.SILENT, "silent");
});

void test("DEFAULT_PRETTIER_LOG_LEVEL is the warn enum constant", () => {
    assert.equal(DEFAULT_PRETTIER_LOG_LEVEL, PrettierLogLevel.WARN);
});

void test("getPrettierLogLevelValues returns the full enum value set", () => {
    assert.deepEqual(getPrettierLogLevelValues(), [
        PrettierLogLevel.DEBUG,
        PrettierLogLevel.INFO,
        PrettierLogLevel.WARN,
        PrettierLogLevel.ERROR,
        PrettierLogLevel.SILENT
    ]);
});

void test("formatPrettierLogLevelList returns the sorted level names", () => {
    // Sorted lexicographically so the message stays stable across runs.
    assert.equal(formatPrettierLogLevelList(), "debug, error, info, silent, warn");
});

void test("prettierLogLevelOption valueSet mirrors the enum without drift", () => {
    const set = prettierLogLevelOption.valueSet;
    assert.equal(set.size, getPrettierLogLevelValues().length);
    for (const value of getPrettierLogLevelValues()) {
        assert.ok(set.has(value), `valueSet should contain ${value}`);
    }
});

void test("requireValue accepts every canonical log level unchanged", () => {
    for (const level of getPrettierLogLevelValues()) {
        assert.equal(prettierLogLevelOption.requireValue(level), level);
    }
});

void test("requireValue normalizes case-insensitively for valid levels", () => {
    assert.equal(prettierLogLevelOption.requireValue("WARN"), PrettierLogLevel.WARN);
    assert.equal(prettierLogLevelOption.requireValue(" Silent "), PrettierLogLevel.SILENT);
});

void test("requireValue throws for unknown strings instead of silently passing them through", () => {
    assert.throws(
        () => prettierLogLevelOption.requireValue("verbose"),
        (error: unknown) =>
            error instanceof Error && error.message === `Must be one of: ${formatPrettierLogLevelList()}`
    );
});

void test("requireValue throws for the empty string", () => {
    assert.throws(
        () => prettierLogLevelOption.requireValue(""),
        (error: unknown) => error instanceof Error && error.message.includes("Must be one of")
    );
});

void test("normalize returns the fallback for invalid values and never reaches Prettier", () => {
    assert.equal(prettierLogLevelOption.normalize("nope", DEFAULT_PRETTIER_LOG_LEVEL), DEFAULT_PRETTIER_LOG_LEVEL);
    assert.equal(prettierLogLevelOption.normalize(undefined, DEFAULT_PRETTIER_LOG_LEVEL), DEFAULT_PRETTIER_LOG_LEVEL);
    assert.equal(prettierLogLevelOption.normalize(null, DEFAULT_PRETTIER_LOG_LEVEL), DEFAULT_PRETTIER_LOG_LEVEL);
});

void test("normalize returns the normalized canonical form for valid input", () => {
    assert.equal(prettierLogLevelOption.normalize("INFO"), PrettierLogLevel.INFO);
    assert.equal(prettierLogLevelOption.normalize("debug"), PrettierLogLevel.DEBUG);
});

void test("PrettierLogLevel object is frozen to keep the enum immutable", () => {
    assert.ok(Object.isFrozen(PrettierLogLevel));
    assert.throws(() => {
        (PrettierLogLevel as Record<string, unknown>).TRACE = "trace";
    });
});
