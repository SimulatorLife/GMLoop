import assert from "node:assert/strict";
import test from "node:test";

import { escapeRegExp, isGmlIdentifierName } from "../src/utils/regexp.js";

void test("escapeRegExp escapes special characters", () => {
    assert.equal(escapeRegExp(".*?^${}"), String.raw`\.\*\?\^\$\{\}`);
    assert.equal(escapeRegExp("Hello"), "Hello");
    assert.equal(escapeRegExp("path/[segment]"), String.raw`path/\[segment\]`);
});

void test("escapeRegExp returns empty string for non-string input", () => {
    assert.equal(escapeRegExp(), "");
    assert.equal(escapeRegExp(null), "");
    assert.equal(escapeRegExp(42), "");
});

void test("isGmlIdentifierName accepts valid GML identifiers", () => {
    assert.equal(isGmlIdentifierName("foo"), true);
    assert.equal(isGmlIdentifierName("_bar"), true);
    assert.equal(isGmlIdentifierName("Baz123"), true);
    assert.equal(isGmlIdentifierName("__private"), true);
    assert.equal(isGmlIdentifierName("obj_player"), true);
    assert.equal(isGmlIdentifierName("A"), true);
});

void test("isGmlIdentifierName rejects invalid GML identifiers", () => {
    assert.equal(isGmlIdentifierName("123abc"), false);
    assert.equal(isGmlIdentifierName("my-var"), false);
    assert.equal(isGmlIdentifierName("my var"), false);
    assert.equal(isGmlIdentifierName(""), false);
    assert.equal(isGmlIdentifierName("a.b"), false);
    assert.equal(isGmlIdentifierName("$dollar"), false);
});
