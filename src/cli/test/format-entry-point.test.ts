import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveFormatEntryPoint } from "../src/format-runtime/entry-point.js";

void describe("resolveFormatEntryPoint", () => {
    void it("returns the resolved @gmloop/format Prettier plugin entry point", () => {
        const resolved = resolveFormatEntryPoint();

        assert.ok(path.isAbsolute(resolved), "Resolved entry point should be an absolute path.");
        assert.ok(
            resolved.endsWith(`${path.sep}format-entry.js`),
            `Resolved entry point should point at the format workspace's Prettier plugin file. Got: ${resolved}`
        );
    });

    void it("resolves to a path inside the @gmloop/format workspace", () => {
        const resolved = resolveFormatEntryPoint();

        assert.ok(
            resolved.includes(`${path.sep}src${path.sep}format${path.sep}`),
            `Expected the resolved path to live under the @gmloop/format workspace. Got: ${resolved}`
        );
    });
});
