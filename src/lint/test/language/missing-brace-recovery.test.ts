import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { recoverParseSourceFromMissingBrace } from "../../src/language/missing-brace-recovery.js";

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

    void it("resumes brace scanning after CR-only single-line comments", () => {
        const source = "// generated header\rif (ready) {";
        const error = new Error("missing associated closing brace");
        const result = recoverParseSourceFromMissingBrace(source, error);
        assert.strictEqual(result, "// generated header\rif (ready) {\n}");
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
