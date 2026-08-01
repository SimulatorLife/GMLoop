import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createSampleLimitRuntimeOption,
    ignoredFileSampleLimit,
    skippedDirectorySampleLimit,
    unsupportedExtensionSampleLimit
} from "../src/runtime-options/sample-limits.js";

const TEST_SAMPLE_LIMIT_ENV_VAR = "PRETTIER_PLUGIN_GML_TEST_SAMPLE_LIMIT";

void describe("createSampleLimitRuntimeOption", () => {
    void it("applies the environment override during initialization", () => {
        const env = { [TEST_SAMPLE_LIMIT_ENV_VAR]: "13" };
        const { getDefault } = createSampleLimitRuntimeOption(
            {
                defaultValue: 2,
                envVar: TEST_SAMPLE_LIMIT_ENV_VAR,
                subjectLabel: "Test sample"
            },
            { env }
        );

        assert.strictEqual(getDefault(), 13);
    });

    void it("reuses the provided environment map when reapplying overrides", () => {
        const env = { [TEST_SAMPLE_LIMIT_ENV_VAR]: "4" };

        const { getDefault, applyEnvOverride } = createSampleLimitRuntimeOption(
            {
                defaultValue: 1,
                envVar: TEST_SAMPLE_LIMIT_ENV_VAR,
                subjectLabel: "Test sample"
            },
            { env }
        );

        assert.strictEqual(getDefault(), 4);

        env[TEST_SAMPLE_LIMIT_ENV_VAR] = "7";
        applyEnvOverride();
        assert.strictEqual(getDefault(), 7);

        applyEnvOverride({ [TEST_SAMPLE_LIMIT_ENV_VAR]: "5" });
        assert.strictEqual(getDefault(), 5);
    });

    void it("returns a frozen runtime option and exported options remain frozen without extra wrappers", () => {
        const created = createSampleLimitRuntimeOption({
            defaultValue: 1,
            envVar: TEST_SAMPLE_LIMIT_ENV_VAR,
            subjectLabel: "Test sample"
        });

        assert.strictEqual(Object.isFrozen(created), true);
        assert.strictEqual(Object.isFrozen(ignoredFileSampleLimit), true);
        assert.strictEqual(Object.isFrozen(skippedDirectorySampleLimit), true);
        assert.strictEqual(Object.isFrozen(unsupportedExtensionSampleLimit), true);
    });

    void it("uses the explicit default limit override when resolving empty input", () => {
        const created = createSampleLimitRuntimeOption({
            defaultValue: 3,
            envVar: TEST_SAMPLE_LIMIT_ENV_VAR,
            subjectLabel: "Test sample"
        });

        assert.strictEqual(created.resolve(undefined, { defaultLimit: 11 }), 11);
        assert.strictEqual(created.resolve(undefined), 3);
    });
});
