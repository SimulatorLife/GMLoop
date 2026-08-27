import assert from "node:assert/strict";
import test from "node:test";

import {
    formatKnownScopeOverrideKeywords,
    isScopeOverrideKeyword,
    SCOPE_OVERRIDE_KEYWORD
} from "../src/scopes/scope-override-keywords.js";

void test("SCOPE_OVERRIDE_KEYWORD is the literal 'global'", () => {
    assert.strictEqual(SCOPE_OVERRIDE_KEYWORD, "global");
});

void test("isScopeOverrideKeyword accepts the canonical keyword", () => {
    assert.strictEqual(isScopeOverrideKeyword(SCOPE_OVERRIDE_KEYWORD), true);
});

void test("isScopeOverrideKeyword rejects unrelated strings", () => {
    assert.strictEqual(isScopeOverrideKeyword("root"), false);
    assert.strictEqual(isScopeOverrideKeyword(""), false);
    assert.strictEqual(isScopeOverrideKeyword("GLOBAL"), false);
});

void test("isScopeOverrideKeyword rejects non-string inputs", () => {
    assert.strictEqual(isScopeOverrideKeyword(null), false);
    assert.strictEqual(isScopeOverrideKeyword(undefined), false);
    assert.strictEqual(isScopeOverrideKeyword(0), false);
    assert.strictEqual(isScopeOverrideKeyword({}), false);
    assert.strictEqual(isScopeOverrideKeyword(["global"]), false);
});

void test("formatKnownScopeOverrideKeywords returns the keyword list as an array", () => {
    const keywords = formatKnownScopeOverrideKeywords();

    assert.ok(Array.isArray(keywords));
    assert.deepStrictEqual(keywords, [SCOPE_OVERRIDE_KEYWORD]);
});

void test("formatKnownScopeOverrideKeywords joins cleanly into a human-readable list", () => {
    const rendered = formatKnownScopeOverrideKeywords().join(", ");

    assert.strictEqual(rendered, "global");
});
