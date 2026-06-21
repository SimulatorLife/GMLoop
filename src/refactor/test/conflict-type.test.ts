import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    ConflictType,
    type ConflictTypeValue,
    isConflictType,
    parseConflictType,
    requireConflictType
} from "../src/types.js";
import { runEnumHelperTests } from "./test-helpers/run-enum-helper-tests.js";

runEnumHelperTests<ConflictTypeValue>({
    enumName: "ConflictType",
    typeName: "conflict type",
    enum: ConflictType,
    validValues: [
        "invalid_identifier",
        "shadow",
        "reserved",
        "missing_symbol",
        "large_rename",
        "many_dependents",
        "analysis_error"
    ],
    invalidValues: ["invalid", "error", "warning", "", null, undefined, 123, {}, []],
    is: isConflictType,
    parse: parseConflictType,
    require: requireConflictType
});

void describe("ConflictType regression coverage", () => {
    void it("ConflictType constants prevent typos in branching logic", () => {
        const conflict = {
            type: ConflictType.RESERVED as ConflictTypeValue,
            message: "Test message"
        };

        assert.equal(conflict.type === ConflictType.RESERVED, true);
        assert.equal(conflict.type === ConflictType.SHADOW, false);
    });

    void it("Invalid strings fail fast with requireConflictType", () => {
        const invalidType = "typo_in_conflict_type";

        assert.throws(
            () => requireConflictType(invalidType),
            (error: Error) => {
                assert.ok(error instanceof TypeError);
                assert.ok(error.message.includes(invalidType));
                assert.ok(error.message.includes("invalid_identifier"));
                return true;
            }
        );
    });
});
