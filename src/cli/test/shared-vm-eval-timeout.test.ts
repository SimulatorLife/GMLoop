import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
    applyVmEvalTimeoutEnvOverride,
    DEFAULT_VM_EVAL_TIMEOUT_MS,
    getDefaultVmEvalTimeoutMs,
    resolveVmEvalTimeout,
    setDefaultVmEvalTimeoutMs,
    VM_EVAL_TIMEOUT_ENV_VAR
} from "../src/runtime-options/vm-eval-timeout.js";

void describe("resolveVmEvalTimeout", () => {
    void it("returns the default when value is undefined", () => {
        assert.strictEqual(resolveVmEvalTimeout(), DEFAULT_VM_EVAL_TIMEOUT_MS);
    });

    void it("returns the default when value is null", () => {
        assert.strictEqual(resolveVmEvalTimeout(null), DEFAULT_VM_EVAL_TIMEOUT_MS);
    });

    void it("coerces numeric input to an integer", () => {
        assert.strictEqual(resolveVmEvalTimeout(123.75), 123);
    });

    void it("accepts numeric strings", () => {
        assert.strictEqual(resolveVmEvalTimeout("2500"), 2500);
    });

    void it("returns 0 when the timeout is disabled", () => {
        assert.strictEqual(resolveVmEvalTimeout(0), 0);
        assert.strictEqual(resolveVmEvalTimeout("0"), 0);
    });

    void it("ignores empty string overrides", () => {
        assert.strictEqual(resolveVmEvalTimeout("   "), DEFAULT_VM_EVAL_TIMEOUT_MS);
    });

    void it("rejects negative values", () => {
        assert.throws(() => resolveVmEvalTimeout(-1), {
            name: "TypeError"
        });
    });

    void it("rejects unsupported types", () => {
        assert.throws(() => resolveVmEvalTimeout(Symbol.for("timeout")), {
            name: "TypeError"
        });
    });
});

void describe("VM evaluation timeout defaults", () => {
    void it("exposes the configured default timeout", () => {
        assert.strictEqual(getDefaultVmEvalTimeoutMs(), DEFAULT_VM_EVAL_TIMEOUT_MS);
    });

    void it("allows overriding the default timeout", () => {
        setDefaultVmEvalTimeoutMs(7500);
        assert.strictEqual(getDefaultVmEvalTimeoutMs(), 7500);
        assert.strictEqual(resolveVmEvalTimeout(), 7500);
    });

    void it("supports disabling the timeout by default", () => {
        setDefaultVmEvalTimeoutMs(0);
        assert.strictEqual(getDefaultVmEvalTimeoutMs(), 0);
        assert.strictEqual(resolveVmEvalTimeout(), 0);
    });

    void it("rejects negative overrides", () => {
        assert.throws(() => setDefaultVmEvalTimeoutMs(-1), {
            name: "TypeError"
        });
    });
});

void describe("VM evaluation timeout environment overrides", () => {
    // Capture state AFTER any previous test has run (post-teardown), so we
    // pick up whatever value the runtime state holds at the point this suite
    // begins.  Module-level capture would capture stale values if another
    // module's tests had already mutated state.
    afterEach(() => {
        if (originalEnvTimeout === undefined) {
            delete process.env[VM_EVAL_TIMEOUT_ENV_VAR];
        } else {
            process.env[VM_EVAL_TIMEOUT_ENV_VAR] = originalEnvTimeout;
        }

        applyVmEvalTimeoutEnvOverride();
        setDefaultVmEvalTimeoutMs(originalDefaultTimeout);
    });

    // Snapshot module-level constants once — they never change.
    const originalDefaultTimeout = DEFAULT_VM_EVAL_TIMEOUT_MS;
    const originalEnvTimeout = process.env[VM_EVAL_TIMEOUT_ENV_VAR];

    void it("applies the timeout from the environment when provided", () => {
        process.env[VM_EVAL_TIMEOUT_ENV_VAR] = "7500";
        applyVmEvalTimeoutEnvOverride();

        assert.strictEqual(getDefaultVmEvalTimeoutMs(), 7500);
        assert.strictEqual(resolveVmEvalTimeout(), 7500);
    });

    void it("treats zero as disabling the timeout", () => {
        process.env[VM_EVAL_TIMEOUT_ENV_VAR] = "0";
        applyVmEvalTimeoutEnvOverride();

        assert.strictEqual(getDefaultVmEvalTimeoutMs(), 0);
        assert.strictEqual(resolveVmEvalTimeout(), 0);
    });

    void it("ignores invalid environment overrides", () => {
        process.env[VM_EVAL_TIMEOUT_ENV_VAR] = "not-a-number";
        applyVmEvalTimeoutEnvOverride();

        assert.strictEqual(getDefaultVmEvalTimeoutMs(), originalDefaultTimeout);
        assert.strictEqual(resolveVmEvalTimeout(), originalDefaultTimeout);
    });
});
