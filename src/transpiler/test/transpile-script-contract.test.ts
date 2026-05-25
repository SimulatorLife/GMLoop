/**
 * Contract tests for transpileScript source text preservation.
 *
 * These tests verify that the ScriptPatch returned by transpileScript
 * correctly preserves the input source text, which is required for
 * hot-reload tooling to track and update script sources.
 *
 * Note: These tests live in a separate file to avoid a Node.js v25 test
 * runner quirk where the second top-level test in a file can spuriously
 * fail with "Promise resolution is still pending but the event loop has
 * already resolved" when running the full test suite.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Transpiler } from "@gmloop/transpiler";

void describe("transpileScript source text contract", () => {
    void it("preserves source text in the returned patch", () => {
        const transpiler = new Transpiler.GmlTranspiler();
        const sourceText = "x = 1 + 2";
        const patch = transpiler.transpileScript({
            sourceText,
            symbolId: "gml/script/test"
        });

        assert.strictEqual(patch.kind, "script");
        assert.strictEqual(patch.id, "gml/script/test");
        assert.ok(patch.sourceText === sourceText);
    });

    void it("returns a patch with correct shape for simple code", () => {
        const transpiler = new Transpiler.GmlTranspiler();
        const sourceText = "42";
        const patch = transpiler.transpileScript({
            sourceText,
            symbolId: "gml/script/test"
        });

        assert.strictEqual(patch.kind, "script");
        assert.strictEqual(patch.id, "gml/script/test");
        assert.ok(patch.js_body.length > 0);
        assert.ok(typeof patch.version === "number");
        assert.ok(patch.sourceText === sourceText);
    });
});
