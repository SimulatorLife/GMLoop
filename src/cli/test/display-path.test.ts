import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { formatPathForDisplay } from "../src/workflow/display-path.js";

void describe("formatPathForDisplay", () => {
    void it("returns a relative path when the target is inside cwd", () => {
        const cwd = path.resolve("/tmp/workspace");
        const targetPath = path.resolve(cwd, "scripts", "example.gml");

        assert.equal(
            formatPathForDisplay(targetPath, {
                cwd
            }),
            "scripts/example.gml"
        );
    });

    void it("returns dot when the target equals cwd", () => {
        const cwd = path.resolve("/tmp/workspace");

        assert.equal(
            formatPathForDisplay(cwd, {
                cwd
            }),
            "."
        );
    });

    void it("returns an absolute path when the target is outside cwd", () => {
        const cwd = path.resolve("/tmp/workspace");
        const targetPath = path.resolve("/tmp/other/example.gml");

        assert.equal(
            formatPathForDisplay(targetPath, {
                cwd
            }),
            targetPath
        );
    });
});
