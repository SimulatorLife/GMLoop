import assert from "node:assert/strict";
import test from "node:test";

import * as TranspilerPackage from "@gmloop/transpiler";
import { Transpiler } from "@gmloop/transpiler";

/**
 * Verifies the transpiler package public API contract.
 *
 * The package root exposes one canonical namespace, `Transpiler`. Error classes
 * and error codes remain available through that namespace while avoiding the old
 * flattened named-export compatibility path.
 */
void test("transpiler package root exposes only the canonical namespace", () => {
    assert.deepEqual(Object.keys(TranspilerPackage).sort(), ["Transpiler"]);
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
    assert.equal(Transpiler.TranspilerErrorCode.PARSE_ERROR, "PARSE_ERROR");
    assert.equal(Transpiler.TranspilerErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");
    assert.equal(Transpiler.TranspilerErrorCode.REQUEST_ERROR, "REQUEST_ERROR");
    assert.equal(Transpiler.TranspilerErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
});
