import assert from "node:assert/strict";
import test from "node:test";

import {
    isLintLevel,
    isLintLevelFilter,
    LINT_LEVEL_LABELS,
    LINT_LEVEL_VALUES,
    LINT_LEVELS,
    parseLintLevel,
    parseLintLevelFilter
} from "../src/app/components/lint-rule-levels.js";

void test("LINT_LEVELS exposes every supported severity in the canonical order", () => {
    assert.deepEqual([...LINT_LEVELS], ["error", "warn", "off"]);
});

void test("LINT_LEVEL_VALUES tracks LINT_LEVELS membership exactly", () => {
    assert.equal(LINT_LEVEL_VALUES.size, LINT_LEVELS.length);
    for (const level of LINT_LEVELS) {
        assert.ok(LINT_LEVEL_VALUES.has(level), `expected LINT_LEVEL_VALUES to contain ${level}`);
    }
});

void test("LINT_LEVEL_LABELS maps every level to a non-empty display label", () => {
    for (const level of LINT_LEVELS) {
        const label = LINT_LEVEL_LABELS[level];
        assert.equal(typeof label, "string");
        assert.ok(label.length > 0, `expected a non-empty label for ${level}`);
    }
    assert.equal(LINT_LEVEL_LABELS.error, "Error");
    assert.equal(LINT_LEVEL_LABELS.warn, "Warn");
    assert.equal(LINT_LEVEL_LABELS.off, "Off");
});

void test("isLintLevel accepts every canonical severity", () => {
    for (const level of LINT_LEVELS) {
        assert.ok(isLintLevel(level), `expected "${level}" to be a valid LintLevel`);
    }
});

void test("isLintLevel rejects lookalike and out-of-vocabulary strings", () => {
    // Common confusion vectors — anything not in the canonical set must fail fast.
    const invalidStrings = [
        "Error", // wrong case
        "ERROR",
        "info", // not a supported severity
        "all", // filter sentinel, not a severity
        "trace",
        "none",
        "err",
        "warning",
        " warn", // leading whitespace
        "warn ",
        "warn\n",
        ""
    ];

    for (const candidate of invalidStrings) {
        assert.equal(isLintLevel(candidate), false, `expected "${candidate}" to be rejected`);
    }
});

void test("isLintLevel rejects non-string values without throwing", () => {
    const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, {}, [], Symbol("warn")];
    for (const candidate of nonStrings) {
        assert.equal(isLintLevel(candidate), false);
    }
});

void test("parseLintLevel returns the validated value for valid input", () => {
    assert.equal(parseLintLevel("error"), "error");
    assert.equal(parseLintLevel("warn"), "warn");
    assert.equal(parseLintLevel("off"), "off");
});

void test("parseLintLevel returns null for invalid input", () => {
    assert.equal(parseLintLevel("INFO"), null);
    assert.equal(parseLintLevel("all"), null);
    assert.equal(parseLintLevel(""), null);
    assert.equal(parseLintLevel(undefined), null);
    assert.equal(parseLintLevel(null), null);
    assert.equal(parseLintLevel(42), null);
});

void test("isLintLevelFilter accepts the sentinel and every canonical severity", () => {
    assert.ok(isLintLevelFilter("all"));
    for (const level of LINT_LEVELS) {
        assert.ok(isLintLevelFilter(level), `expected "${level}" to be a valid LintLevelFilter`);
    }
});

void test("isLintLevelFilter rejects unknown strings and non-strings", () => {
    const invalid = ["All", "ALL", "any", "everything", "error ", " warn", "", null, undefined, 0, {}, []];
    for (const candidate of invalid) {
        assert.equal(isLintLevelFilter(candidate), false, `expected ${JSON.stringify(candidate)} to be rejected`);
    }
});

void test("parseLintLevelFilter round-trips valid input and nulls invalid input", () => {
    assert.equal(parseLintLevelFilter("all"), "all");
    assert.equal(parseLintLevelFilter("error"), "error");
    assert.equal(parseLintLevelFilter("warn"), "warn");
    assert.equal(parseLintLevelFilter("off"), "off");
    assert.equal(parseLintLevelFilter("ALL"), null);
    assert.equal(parseLintLevelFilter("anything-else"), null);
    assert.equal(parseLintLevelFilter(""), null);
    assert.equal(parseLintLevelFilter(undefined), null);
});
