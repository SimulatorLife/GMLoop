import assert from "node:assert/strict";
import test from "node:test";

import { listLintRuleCatalogEntries } from "../src/rules/rule-catalog.js";

void test("listLintRuleCatalogEntries exposes built-in rule descriptions and schemas", () => {
    const entries = listLintRuleCatalogEntries();

    const noGlobalvarRule = entries.find((entry) => entry.ruleId === "gml/no-globalvar");
    assert.ok(noGlobalvarRule);
    assert.equal(typeof noGlobalvarRule.description, "string");
    assert.equal(
        noGlobalvarRule.description,
        "Report legacy globalvar declarations that require a project-aware migration."
    );
    assert.equal(Array.isArray(noGlobalvarRule.schema), true);

    const assignmentRule = entries.find((entry) => entry.ruleId === "gml/no-assignment-in-condition");
    assert.ok(assignmentRule);
    assert.equal(
        assignmentRule.description,
        "Report assignments used inside conditions, where equality checks are usually intended."
    );

    for (const entry of entries.filter((ruleEntry) => ruleEntry.ruleId.startsWith("gml/"))) {
        assert.doesNotMatch(entry.description, /^Rule for /u);
    }

    const featherRule = entries.find((entry) => entry.ruleId.startsWith("feather/gm"));
    assert.ok(featherRule);
});
