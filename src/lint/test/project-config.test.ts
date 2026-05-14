import assert from "node:assert/strict";
import test from "node:test";

import {
    createLintRuleEntriesFromProjectConfig,
    createLintRuleEntriesFromProjectConfigOrNull,
    normalizeLintRulesConfig,
    normalizeLintRulesConfigOrNull
} from "../src/configs/index.js";

void test("normalizeLintRulesConfig validates and returns rule overrides", () => {
    const rules = normalizeLintRulesConfig({
        lintRules: {
            "gml/no-globalvar": "error",
            "feather/gm1000": "warn"
        }
    });

    assert.deepEqual(rules, {
        "gml/no-globalvar": "error",
        "feather/gm1000": "warn"
    });
});

void test("normalizeLintRulesConfig rejects malformed lintRules", () => {
    assert.throws(() => normalizeLintRulesConfig({ lintRules: [] }), {
        name: "TypeError",
        message: "gmloop.json lintRules must be an object."
    });
});

void test("normalizeLintRulesConfig supports lintRuleset preset names", () => {
    const rules = normalizeLintRulesConfig({
        lintRuleset: "recommended"
    });

    assert.equal(rules["gml/no-scientific-notation"], "error");
    assert.equal(rules["gml/prefer-hoistable-loop-accessors"], "warn");
    assert.equal(rules["feather/gm1003"], "warn");
});

void test("normalizeLintRulesConfig merges lintRuleset with explicit lintRules overrides", () => {
    const rules = normalizeLintRulesConfig({
        lintRuleset: "recommended",
        lintRules: {
            "gml/no-globalvar": "error",
            "feather/gm1003": "off"
        }
    });

    assert.equal(rules["gml/no-globalvar"], "error");
    assert.equal(rules["feather/gm1003"], "off");
    assert.equal(rules["gml/no-scientific-notation"], "error");
});

void test("normalizeLintRulesConfig rejects invalid lintRuleset values", () => {
    assert.throws(() => normalizeLintRulesConfig({ lintRuleset: "all" }), {
        name: "TypeError",
        message: "gmloop.json lintRuleset must be one of recommended, feather, performance."
    });
});

void test("normalizeLintRulesConfig rejects non-string lintRuleset values", () => {
    assert.throws(() => normalizeLintRulesConfig({ lintRuleset: 123 as unknown as string }), {
        name: "TypeError",
        message: "gmloop.json lintRuleset must be one of recommended, feather, performance."
    });
});

void test("createLintRuleEntriesFromProjectConfig builds enabled rule entries", () => {
    const ruleEntries = createLintRuleEntriesFromProjectConfig({
        lintRules: {
            "gml/no-globalvar": "error"
        }
    });

    assert.deepEqual(ruleEntries, {
        "gml/no-globalvar": "error"
    });
});

void test("createLintRuleEntriesFromProjectConfig includes enabled preset rules", () => {
    const ruleEntries = createLintRuleEntriesFromProjectConfig({
        lintRuleset: "performance"
    });

    assert.equal(ruleEntries["gml/no-globalvar"], "warn");
    assert.equal("gml/prefer-string-interpolation" in ruleEntries, false);
});

void test("createLintRuleEntriesFromProjectConfig passes matching top-level rule options", () => {
    const ruleEntries = createLintRuleEntriesFromProjectConfig({
        lintRules: {
            "gml/prefer-hoistable-loop-accessors": "warn"
        },
        minOccurrences: 3,
        functionSuffixes: {
            array_length: "count"
        },
        ignoredTopLevelKey: true
    });

    assert.deepEqual(ruleEntries, {
        "gml/prefer-hoistable-loop-accessors": [
            "warn",
            {
                minOccurrences: 3,
                functionSuffixes: {
                    array_length: "count"
                }
            }
        ]
    });
});

void test("createLintRuleEntriesFromProjectConfig ignores top-level options for unknown plugin rules", () => {
    const unknownRuleEntries = createLintRuleEntriesFromProjectConfig({
        lintRules: {
            "unknown/some-rule": "warn"
        },
        minOccurrences: 4
    });

    assert.deepEqual(unknownRuleEntries, {
        "unknown/some-rule": "warn"
    });
});

void test("normalizeLintRulesConfigOrNull returns null for malformed lintRules", () => {
    const result = normalizeLintRulesConfigOrNull({ lintRules: [] });
    assert.equal(result, null);
});

void test("normalizeLintRulesConfigOrNull returns null for invalid lintRuleset", () => {
    const result = normalizeLintRulesConfigOrNull({ lintRuleset: "all" });
    assert.equal(result, null);
});

void test("normalizeLintRulesConfigOrNull returns null for non-string lintRuleset", () => {
    const result = normalizeLintRulesConfigOrNull({ lintRuleset: 123 as unknown as string });
    assert.equal(result, null);
});

void test("normalizeLintRulesConfigOrNull returns valid rules for correct config", () => {
    const result = normalizeLintRulesConfigOrNull({
        lintRules: {
            "gml/no-globalvar": "error"
        }
    });
    assert.deepEqual(result, {
        "gml/no-globalvar": "error"
    });
});

void test("createLintRuleEntriesFromProjectConfigOrNull returns null for malformed lintRules", () => {
    const result = createLintRuleEntriesFromProjectConfigOrNull({ lintRules: [] });
    assert.equal(result, null);
});

void test("createLintRuleEntriesFromProjectConfigOrNull returns null for invalid lintRuleset", () => {
    const result = createLintRuleEntriesFromProjectConfigOrNull({ lintRuleset: "all" });
    assert.equal(result, null);
});

void test("createLintRuleEntriesFromProjectConfigOrNull returns valid entries for correct config", () => {
    const result = createLintRuleEntriesFromProjectConfigOrNull({
        lintRules: {
            "gml/no-globalvar": "error"
        }
    });
    assert.deepEqual(result, {
        "gml/no-globalvar": "error"
    });
});
