import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    getRegisteredIgnorePathCount,
    getRegisteredIgnorePathsSnapshot,
    hasRegisteredIgnorePath,
    registerIgnorePath,
    resetRegisteredIgnorePaths
} from "../src/format-runtime/ignore-path-registry.js";

void describe("ignore path registry", () => {
    void it("deduplicates registered paths", () => {
        resetRegisteredIgnorePaths();

        registerIgnorePath("/tmp/example.ignore");
        registerIgnorePath("/tmp/example.ignore");
        registerIgnorePath("/tmp/extra.ignore");

        assert.strictEqual(getRegisteredIgnorePathCount(), 2);
        assert.deepEqual(getRegisteredIgnorePathsSnapshot(), ["/tmp/example.ignore", "/tmp/extra.ignore"]);
    });

    void it("resets all tracked paths", () => {
        resetRegisteredIgnorePaths();

        for (let index = 0; index < 100; index += 1) {
            registerIgnorePath(`/tmp/path-${index}`);
        }

        assert.ok(getRegisteredIgnorePathCount() > 0);
        assert.ok(hasRegisteredIgnorePath("/tmp/path-42"));

        resetRegisteredIgnorePaths();

        assert.strictEqual(getRegisteredIgnorePathCount(), 0);
        assert.strictEqual(hasRegisteredIgnorePath("/tmp/path-42"), false);
    });
});
