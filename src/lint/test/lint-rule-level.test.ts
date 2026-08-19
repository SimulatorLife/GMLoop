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

const VALID_LEVELS = ["off", "warn", "error"] as const;

function assertInvalidLevelError(error: unknown, received: unknown): true {
    assert.ok(error instanceof Error, "expected an Error to be thrown for an invalid level");

    const { message } = error;
    assert.ok(
        message.includes(JSON.stringify(received)),
        `error message must mention the received value ${JSON.stringify(received)}; got: ${message}`
    );

    for (const level of VALID_LEVELS) {
        assert.ok(
            message.includes(level),
            `error message must list valid level ${JSON.stringify(level)} for users to recover; got: ${message}`
        );
    }

    return true;
}

function assertValidLevelsListed(message: string): void {
    for (const level of VALID_LEVELS) {
        assert.ok(
            message.includes(level),
            `error message must list valid level ${JSON.stringify(level)} for users to recover; got: ${message}`
        );
    }
}

void test("LintRuleLevel exposes the three documented severity values", () => {
    // The contract is "the valid levels are these three strings"; the enum
    // key names are an implementation detail that should not leak into the
    // public contract.
    assert.deepEqual([...getLintRuleLevelValues()].toSorted(), ["error", "off", "warn"]);
});

void test("isLintRuleLevel accepts every valid level", () => {
    for (const level of VALID_LEVELS) {
        assert.equal(isLintRuleLevel(level), true, `isLintRuleLevel must accept ${level}`);
    }
});

void test("isLintRuleLevel rejects strings outside the documented level set", () => {
    for (const candidate of ["", "none", "warning", "ERROR", "Off", "all"]) {
        assert.equal(isLintRuleLevel(candidate), false, `isLintRuleLevel must reject ${JSON.stringify(candidate)}`);
    }
});

void test("isLintRuleLevel rejects non-string inputs", () => {
    for (const candidate of [42, null, undefined, {}, [], true]) {
        assert.equal(isLintRuleLevel(candidate), false, `isLintRuleLevel must reject ${typeof candidate} values`);
    }
});

void test("normalizeLintRuleLevel returns the canonical form for valid levels", () => {
    for (const level of VALID_LEVELS) {
        assert.equal(normalizeLintRuleLevel(level), level);
    }
});

void test("normalizeLintRuleLevel throws an error that names the invalid value and the valid alternatives", () => {
    for (const candidate of ["invalid", "", "warning"]) {
        assert.throws(
            () => normalizeLintRuleLevel(candidate),
            (error: unknown) => assertInvalidLevelError(error, candidate)
        );
    }
});

void test("normalizeLintRuleLevel throws TypeError for non-string inputs", () => {
    for (const candidate of [42, null, undefined]) {
        assert.throws(() => normalizeLintRuleLevel(candidate), TypeError);
    }
});

void test("normalizeLintRuleLevelWithFallback returns the default for invalid values", () => {
    assert.equal(normalizeLintRuleLevelWithFallback("invalid"), LintRuleLevel.OFF);
    assert.equal(normalizeLintRuleLevelWithFallback("invalid", LintRuleLevel.ERROR), LintRuleLevel.ERROR);
});

void test("normalizeLintRuleLevelWithFallback returns the input verbatim for valid levels", () => {
    for (const level of VALID_LEVELS) {
        assert.equal(normalizeLintRuleLevelWithFallback(level), level);
    }
});

void test("getLintRuleLevelValues returns every valid level exactly once", () => {
    const values = getLintRuleLevelValues();

    assert.equal(values.length, VALID_LEVELS.length, "getLintRuleLevelValues must not duplicate levels");
    for (const level of VALID_LEVELS) {
        assert.ok(values.includes(level), `getLintRuleLevelValues must include ${level}`);
    }
});

void test("formatLintRuleLevelList returns a string that names every valid level", () => {
    const formatted = formatLintRuleLevelList();

    assert.ok(
        typeof formatted === "string" && formatted.length > 0,
        "formatLintRuleLevelList must return a non-empty string suitable for error messages"
    );

    for (const level of VALID_LEVELS) {
        assert.ok(
            formatted.includes(level),
            `formatLintRuleLevelList must surface the valid level ${JSON.stringify(level)}; got: ${formatted}`
        );
    }
});

void test("formatLintRuleLevelList omits tokens that are not valid levels", () => {
    const formatted = formatLintRuleLevelList();

    for (const invalid of ["warning", "severe", "all"]) {
        assert.ok(
            !formatted.includes(invalid),
            `formatLintRuleLevelList must not advertise ${JSON.stringify(invalid)} as a valid level; got: ${formatted}`
        );
    }
});

void test("formatLintRuleLevelList can be split back into the valid level set", () => {
    // The function is consumed by error messages that need to list valid
    // options; the contract is that the output is recoverable so callers can
    // re-parse or display the entries without depending on the exact
    // separator.
    const formatted = formatLintRuleLevelList();
    const tokens = formatted
        .split(/[\s,]+/u)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);

    assert.deepEqual([...tokens].toSorted(), [...VALID_LEVELS].toSorted());
});

void test("normalizeLintRulesConfig rejects invalid lint rule levels with a descriptive error", () => {
    assert.throws(
        () =>
            normalizeLintRulesConfig({
                lintRules: {
                    "gml/no-globalvar": "invalid-level"
                }
            }),
        (error: unknown) => {
            assert.ok(error instanceof TypeError, "config validation must throw a TypeError");
            const { message } = error;
            assert.ok(
                message.includes("gml/no-globalvar"),
                "error message must identify the offending rule id so users can locate the problem"
            );
            assertValidLevelsListed(message);
            return true;
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
        TypeError
    );
});
