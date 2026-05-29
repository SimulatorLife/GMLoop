import assert from "node:assert/strict";
import { test } from "node:test";

// Node.js deprecated the loose equality helpers (e.g. `assert.equal`) in the
// `node:assert` module. This test suite migrates to the /strict subpath and
// strict helpers (`assert.strictEqual`, `assert.deepStrictEqual`) for
// value- and type-exact comparisons. Behaviour parity with the original calls
// is validated via: pnpm test src/core/test/regexp.test.js
import { escapeRegExp, isGmlIdentifierName } from "../src/utils/regexp.js";

void test("escapeRegExp escapes special characters", () => {
    assert.strictEqual(escapeRegExp(".*?^${}"), String.raw`\.\*\?\^\$\{\}`);
    assert.strictEqual(escapeRegExp("Hello"), "Hello");
    assert.strictEqual(escapeRegExp("path/[segment]"), String.raw`path/\[segment\]`);
});

void test("escapeRegExp returns empty string for non-string input", () => {
    assert.strictEqual(escapeRegExp(), "");
    assert.strictEqual(escapeRegExp(null), "");
    assert.strictEqual(escapeRegExp(42), "");
});

void test("isGmlIdentifierName accepts valid GML identifiers", () => {
    assert.strictEqual(isGmlIdentifierName("foo"), true);
    assert.strictEqual(isGmlIdentifierName("_bar"), true);
    assert.strictEqual(isGmlIdentifierName("Baz123"), true);
    assert.strictEqual(isGmlIdentifierName("__private"), true);
    assert.strictEqual(isGmlIdentifierName("obj_player"), true);
    assert.strictEqual(isGmlIdentifierName("A"), true);
});

void test("isGmlIdentifierName rejects invalid GML identifiers", () => {
    assert.strictEqual(isGmlIdentifierName("123abc"), false);
    assert.strictEqual(isGmlIdentifierName("my-var"), false);
    assert.strictEqual(isGmlIdentifierName("my var"), false);
    assert.strictEqual(isGmlIdentifierName(""), false);
    assert.strictEqual(isGmlIdentifierName("a.b"), false);
    assert.strictEqual(isGmlIdentifierName("$dollar"), false);
});
