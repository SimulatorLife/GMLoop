import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isOccurrenceKind,
    OccurrenceKind,
    type OccurrenceKindValue,
    parseOccurrenceKind,
    requireOccurrenceKind
} from "../src/types.js";
import { runEnumHelperTests } from "./test-helpers/run-enum-helper-tests.js";

runEnumHelperTests<OccurrenceKindValue>({
    enumName: "OccurrenceKind",
    typeName: "occurrence kind",
    enum: OccurrenceKind,
    validValues: ["definition", "reference"],
    invalidValues: ["invalid", "write", "read", "declaration", "", null, undefined, 123, {}, []],
    is: isOccurrenceKind,
    parse: parseOccurrenceKind,
    require: requireOccurrenceKind
});

void describe("OccurrenceKind regression coverage", () => {
    void it("OccurrenceKind constants can be used in conditionals", () => {
        const kind: OccurrenceKindValue = "definition";

        if (kind === OccurrenceKind.DEFINITION) {
            assert.ok(true);
        } else {
            assert.fail("Should match DEFINITION");
        }
    });

    void it("OccurrenceKind rejects invalid kinds with helpful error", () => {
        const invalidKind = "write";
        assert.throws(
            () => requireOccurrenceKind(invalidKind, "test context"),
            (error: Error) => {
                assert.ok(error instanceof TypeError);
                assert.ok(error.message.includes("Invalid occurrence kind"));
                assert.ok(error.message.includes('"write"'));
                assert.ok(error.message.includes("test context"));
                assert.ok(error.message.includes("Must be one of: definition, reference"));
                return true;
            }
        );
    });
});
