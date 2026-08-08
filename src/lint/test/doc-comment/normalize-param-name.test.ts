import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDocParamName } from "../../src/doc-comment/normalize-param-name.js";

void test("normalizeDocParamName strips the by-reference `*` prefix", () => {
    assert.equal(normalizeDocParamName("*value"), "value");
    assert.equal(normalizeDocParamName("*func_fx_callback"), "func_fx_callback");
});

void test("normalizeDocParamName strips the private `_` prefix", () => {
    assert.equal(normalizeDocParamName("_value"), "value");
    assert.equal(normalizeDocParamName("__count"), "count");
});

void test("normalizeDocParamName strips mixed `*` and `_` prefix runs", () => {
    assert.equal(normalizeDocParamName("*_internal"), "internal");
    assert.equal(normalizeDocParamName("**_still_internal"), "still_internal");
    assert.equal(normalizeDocParamName("_*also_internal"), "also_internal");
});

void test("normalizeDocParamName leaves plain identifiers untouched", () => {
    assert.equal(normalizeDocParamName("items"), "items");
    assert.equal(normalizeDocParamName("value42"), "value42");
    assert.equal(normalizeDocParamName(""), "");
});

void test("normalizeDocParamName only strips prefixes, never internal characters", () => {
    assert.equal(normalizeDocParamName("*name_with_underscore"), "name_with_underscore");
    assert.equal(normalizeDocParamName("_name*with*asterisk"), "name*with*asterisk");
});
