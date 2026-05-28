import assert from "node:assert/strict";
import test from "node:test";

import { listLintRuleCatalogEntries } from "../src/rules/rule-catalog.js";

void test("listLintRuleCatalogEntries exposes built-in rule descriptions and schemas", () => {
    const entries = listLintRuleCatalogEntries();

    const noGlobalvarRule = entries.find((entry) => entry.ruleId === "gml/no-globalvar");
    assert.ok(noGlobalvarRule);
    assert.equal(typeof noGlobalvarRule.description, "string");
    assert.equal(Array.isArray(noGlobalvarRule.schema), true);

    const featherRule = entries.find((entry) => entry.ruleId.startsWith("feather/gm"));
    assert.ok(featherRule);
});
