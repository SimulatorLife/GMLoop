import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ConflictSeverity,
    type ConflictSeverityValue,
    isConflictSeverity,
    parseConflictSeverity,
    requireConflictSeverity
} from "../src/types.js";
import { runEnumHelperTests } from "./test-helpers/run-enum-helper-tests.js";

runEnumHelperTests<ConflictSeverityValue>({
    enumName: "ConflictSeverity",
    typeName: "conflict severity",
    typeNamePlural: "conflict severities",
    enum: ConflictSeverity,
    validValues: ["error", "warning", "info"],
    invalidValues: ["fatal", "critical", "debug", "trace", "", null, undefined, 123, {}, [], true],
    is: isConflictSeverity,
    parse: parseConflictSeverity,
    require: requireConflictSeverity
});

void describe("ConflictSeverity regression coverage", () => {
    void it("ConflictSeverity constants can be used in conditionals", () => {
        const severity: ConflictSeverityValue = "warning";

        if (severity === ConflictSeverity.WARNING) {
            assert.ok(true);
        } else {
            assert.fail("Should match WARNING");
        }
    });

    void it("ConflictSeverity rejects invalid severities with helpful error", () => {
        const invalidSeverity = "fatal";
        assert.throws(
            () => requireConflictSeverity(invalidSeverity, "test context"),
            (error: Error) => {
                assert.ok(error instanceof TypeError);
                assert.ok(error.message.includes("Invalid conflict severity"));
                assert.ok(error.message.includes('"fatal"'));
                assert.ok(error.message.includes("test context"));
                assert.ok(error.message.includes("Must be one of: error, warning, info"));
                return true;
            }
        );
    });

    void it("Invalid strings fail fast with requireConflictSeverity", () => {
        // Regression: prior to typed centralization, raw literals like "warn" or "fatal"
        // would silently fall through the `=== "warning"` check and be misclassified.
        // The typed enum now rejects any string not in {error, warning, info}.
        const invalidStrings = ["warn", "fatal", "critical", "debug", "ERROR", "Warning", "Info", "notice"];

        for (const invalid of invalidStrings) {
            assert.throws(
                () => requireConflictSeverity(invalid),
                (error: Error) => {
                    assert.ok(error instanceof TypeError);
                    assert.ok(error.message.includes("Invalid conflict severity"));
                    assert.ok(error.message.includes(JSON.stringify(invalid)));
                    return true;
                },
                `Expected requireConflictSeverity to throw on invalid input: ${invalid}`
            );
        }
    });

    void it("Valid severities keep working after typed centralization", () => {
        // Regression: the typed constants must produce the same string values that
        // the previous stringly-typed branches compared against, so existing
        // equality checks using the constants continue to behave correctly.
        assert.equal(ConflictSeverity.ERROR === "error", true);
        assert.equal(ConflictSeverity.WARNING === "warning", true);
        assert.equal(ConflictSeverity.INFO === "info", true);

        // Round-tripping through parse keeps the canonical string form.
        assert.equal(parseConflictSeverity(ConflictSeverity.ERROR), ConflictSeverity.ERROR);
        assert.equal(parseConflictSeverity(ConflictSeverity.WARNING), ConflictSeverity.WARNING);
        assert.equal(parseConflictSeverity(ConflictSeverity.INFO), ConflictSeverity.INFO);

        // require returns the canonical form for valid input.
        assert.equal(requireConflictSeverity(ConflictSeverity.ERROR), ConflictSeverity.ERROR);
        assert.equal(requireConflictSeverity(ConflictSeverity.WARNING), ConflictSeverity.WARNING);
        assert.equal(requireConflictSeverity(ConflictSeverity.INFO), ConflictSeverity.INFO);
    });
});
