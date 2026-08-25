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
            "Quiet",
            "NORMAL",
            "DEBUG",
            "info",
            "warn",
            "error",
            "silent",
            "verbose",
            " quiet",
            "quiet ",
            "quiet\n",
            "true",
            "false",
            ""
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
                assert.match(error.message, /Invalid live-reload bootstrap log level/);
                assert.match(error.message, /quiet.*normal.*debug/u);
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
        const invalidInputs: ReadonlyArray<unknown> = ["Quiet", "NORMAL", "info", "warn", "", "quiet ", " quiet"];

        for (const invalid of invalidInputs) {
            assert.throws(
                () => assertLiveReloadLogLevel(invalid as never),
                (error: unknown) => {
                    assert.ok(error instanceof RangeError);
                    assert.match(error.message, /Unsupported live-reload bootstrap log level/);
                    return true;
                }
            );
        }
    });
});
