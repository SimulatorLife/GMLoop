import assert from "node:assert/strict";
import { describe, it } from "node:test";

void describe("formatting session negation tracking", () => {
    void it("resets negated ignore rule tracking between runs", async () => {
        const skipEnvVar = "PRETTIER_PLUGIN_GML_SKIP_CLI_RUN";
        const originalSkipRun = process.env[skipEnvVar];
        process.env[skipEnvVar] = "1";
        let restored = false;

        const restoreSkipEnv = () => {
            if (restored) {
                return;
            }
            restored = true;
            if (originalSkipRun === undefined) {
                delete process.env[skipEnvVar];
            } else {
                process.env[skipEnvVar] = originalSkipRun;
            }
        };

        try {
            const [{ __test__ }, tracker] = await Promise.all([
                import("../src/cli.js"),
                import("../src/modules/formatting/ignore-tracking.js")
            ]);

            const { hasNegatedIgnoreRules, markNegatedIgnoreRulesDetected } = tracker;

            assert.equal(hasNegatedIgnoreRules(), false);
            markNegatedIgnoreRulesDetected();
            assert.equal(hasNegatedIgnoreRules(), true);

            const resetPromise = __test__.resetFormattingSessionForTests("skip");

            restoreSkipEnv();
            await resetPromise;

            assert.equal(hasNegatedIgnoreRules(), false);
        } catch (error) {
            restoreSkipEnv();
            throw error;
        }
    });
});
