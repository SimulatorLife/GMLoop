import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    applyProgressBarWidthEnvOverride,
    DEFAULT_PROGRESS_BAR_WIDTH,
    getDefaultProgressBarWidth,
    PROGRESS_BAR_WIDTH_ENV_VAR,
    resolveProgressBarWidth,
    setDefaultProgressBarWidth
} from "../src/shared/progress-bar.js";
import { buildEnvConfiguredValueTests } from "./test-helpers/env-configured-value-test-builder.js";

void describe("progress bar utilities", () => {
    buildEnvConfiguredValueTests({
        description: "width",
        defaultValue: DEFAULT_PROGRESS_BAR_WIDTH,
        envVar: PROGRESS_BAR_WIDTH_ENV_VAR,
        getValue: getDefaultProgressBarWidth,
        setValue: setDefaultProgressBarWidth,
        applyEnvOverride: applyProgressBarWidthEnvOverride,
        testOverrideValue: 28,
        testOverrideEnvString: "28"
    });

    void it("returns the default width when no value is provided", () => {
        assert.strictEqual(resolveProgressBarWidth(), DEFAULT_PROGRESS_BAR_WIDTH);
    });

    void it("normalizes numeric inputs", () => {
        const normalizedFromString = resolveProgressBarWidth("  32 ");
        assert.strictEqual(typeof normalizedFromString, "number");
        assert.strictEqual(normalizedFromString, 32);

        const normalizedFromFloat = resolveProgressBarWidth(16.75);
        assert.strictEqual(typeof normalizedFromFloat, "number");
        assert.strictEqual(normalizedFromFloat, 16);
    });

    void it("rejects non-positive widths", () => {
        assert.throws(() => resolveProgressBarWidth(0), /positive integer/i);
        assert.throws(() => resolveProgressBarWidth(-5), /positive integer/i);
    });

    void it("allows configuring the default width programmatically", () => {
        setDefaultProgressBarWidth(40);

        assert.strictEqual(getDefaultProgressBarWidth(), 40);
        assert.strictEqual(resolveProgressBarWidth(), 40);
    });

    void it("resets to the baseline default when set to undefined", () => {
        setDefaultProgressBarWidth(31);
        setDefaultProgressBarWidth(undefined);

        assert.strictEqual(getDefaultProgressBarWidth(), DEFAULT_PROGRESS_BAR_WIDTH);
    });
});
