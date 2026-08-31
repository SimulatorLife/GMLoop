import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDocCommentTagAliasLine } from "../../src/doc-comment/tag-aliases.js";

void test("normalizeDocCommentTagAliasLine rewrites singular @arg to @param", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @arg alpha - first input"),
        "/// @param alpha - first input"
    );
});

void test("normalizeDocCommentTagAliasLine rewrites @argument and @params to @param", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @argument alpha"),
        "/// @param alpha"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @params alpha"),
        "/// @param alpha"
    );
});

void test("normalizeDocCommentTagAliasLine rewrites @exception/@throw to @throws", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @exception description"),
        "/// @throws description"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @throw description"),
        "/// @throws description"
    );
});

void test("normalizeDocCommentTagAliasLine rewrites @hidden/@hide/@private to @ignore", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @hidden internal helper"),
        "/// @ignore internal helper"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @hide internal helper"),
        "/// @ignore internal helper"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @private"),
        "/// @ignore"
    );
});

void test("normalizeDocCommentTagAliasLine rewrites @output/@outputs/@return/@yield/@yields to @returns", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @output {real}"),
        "/// @returns {real}"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @outputs {real}"),
        "/// @returns {real}"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @return {real}"),
        "/// @returns {real}"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @yield {real}"),
        "/// @returns {real}"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @yields {real}"),
        "/// @returns {real}"
    );
});

void test("normalizeDocCommentTagAliasLine rewrites common misspellings of @override", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @overide"),
        "/// @override"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @overidden"),
        "/// @override"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @overridden"),
        "/// @override"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @overrides"),
        "/// @override"
    );
});

void test("normalizeDocCommentTagAliasLine is case-insensitive on the alias token", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @ARG alpha"),
        "/// @param alpha"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @Return {real}"),
        "/// @returns {real}"
    );
});

void test("normalizeDocCommentTagAliasLine preserves leading indentation", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("    /// @arg alpha"),
        "    /// @param alpha"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("\t/// @return {real}"),
        "\t/// @returns {real}"
    );
});

void test("normalizeDocCommentTagAliasLine leaves unknown tags untouched", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @description description text"),
        "/// @description description text"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @function demo"),
        "/// @function demo"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @func demo"),
        "/// @func demo"
    );
});

void test("normalizeDocCommentTagAliasLine leaves non-doc-comment lines untouched", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("// @arg alpha"),
        "// @arg alpha"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("// @return {real}"),
        "// @return {real}"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine("var arg = 0;"),
        "var arg = 0;"
    );
    assert.equal(
        normalizeDocCommentTagAliasLine(""),
        ""
    );
});

void test("normalizeDocCommentTagAliasLine only rewrites the leading tag, not trailing mentions", () => {
    assert.equal(
        normalizeDocCommentTagAliasLine("/// @description uses an @arg style marker inline"),
        "/// @description uses an @arg style marker inline"
    );
});
