import assert from "node:assert/strict";
import { test } from "node:test";

import { __formatTest__, PrettierLogLevel } from "../src/commands/format.js";

const { getDefaultPrettierLogLevelForTests, prettierLogLevelForTests, prettierLogLevelOptionForTests } = __formatTest__;

void test("PrettierLogLevel exposes every supported level as a frozen enum entry", () => {
    // The canonical level set is frozen so accidental mutation surfaces as a
    // TypeError at runtime, and the value list is the single source of truth
    // used to derive VALID_PRETTIER_LOG_LEVELS inside `format.ts`.
    assert.deepStrictEqual(
        Object.freeze({ ...PrettierLogLevel }),
        Object.freeze({
            DEBUG: "debug",
            ERROR: "error",
            INFO: "info",
            SILENT: "silent",
            WARN: "warn"
        })
    );
    assert.strictEqual(Object.isFrozen(PrettierLogLevel), true);
});

void test("PrettierLogLevel values round-trip through the validation helper", () => {
    // The helper returned by createEnumeratedOptionHelpers is what the CLI
    // option parser uses to fail fast on user-supplied values. Each canonical
    // level must round-trip through `requireValue` unchanged.
    for (const level of Object.values(PrettierLogLevel)) {
        assert.strictEqual(prettierLogLevelOptionForTests.requireValue(level), level);
    }
});

void test("PrettierLogLevel helper accepts case-insensitive variants of valid levels", () => {
    // The default configuration of `createEnumeratedOptionHelpers` is
    // case-insensitive, so users can pass "WARN", "Warn", "warn" and so on
    // for ergonomics. Lock down the normalization behavior so it does not
    // drift silently.
    for (const level of Object.values(PrettierLogLevel)) {
        const upper = level.toUpperCase();
        const titled = level[0].toUpperCase() + level.slice(1);
        assert.strictEqual(prettierLogLevelOptionForTests.requireValue(upper), level);
        assert.strictEqual(prettierLogLevelOptionForTests.requireValue(titled), level);
    }
});

void test("PrettierLogLevel helper fails fast on unrecognized values", () => {
    // Regression: before the typed enum landed, raw strings such as "verbose"
    // or "trace" flowed straight into `configureConsoleMethods` and were
    // silently treated as "non-silent, non-debug" (i.e., the warn default).
    // The validation helper must now throw so the CLI surfaces a clear error
    // and downstream code can rely on the strict set.
    const invalidValues = ["verbose", "trace", "fatal", "off", "", "WARNS"];
    for (const value of invalidValues) {
        assert.throws(
            () => prettierLogLevelOptionForTests.requireValue(value),
            /Must be one of: /,
            `expected "${value}" to be rejected by the log level validator`
        );
    }
});

void test("PrettierLogLevel helper fails fast on non-string inputs", () => {
    // The CLI option parser can be reached with anything Commander parses,
    // including numbers, null, or objects. Anything that is not a valid
    // canonical level must fail fast rather than coerce.
    const invalidValues: Array<unknown> = [null, undefined, 42, true, false, [], { level: "warn" }];
    for (const value of invalidValues) {
        assert.throws(
            () => prettierLogLevelOptionForTests.requireValue(value),
            /Must be one of: /,
            `expected ${JSON.stringify(value)} to be rejected by the log level validator`
        );
    }
});

void test("PrettierLogLevel helper normalises missing or invalid input to the supplied fallback", () => {
    // The `normalize` form is what the env-var bootstrap path uses to avoid
    // crashing when `PRETTIER_PLUGIN_GML_LOG_LEVEL` is unset or typo'd. The
    // fallback parameter is the contract that keeps the helper call sites
    // branch-free, so make sure it is respected and that an invalid value
    // without a fallback returns null instead of throwing.
    for (const fallback of Object.values(PrettierLogLevel)) {
        assert.strictEqual(prettierLogLevelOptionForTests.normalize(undefined, fallback), fallback);
        assert.strictEqual(prettierLogLevelOptionForTests.normalize("", fallback), fallback);
        assert.strictEqual(prettierLogLevelOptionForTests.normalize("verbose", fallback), fallback);
    }

    assert.strictEqual(prettierLogLevelOptionForTests.normalize("verbose"), null);
});

void test("DEFAULT_PRETTIER_LOG_LEVEL resolves to PrettierLogLevel.WARN", () => {
    // The default must stay aligned with the typed enum so future additions
    // to PrettierLogLevel cannot accidentally drift the fallback value.
    assert.strictEqual(getDefaultPrettierLogLevelForTests(), PrettierLogLevel.WARN);
    assert.strictEqual(getDefaultPrettierLogLevelForTests(), "warn");
});

void test("PrettierLogLevel test export mirrors the production enum reference", () => {
    // The `__formatTest__` bag exposes the typed values so tests can use
    // them without re-importing them across the workspace. Reference
    // equality proves the bag shares the exact same frozen object the
    // production code branches against, so adding a new level in one place
    // is reflected in the test helpers automatically.
    assert.strictEqual(prettierLogLevelForTests, PrettierLogLevel);
    assert.strictEqual(Object.isFrozen(prettierLogLevelForTests), true);

    const values = Object.values(prettierLogLevelForTests);
    assert.deepStrictEqual([...values].sort(), ["debug", "error", "info", "silent", "warn"]);
});
