import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fixMalformedComments, recoverParseSourceFromMissingBrace } from "../../src/malformed/source-preprocessing.js";

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

void describe("recoverParseSourceFromMissingBrace", () => {
    void it("returns null when the error is not a missing brace error", () => {
        const result = recoverParseSourceFromMissingBrace("var x = 1;", new Error("syntax error"));
        assert.strictEqual(result, null);
    });

    void it("returns null for a null error", () => {
        const result = recoverParseSourceFromMissingBrace("var x = 1;", null);
        assert.strictEqual(result, null);
    });

    void it("appends closing brace for a missing associated closing brace error", () => {
        const sourceWithMissingBrace = "function foo() {";
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(sourceWithMissingBrace, error);
        assert.ok(result !== null, "Expected recovery result, got null");
        assert.ok(result.includes("}"), "Expected closing brace to be appended");
    });

    void it("appends multiple closing braces for deeply nested unclosed blocks", () => {
        const sourceWithMissingBraces = "function foo() { if (true) {";
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(sourceWithMissingBraces, error);
        assert.ok(result !== null, "Expected recovery result, got null");
        const braceCount = (result.match(/}/g) ?? []).length;
        assert.strictEqual(braceCount, 2);
    });

    void it("does not append braces when text is already balanced", () => {
        const balancedSource = "function foo() {}";
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(balancedSource, error);
        assert.strictEqual(result, null);
    });

    void it("handles error messages with mixed casing", () => {
        const source = "function foo() {";
        const error = new Error("Missing Associated Closing Brace");
        const result = recoverParseSourceFromMissingBrace(source, error);
        assert.ok(result !== null, "Expected recovery result for mixed-case error message");
    });

    void it("ignores braces inside strings", () => {
        const source = 'var s = "{ unclosed string brace";';
        const error = new Error("missing associated closing brace");
        // Braces inside strings should not be counted as unclosed
        const result = recoverParseSourceFromMissingBrace(source, error);
        assert.strictEqual(result, null);
    });

    void it("ignores braces inside single-line comments", () => {
        const source = "// { this brace is in a comment\nvar x = 1;";
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(source, error);
        assert.strictEqual(result, null);
    });

    void it("ignores braces inside block comments", () => {
        const source = "/* { brace in block comment */\nvar x = 1;";
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(source, error);
        assert.strictEqual(result, null);
    });

    void it("continues scanning after escaped string delimiters without counting string braces", () => {
        const source = 'var message = "{\\"still string\\"}";\nif (ready) {';
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(source, error);
        assert.strictEqual(result, 'var message = "{\\"still string\\"}";\nif (ready) {\n}');
    });
});
