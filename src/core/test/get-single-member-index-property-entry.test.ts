import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getSingleMemberIndexPropertyEntry } from "../src/ast/node-helpers/index.js";

// Regression coverage: these tests intentionally rely on strict equality helpers to
// confirm the migration away from the deprecated `assert.equal` API preserves the
// existing semantics for member index property detection.

void describe("getSingleMemberIndexPropertyEntry", () => {
    void it("returns null for non-member index expressions", () => {
        assert.strictEqual(getSingleMemberIndexPropertyEntry(null), null);
        assert.strictEqual(getSingleMemberIndexPropertyEntry({ type: "MemberDotExpression" }), null);
    });

    void it("returns null when the property array is missing or has multiple entries", () => {
        assert.strictEqual(
            getSingleMemberIndexPropertyEntry({
                type: "MemberIndexExpression"
            }),
            null
        );

        assert.strictEqual(
            getSingleMemberIndexPropertyEntry({
                type: "MemberIndexExpression",
                property: []
            }),
            null
        );

        assert.strictEqual(
            getSingleMemberIndexPropertyEntry({
                type: "MemberIndexExpression",
                property: [{}, {}]
            }),
            null
        );
    });

    void it("returns the sole property entry when present", () => {
        const propertyNode = { type: "Literal", value: 0 };

        assert.strictEqual(
            getSingleMemberIndexPropertyEntry({
                type: "MemberIndexExpression",
                property: [propertyNode]
            }),
            propertyNode
        );

        assert.strictEqual(
            getSingleMemberIndexPropertyEntry({
                type: "MemberIndexExpression",
                property: ["0"]
            }),
            "0"
        );
    });
});
