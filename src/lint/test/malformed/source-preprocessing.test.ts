import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixMalformedComments } from "../../src/malformed/source-preprocessing.js";

void describe("fixMalformedComments", () => {
    void it("returns the original text unchanged when no malformed comments are present", () => {
        const input = "// @param foo The foo parameter\nvar x = 1;";
        const result = fixMalformedComments(input);
        assert.strictEqual(result.sourceText, input);
        assert.strictEqual(result.indexMapper(0), 0);
        assert.strictEqual(result.indexMapper(10), 10);
    });

    void it("fixes a single-space malformed comment annotation", () => {
        const input = "/ @param foo The foo parameter";
        const result = fixMalformedComments(input);
        assert.strictEqual(result.sourceText, "// @param foo The foo parameter");
    });

    void it("preserves leading whitespace when fixing malformed comment", () => {
        const input = "    / @returns The return value";
        const result = fixMalformedComments(input);
        assert.strictEqual(result.sourceText, "    // @returns The return value");
    });

    void it("fixes multiple malformed comments in the same source", () => {
        const input = "/ @param a\n/ @param b";
        const result = fixMalformedComments(input);
        assert.strictEqual(result.sourceText, "// @param a\n// @param b");
    });

    void it("returns unchanged text for empty string", () => {
        const result = fixMalformedComments("");
        assert.strictEqual(result.sourceText, "");
        assert.strictEqual(result.indexMapper(0), 0);
    });

    void it("returns unchanged text for non-string input", () => {
        const result = fixMalformedComments(null);
        assert.strictEqual(result.sourceText, null);
        assert.strictEqual(result.indexMapper(5), 5);
    });

    void it("returns unchanged text for undefined input", () => {
        const result = fixMalformedComments(undefined);
        assert.strictEqual(result.sourceText, undefined);
        assert.strictEqual(result.indexMapper(5), 5);
    });

    void it("returns unchanged text for numeric input", () => {
        const result = fixMalformedComments(42 as unknown as string);
        assert.strictEqual(result.sourceText, 42);
        assert.strictEqual(result.indexMapper(5), 5);
    });

    void it("maps indices from fixed text back to original text", () => {
        // "/ @param foo" → "// @param foo" (1 char inserted at position 1)
        const input = "/ @param foo";
        const result = fixMalformedComments(input);
        assert.strictEqual(result.sourceText, "// @param foo");
        // Index 0 in new = '/', same as original '/'
        assert.strictEqual(result.indexMapper(0), 0);
        // Index beyond the fix maps with shift of 1
        assert.strictEqual(result.indexMapper(13), 12);
    });
});
