import assert from "node:assert/strict";
import test from "node:test";

import { Transpiler, TranspilerError, TranspilerErrorCode } from "@gmloop/transpiler";

/**
 * Verifies the transpiler package public API contract:
 *
 * TranspilerError and TranspilerErrorCode are accessible both through the
 * flattened Transpiler namespace (Transpiler.TranspilerError) and as
 * named exports from the package root.
 *
 * This test guards against the API re-export boundary being violated — the
 * entry-point (src/index.ts) must expose these symbols, and callers must be
 * able to import them directly from @gmloop/transpiler rather than from
 * internal paths (e.g. ../src/api/errors.js).
 */
void test("TranspilerError and TranspilerErrorCode are named exports from package root", () => {
    assert.equal(typeof TranspilerError, "function", "TranspilerError should be a constructor export");
    assert.equal(typeof TranspilerErrorCode, "object", "TranspilerErrorCode should be an object export");

    const error = new TranspilerError("test", TranspilerErrorCode.REQUEST_ERROR);
    assert.equal(error.name, "TranspilerError");
    assert.equal(error.code, "REQUEST_ERROR");
});

void test("Transpiler namespace exposes TranspilerError and TranspilerErrorCode via flattening", () => {
    assert.equal(typeof Transpiler.TranspilerError, "function", "Transpiler.TranspilerError should be accessible");
    assert.equal(
        typeof Transpiler.TranspilerErrorCode,
        "object",
        "Transpiler.TranspilerErrorCode should be accessible"
    );

    const error = new Transpiler.TranspilerError("namespace test", Transpiler.TranspilerErrorCode.INTERNAL_ERROR);
    assert.equal(error.name, "TranspilerError");
    assert.equal(error.code, "INTERNAL_ERROR");
});

void test("TranspilerErrorCode enum has all expected members", () => {
    assert.equal(TranspilerErrorCode.PARSE_ERROR, "PARSE_ERROR");
    assert.equal(TranspilerErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
    assert.equal(TranspilerErrorCode.REQUEST_ERROR, "REQUEST_ERROR");
    assert.equal(TranspilerErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
});
