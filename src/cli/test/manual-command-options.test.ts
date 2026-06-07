import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeManualGeneratorBaseOptions } from "../src/modules/manual/command-options.js";

void describe("normalizeManualGeneratorBaseOptions", () => {
    void it("normalizes empty option values to defaults", () => {
        const options = normalizeManualGeneratorBaseOptions({}, "resources/out.json");

        assert.deepEqual(options, {
            outputPath: "resources/out.json",
            manualRoot: null,
            manualPackage: null,
            quiet: false
        });
    });

    void it("preserves explicit values", () => {
        const options = normalizeManualGeneratorBaseOptions(
            {
                output: "tmp/custom.json",
                manualRoot: "vendor/GameMaker-Manual",
                manualPackage: "@gmloop/manual",
                quiet: true
            },
            "resources/out.json"
        );

        assert.deepEqual(options, {
            outputPath: "tmp/custom.json",
            manualRoot: "vendor/GameMaker-Manual",
            manualPackage: "@gmloop/manual",
            quiet: true
        });
    });
});
