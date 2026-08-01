import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { test } from "node:test";

import { applyEnvironmentOverride, createEnvConfiguredValue } from "../src/utils/environment.js";

void test("applyEnvironmentOverride forwards values from provided env", () => {
    let received = null;

    applyEnvironmentOverride({
        env: { SAMPLE_ENV: "value" },
        envVar: "SAMPLE_ENV",
        applyValue: (value) => {
            received = value;
        }
    });

    assert.equal(received, "value");
});

void test("applyEnvironmentOverride skips missing variables", () => {
    let called = false;

    applyEnvironmentOverride({
        env: {},
        envVar: "UNKNOWN_ENV",
        applyValue: () => {
            called = true;
        }
    });

    assert.equal(called, false);
});

function uniqueEnvVar(prefix) {
    // Date.now() only has millisecond precision, so concurrent tests could pick
    // the same suffix and race when mutating process.env. Random UUIDs avoid
    // collisions without relying on timing.
    return `${prefix}_${randomUUID()}`;
}

void test("applyEnvironmentOverride falls back to process.env when env is omitted", () => {
    const variable = uniqueEnvVar("TEST_ENV");
    const original = process.env[variable];
    process.env[variable] = "inherited";

    try {
        let captured = null;

        applyEnvironmentOverride({
            envVar: variable,
            applyValue: (value) => {
                captured = value;
            }
        });

        assert.equal(captured, "inherited");
    } finally {
        if (original === undefined) {
            delete process.env[variable];
        } else {
            process.env[variable] = original;
        }
    }
});

void test("createEnvConfiguredValue normalizes updates", () => {
    const config = createEnvConfiguredValue({
        defaultValue: 5,
        normalize: (value, { defaultValue }) => {
            if (value === undefined) {
                return defaultValue;
            }

            const numeric = Number(value);
            return Number.isFinite(numeric) ? numeric : defaultValue;
        }
    });

    assert.equal(config.get(), 5);
    assert.equal(config.set("8"), 8);
    assert.equal(config.get(), 8);
    assert.equal(config.set(undefined), 5);
});

void test("createEnvConfiguredValue applies environment overrides", () => {
    let applied = null;
    const variable = uniqueEnvVar("CONFIG_ENV");
    const config = createEnvConfiguredValue({
        defaultValue: 1,
        envVar: variable,
        normalize: (value, { defaultValue }) => {
            if (value === undefined) {
                return defaultValue;
            }

            const numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                return defaultValue;
            }

            applied = value;
            return numeric;
        }
    });

    const env = { [variable]: "42" };
    config.applyEnvOverride(env);

    assert.equal(applied, "42");
    assert.equal(config.get(), 42);
});
