import assert from "node:assert/strict";
import test from "node:test";

import { createMeta } from "../../src/rules/gml/rule-base-helpers.js";

void test("createMeta uses the default empty-object schema when a rule definition omits schema", () => {
    const meta = createMeta({
        mapKey: "GmlTestDefaultSchema",
        shortName: "test-default-schema",
        fullId: "gml/test-default-schema",
        messageId: "testDefaultSchema"
    });

    assert.deepEqual(meta.schema, [{ type: "object", additionalProperties: false, properties: {} }]);
});

void test("createMeta preserves explicit rule schemas", () => {
    const explicitSchema = Object.freeze([
        {
            type: "object",
            additionalProperties: false,
            properties: {
                enabled: { type: "boolean", default: true }
            }
        }
    ]);

    const meta = createMeta({
        mapKey: "GmlTestExplicitSchema",
        shortName: "test-explicit-schema",
        fullId: "gml/test-explicit-schema",
        messageId: "testExplicitSchema",
        schema: explicitSchema
    });

    assert.strictEqual(meta.schema, explicitSchema);
});
