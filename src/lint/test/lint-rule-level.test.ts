import assert from "node:assert/strict";
import test from "node:test";

import {
    formatLintRuleLevelList,
    getLintRuleLevelValues,
    isLintRuleLevel,
    LintRuleLevel,
    normalizeLintRuleLevel,
    normalizeLintRuleLevelWithFallback
} from "../src/configs/lint-rule-level.js";
import { normalizeLintRulesConfig } from "../src/configs/project-config.js";

void test("LintRuleLevel enum has expected values", () => {
    assert.equal(LintRuleLevel.OFF, "off");
    assert.equal(LintRuleLevel.WARN, "warn");
    assert.equal(LintRuleLevel.ERROR, "error");
});

void test("isLintRuleLevel returns true for valid levels", () => {
    assert.equal(isLintRuleLevel("off"), true);
    assert.equal(isLintRuleLevel("warn"), true);
    assert.equal(isLintRuleLevel("error"), true);
    assert.equal(isLintRuleLevel(LintRuleLevel.OFF), true);
    assert.equal(isLintRuleLevel(LintRuleLevel.WARN), true);
    assert.equal(isLintRuleLevel(LintRuleLevel.ERROR), true);
});

void test("isLintRuleLevel returns false for invalid strings", () => {
    assert.equal(isLintRuleLevel(""), false);
    assert.equal(isLintRuleLevel("none"), false);
    assert.equal(isLintRuleLevel("warning"), false);
    assert.equal(isLintRuleLevel("ERROR"), false);
    assert.equal(isLintRuleLevel("Off"), false);
});

void test("isLintRuleLevel returns false for non-string types", () => {
    assert.equal(isLintRuleLevel(42), false);
    assert.equal(isLintRuleLevel(null), false);
    assert.equal(isLintRuleLevel(undefined), false);
    assert.equal(isLintRuleLevel({}), false);
    assert.equal(isLintRuleLevel([]), false);
});

void test("normalizeLintRuleLevel returns valid values as-is", () => {
    assert.equal(normalizeLintRuleLevel("off"), "off");
    assert.equal(normalizeLintRuleLevel("warn"), "warn");
    assert.equal(normalizeLintRuleLevel("error"), "error");
});

void test("normalizeLintRuleLevel throws for invalid values", () => {
    assert.throws(() => normalizeLintRuleLevel("invalid"), {
        name: "Error",
        message: /Lint rule level must be one of/
    });
    assert.throws(() => normalizeLintRuleLevel(""), {
        name: "Error",
        message: /Lint rule level must be one of/
    });
});

void test("normalizeLintRuleLevel throws TypeError for non-string input", () => {
    assert.throws(() => normalizeLintRuleLevel(42), {
        name: "TypeError"
    });
    assert.throws(() => normalizeLintRuleLevel(null), {
        name: "TypeError"
    });
    assert.throws(() => normalizeLintRuleLevel(undefined), {
        name: "TypeError"
    });
});

void test("normalizeLintRuleLevelWithFallback returns fallback for invalid values", () => {
    assert.equal(normalizeLintRuleLevelWithFallback("invalid"), "off");
    assert.equal(normalizeLintRuleLevelWithFallback("invalid", LintRuleLevel.ERROR), "error");
});

void test("normalizeLintRuleLevelWithFallback returns valid values as-is", () => {
    assert.equal(normalizeLintRuleLevelWithFallback("off"), "off");
    assert.equal(normalizeLintRuleLevelWithFallback("warn"), "warn");
    assert.equal(normalizeLintRuleLevelWithFallback("error"), "error");
});

void test("getLintRuleLevelValues returns all valid levels", () => {
    const values = getLintRuleLevelValues();
    assert.deepEqual(values, ["off", "warn", "error"]);
});

void test("formatLintRuleLevelList returns comma-separated list", () => {
    const formatted = formatLintRuleLevelList();
    // formatLintRuleLevelList returns alphabetically sorted values
    assert.equal(formatted, "error, off, warn");
});

void test("normalizeLintRulesConfig rejects invalid lint rule levels", () => {
    assert.throws(
        () =>
            normalizeLintRulesConfig({
                lintRules: {
                    "gml/no-globalvar": "invalid-level"
                }
            }),
        {
            name: "TypeError",
            message: /gmloop\.json lintRules\.gml\/no-globalvar must be one of off, warn, error/
        }
    );
});

void test("normalizeLintRulesConfig rejects non-string lint rule levels", () => {
    assert.throws(
        () =>
            normalizeLintRulesConfig({
                lintRules: {
                    "gml/no-globalvar": 42 as unknown as string
                }
            }),
        {
            name: "TypeError"
        }
    );
});
