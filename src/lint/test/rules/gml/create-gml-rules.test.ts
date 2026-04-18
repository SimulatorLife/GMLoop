import assert from "node:assert/strict";
import test from "node:test";

import { gmlRuleDefinitions } from "../../../src/rules/catalog.js";
import { createGmlRule } from "../../../src/rules/gml/create-gml-rules.js";

void test("createGmlRule resolves every configured GML rule definition", () => {
    for (const definition of gmlRuleDefinitions) {
        const rule = createGmlRule(definition);
        assert.equal(typeof rule.create, "function");
        assert.equal(typeof rule.meta, "object");
        assert.notEqual(rule.meta, null);
    }
});

void test("createGmlRule throws for unknown shortName values", () => {
    const unknownDefinition = Object.freeze({
        mapKey: "GmlUnknownRule",
        shortName: "unknown-rule",
        fullId: "gml/unknown-rule",
        messageId: "unknownRule"
    });

    assert.throws(
        () => createGmlRule(unknownDefinition),
        /Missing gml rule implementation for shortName 'unknown-rule'/
    );
});
