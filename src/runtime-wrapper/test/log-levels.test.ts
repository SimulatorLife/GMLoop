import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertLiveReloadLogLevel } from "../src/browser/index.js";
import {
    coerceLiveReloadLogLevel,
    isLiveReloadLogLevel,
    LIVE_RELOAD_LOG_LEVEL_VALUES,
    LIVE_RELOAD_LOG_LEVELS,
    parseLiveReloadLogLevel
} from "../src/browser/log-levels.js";

void describe("LIVE_RELOAD_LOG_LEVELS", () => {
    void it("exposes every supported level in canonical order", () => {
        assert.deepEqual(Object.values(LIVE_RELOAD_LOG_LEVELS), ["quiet", "normal", "debug"]);
    });

    void it("freezes the object so the catalogue cannot be mutated at runtime", () => {
        assert.equal(Object.isFrozen(LIVE_RELOAD_LOG_LEVELS), true);
    });

    void it("keeps the entry names in sync with the level values", () => {
        // Regression: previously the level union was inlined as `"quiet" | "normal" | "debug"`
        // in two separate files, which meant a new level could be added to one without the
        // other. The frozen object is now the single source of truth.
        assert.equal(LIVE_RELOAD_LOG_LEVELS.QUIET, "quiet");
        assert.equal(LIVE_RELOAD_LOG_LEVELS.NORMAL, "normal");
        assert.equal(LIVE_RELOAD_LOG_LEVELS.DEBUG, "debug");
    });
});

void describe("LIVE_RELOAD_LOG_LEVEL_VALUES", () => {
    void it("tracks LIVE_RELOAD_LOG_LEVELS membership exactly", () => {
        assert.equal(LIVE_RELOAD_LOG_LEVEL_VALUES.size, Object.values(LIVE_RELOAD_LOG_LEVELS).length);
        for (const level of Object.values(LIVE_RELOAD_LOG_LEVELS)) {
            assert.ok(
                LIVE_RELOAD_LOG_LEVEL_VALUES.has(level),
                `expected LIVE_RELOAD_LOG_LEVEL_VALUES to contain ${level}`
            );
        }
    });
});

void describe("isLiveReloadLogLevel", () => {
    void it("accepts every canonical level", () => {
        for (const level of Object.values(LIVE_RELOAD_LOG_LEVELS)) {
            assert.ok(isLiveReloadLogLevel(level), `expected "${level}" to be a valid LiveReloadLogLevel`);
        }
    });

    void it("rejects look-alike and out-of-vocabulary strings", () => {
        const invalidStrings: ReadonlyArray<string> = [
            "Quiet", // wrong case
            "NORMAL",
            "DEBUG",
            "info", // not a supported bootstrap level (the runtime log levels use this name)
            "warn",
            "error",
            "silent",
            "verbose",
            " quiet", // leading whitespace
            "quiet ",
            "quiet\n",
            "true",
            "false",
            "" // empty string — the previous `if (logLevel === "quiet")` branch silently fell through to "normal"
        ];

        for (const candidate of invalidStrings) {
            assert.equal(isLiveReloadLogLevel(candidate), false, `expected "${candidate}" to be rejected`);
        }
    });

    void it("rejects non-string values without throwing", () => {
        const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, {}, [], Symbol("quiet")];

        for (const candidate of nonStrings) {
            assert.equal(isLiveReloadLogLevel(candidate), false);
        }
    });
});

void describe("parseLiveReloadLogLevel", () => {
    void it("returns the validated level for every canonical value", () => {
        assert.equal(parseLiveReloadLogLevel("quiet"), "quiet");
        assert.equal(parseLiveReloadLogLevel("normal"), "normal");
        assert.equal(parseLiveReloadLogLevel("debug"), "debug");
    });

    void it("returns null for invalid input", () => {
        assert.equal(parseLiveReloadLogLevel("Quiet"), null);
        assert.equal(parseLiveReloadLogLevel("info"), null);
        assert.equal(parseLiveReloadLogLevel(""), null);
        assert.equal(parseLiveReloadLogLevel(undefined), null);
        assert.equal(parseLiveReloadLogLevel(null), null);
        assert.equal(parseLiveReloadLogLevel(42), null);
        assert.equal(parseLiveReloadLogLevel({}), null);
    });
});

void describe("coerceLiveReloadLogLevel", () => {
    void it("returns the validated level for every canonical value", () => {
        assert.equal(coerceLiveReloadLogLevel("quiet"), "quiet");
        assert.equal(coerceLiveReloadLogLevel("normal"), "normal");
        assert.equal(coerceLiveReloadLogLevel("debug"), "debug");
    });

    void it("throws a descriptive error for invalid input", () => {
        assert.throws(
            () => coerceLiveReloadLogLevel("Quiet"),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(
                    error.message,
                    /Invalid live-reload bootstrap log level/,
                    `expected the error to identify the level kind, got: ${error.message}`
                );
                assert.match(
                    error.message,
                    /quiet.*normal.*debug/u,
                    `expected the error to list valid levels, got: ${error.message}`
                );
                return true;
            }
        );
    });

    void it("throws for non-string values", () => {
        assert.throws(() => coerceLiveReloadLogLevel(null), /Invalid live-reload bootstrap log level/);
        assert.throws(() => coerceLiveReloadLogLevel(undefined), /Invalid live-reload bootstrap log level/);
        assert.throws(() => coerceLiveReloadLogLevel(42), /Invalid live-reload bootstrap log level/);
    });
});

void describe("assertLiveReloadLogLevel", () => {
    void it("returns without throwing for every canonical level", () => {
        for (const level of Object.values(LIVE_RELOAD_LOG_LEVELS)) {
            assert.doesNotThrow(() => assertLiveReloadLogLevel(level));
        }
    });

    void it("fails fast on invalid string values", () => {
        // Cast through `unknown` so the runtime check is the only thing standing between
        // the caller and an invalid level. Without the guard, the previous implementation
        // silently fell through to the documented "normal" behaviour for any other
        // value — this regression test pins the new fail-fast behaviour in place.
        const invalidInputs: ReadonlyArray<unknown> = ["Quiet", "NORMAL", "info", "warn", "", "quiet ", " quiet"];

        for (const invalid of invalidInputs) {
            assert.throws(
                () => assertLiveReloadLogLevel(invalid as never),
                (error: unknown) => {
                    assert.ok(
                        error instanceof RangeError,
                        `expected RangeError, got ${error instanceof Error ? error.message : JSON.stringify(error)}`
                    );
                    assert.match(
                        error.message,
                        /Unsupported live-reload bootstrap log level/,
                        `expected the error message to call out the offending level, got: ${error.message}`
                    );
                    return true;
                },
                `expected assertLiveReloadLogLevel to throw on invalid level ${JSON.stringify(invalid)}`
            );
        }
    });
});
