import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Core } from "@gmloop/core";

import { createIntegerRuntimeOptionState } from "../src/shared/integer-runtime-option-state.js";

const TEST_ENV_VAR = "GML_TEST_INTEGER_RUNTIME_OPTION_STATE";
const originalEnvValue = process.env[TEST_ENV_VAR];

afterEach(() => {
    if (originalEnvValue === undefined) {
        delete process.env[TEST_ENV_VAR];
    } else {
        process.env[TEST_ENV_VAR] = originalEnvValue;
    }
});

void describe("createIntegerRuntimeOptionState", () => {
    void it("resolves default overrides before baseline defaults", () => {
        const state = createIntegerRuntimeOptionState({
            defaultValue: 10,
            envVar: TEST_ENV_VAR,
            optionLabel: "Test option",
            createValueErrorMessage: (receivedDescription) => `Test option is invalid: ${receivedDescription}`,
            coerceInteger: Core.coerceNonNegativeInteger
        });

        assert.strictEqual(state.resolve(undefined, { defaultValue: 50, defaultOverride: 20 }), 20);
        assert.strictEqual(state.resolve(undefined, { defaultValue: 50 }), 50);
        assert.strictEqual(state.resolve(undefined), 10);
    });

    void it("uses the shared numeric type formatter and value error message", () => {
        const state = createIntegerRuntimeOptionState({
            defaultValue: 3,
            envVar: TEST_ENV_VAR,
            optionLabel: "Shared sample",
            createValueErrorMessage: (receivedDescription) => `Shared sample invalid: ${receivedDescription}`,
            coerceInteger: Core.coercePositiveInteger
        });

        assert.throws(() => state.resolve(Symbol.for("oops")), {
            message: /Shared sample must be provided as a number/
        });

        assert.throws(() => state.resolve(0), {
            message: /Shared sample invalid/
        });
    });

    void it("applies environment overrides via the shared state wrapper", () => {
        const state = createIntegerRuntimeOptionState({
            defaultValue: 8,
            envVar: TEST_ENV_VAR,
            optionLabel: "State option",
            createValueErrorMessage: (receivedDescription) => `State option invalid: ${receivedDescription}`,
            coerceInteger: Core.coerceNonNegativeInteger
        });

        process.env[TEST_ENV_VAR] = "14";
        state.applyEnvOverride();

        assert.strictEqual(state.get(), 14);
        assert.strictEqual(state.resolve(undefined), 14);
    });
});
