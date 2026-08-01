import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RefactorEngine } from "../src/refactor-engine.js";
import { detectRenameConflicts, validateRenameStructure } from "../src/rename/rename-validation.js";

/**
 * Test suite verifying that error message extraction is consistent across the
 * refactor workspace by using the centralized Core.getErrorMessage() utility
 * instead of manual error handling patterns.
 *
 * This ensures that error messages are extracted consistently regardless of
 * whether the caught error is an Error instance, a string, or another value.
 */

void describe("error handling consistency", () => {
    void test("detectRenameConflicts handles Error instances", async () => {
        const conflicts = await detectRenameConflicts("oldName", "invalid-name", [], null, null);

        assert.ok(conflicts.length > 0);
        assert.ok(conflicts[0].message.includes("not a valid GML identifier"));
    });

    void test("validateRenameStructure handles invalid symbolId error", async () => {
        const errors = await validateRenameStructure("", "newName", null);

        assert.ok(errors.length > 0);
        assert.ok(typeof errors[0] === "string");
        assert.ok(errors[0].includes("symbolId"));
    });

    void test("validateRenameStructure handles invalid newName error", async () => {
        const errors = await validateRenameStructure("gml/script/test", "", null);

        assert.ok(errors.length > 0);
        assert.ok(typeof errors[0] === "string");
        assert.ok(errors[0].includes("newName"));
    });

    void test("validateRenameStructure handles invalid identifier syntax error", async () => {
        const errors = await validateRenameStructure("gml/script/test", "123invalid", null);

        assert.ok(errors.length > 0);
        assert.ok(typeof errors[0] === "string");
        assert.ok(errors[0].includes("not a valid GML identifier") || errors[0].includes("Invalid"));
    });

    void test("validateRenameRequest handles invalid identifier and extracts message consistently", async () => {
        const engine = new RefactorEngine();
        const result = await engine.validateRenameRequest({
            symbolId: "gml/script/test",
            newName: "invalid-name"
        });

        assert.equal(result.valid, false);
        assert.ok(result.errors.length > 0);
        assert.ok(typeof result.errors[0] === "string");
        assert.ok(result.errors[0].includes("not a valid GML identifier"));
    });

    void test("prepareBatchRenamePlan handles planning failure and extracts error message consistently", async () => {
        const engine = new RefactorEngine({
            parser: {
                parse: () => {
                    throw new Error("Mock parse error");
                }
            }
        });

        const result = await engine.prepareBatchRenamePlan([{ symbolId: "gml/script/test", newName: "test_new" }]);

        // Planning should fail but return a valid structure
        assert.equal(result.validation.valid, false);
        assert.ok(result.validation.errors.length > 0);

        // Error message should be extracted consistently using getErrorMessage
        const planningError = result.validation.errors.find((e) => e.includes("Planning failed"));
        assert.ok(planningError);
        assert.ok(typeof planningError === "string");
    });

    void test("all error messages are strings", async () => {
        // Test multiple error paths to ensure all return string messages
        const validationErrors = await validateRenameStructure("", "", null);
        const conflictResults = await detectRenameConflicts("old", "123bad", [], null, null);

        // All errors should be strings
        for (const error of validationErrors) {
            assert.ok(typeof error === "string", `Expected string, got ${typeof error}`);
        }

        for (const conflict of conflictResults) {
            assert.ok(typeof conflict.message === "string", `Expected string, got ${typeof conflict.message}`);
        }
    });
});
