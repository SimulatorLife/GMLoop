import assert from "node:assert/strict";
import test from "node:test";

import { hasCommentImmediatelyBefore, isDocLikeLeadingLine } from "../../src/doc-comment/index.js";

void test("isDocLikeLeadingLine recognizes doc-like prefixes", () => {
    assert.equal(isDocLikeLeadingLine("/// @param value"), true);
    assert.equal(isDocLikeLeadingLine("// / @description details"), true);
    assert.equal(isDocLikeLeadingLine("// ordinary comment"), false);
});

void test("hasCommentImmediatelyBefore detects immediate preceding comments", () => {
    const source = "/// @description details\nfoo();";
    const expressionIndex = source.indexOf("foo");
    assert.equal(expressionIndex > 0, true);
    assert.equal(hasCommentImmediatelyBefore(source, expressionIndex), true);
});

void test("hasCommentImmediatelyBefore ignores non-comment preceding text", () => {
    const source = "let value = 1;\nfoo();";
    const expressionIndex = source.indexOf("foo");
    assert.equal(expressionIndex > 0, true);
    assert.equal(hasCommentImmediatelyBefore(source, expressionIndex), false);
});
