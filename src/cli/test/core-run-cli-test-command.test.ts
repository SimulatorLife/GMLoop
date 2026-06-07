import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

void describe("runCliTestCommand", () => {
    void it("includes the updated top-level command summary in help output", async () => {
        const result = await runCliTestCommand({
            argv: ["--help"]
        });

        assert.equal(result.exitCode, 0);
        assert.match(
            result.stdout,
            /Provides formatting, linting, refactoring, transpiling, graph analysis, runtime\s+workflows, and report generation commands\./u
        );
    });

    void it("restores environment variables overridden for the test run", async () => {
        const overrideKey = "PRETTIER_PLUGIN_GML_TEST_OVERRIDE";
        const originalValue = process.env[overrideKey];
        process.env[overrideKey] = "original-value";

        try {
            await runCliTestCommand({
                argv: ["--help"],
                env: {
                    [overrideKey]: "override-value"
                }
            });

            assert.equal(process.env[overrideKey], "original-value");
        } finally {
            if (originalValue === undefined) {
                delete process.env[overrideKey];
            } else {
                process.env[overrideKey] = originalValue;
            }
        }
    });

    void it("restores environment variables removed during the test run", async () => {
        const overrideKey = "PRETTIER_PLUGIN_GML_TEST_REMOVE";
        const originalValue = process.env[overrideKey];
        process.env[overrideKey] = "should-be-restored";

        try {
            await runCliTestCommand({
                argv: ["--help"],
                env: {
                    [overrideKey]: undefined
                }
            });

            assert.equal(process.env[overrideKey], "should-be-restored");
        } finally {
            if (originalValue === undefined) {
                delete process.env[overrideKey];
            } else {
                process.env[overrideKey] = originalValue;
            }
        }
    });
});
