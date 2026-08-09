import assert from "node:assert/strict";
import { test } from "node:test";

import { __normalizeDocCommentsRuleTestHelpers__ } from "../../src/rules/gml/rules/normalize-doc-comments-rule.js";

const {
    PendingDocBlockTracker,
    isBlankLine,
    isDocCommentLine,
    isLeadingWhitespace,
    isTextualFunctionAssignmentLine,
    isTextualFunctionLine
} = __normalizeDocCommentsRuleTestHelpers__;

void test("isDocCommentLine recognises triple-slash, legacy double-slash tags, and spaced // / lines", () => {
    assert.equal(isDocCommentLine("/// summary"), true);
    assert.equal(isDocCommentLine("    /// indented doc"), true);
    assert.equal(isDocCommentLine("// @param value"), true);
    assert.equal(isDocCommentLine("// / preserved verbatim"), true);
    assert.equal(isDocCommentLine("function foo() {}"), false);
    assert.equal(isDocCommentLine("// plain comment"), false);
    assert.equal(isDocCommentLine(""), false);
});

void test("isBlankLine accepts empty and whitespace-only lines", () => {
    assert.equal(isBlankLine(""), true);
    assert.equal(isBlankLine("   "), true);
    assert.equal(isBlankLine("\t"), true);
    assert.equal(isBlankLine("// not blank"), false);
    assert.equal(isBlankLine("function foo() {}"), false);
});

void test("isLeadingWhitespace reports only non-empty leading whitespace", () => {
    assert.equal(isLeadingWhitespace("    indented"), true);
    assert.equal(isLeadingWhitespace("\tindented"), true);
    assert.equal(isLeadingWhitespace("top-level"), false);
    assert.equal(isLeadingWhitespace(""), false);
});

void test("isTextualFunctionAssignmentLine matches only the supported assignment shapes", () => {
    assert.equal(isTextualFunctionAssignmentLine("foo = function() {}"), true);
    assert.equal(isTextualFunctionAssignmentLine("var foo = function() {}"), true);
    assert.equal(isTextualFunctionAssignmentLine("static foo = function() {}"), true);
    assert.equal(isTextualFunctionAssignmentLine("    foo = function() {}"), true);
    assert.equal(isTextualFunctionAssignmentLine("obj.foo = function() {}"), true);
    assert.equal(isTextualFunctionAssignmentLine("function foo() {}"), false);
    assert.equal(isTextualFunctionAssignmentLine("// foo = function() {}"), false);
    assert.equal(isTextualFunctionAssignmentLine("var foo = 1"), false);
});

void test("isTextualFunctionLine counts declarations always and assignments only when attached or top-level", () => {
    // Declarations always count.
    assert.equal(isTextualFunctionLine("function foo() {}", false), true);
    assert.equal(isTextualFunctionLine("function foo() {}", true), true);
    assert.equal(isTextualFunctionLine("    function foo() {}", false), true);

    // Attached assignments count regardless of indentation.
    assert.equal(isTextualFunctionLine("    foo = function() {}", true), true);

    // Top-level (un-indented) assignments count.
    assert.equal(isTextualFunctionLine("foo = function() {}", false), true);

    // Indented assignments without a pending block do NOT count.
    assert.equal(isTextualFunctionLine("    foo = function() {}", false), false);
});

void test("PendingDocBlockTracker starts empty and reports no pending block", () => {
    const tracker = new PendingDocBlockTracker();
    assert.equal(tracker.hasPendingDocBlock(), false);
});

void test("PendingDocBlockTracker.appendDocLine accumulates doc lines without flushing", () => {
    const tracker = new PendingDocBlockTracker();
    const output: Array<string> = [];

    tracker.appendDocLine("/// summary", output);
    tracker.appendDocLine("/// @param a", output);

    assert.deepEqual(output, []);
    assert.equal(tracker.hasPendingDocBlock(), true);
});

void test("PendingDocBlockTracker.appendDocLine flushes a prior detached block when gaps appear", () => {
    const tracker = new PendingDocBlockTracker();
    const output: Array<string> = [];

    tracker.appendDocLine("/// orphan", output);
    // A blank gap line is accepted as a gap.
    assert.equal(tracker.appendGapLineIfPending(""), true);
    // A new doc line should flush the prior detached block first, then start fresh.
    tracker.appendDocLine("/// summary", output);

    // The detached block was emitted; the new block is still pending.
    assert.equal(output.length > 0, true);
    assert.equal(tracker.hasPendingDocBlock(), true);
    // The flush detached block uses @description for top-of-file blocks.
    assert.match(output.join("\n"), /@description orphan/);
});

void test("PendingDocBlockTracker.appendGapLineIfPending only accepts blank lines", () => {
    const tracker = new PendingDocBlockTracker();
    const output: Array<string> = [];

    tracker.appendDocLine("/// summary", output);

    // Blank lines are absorbed.
    assert.equal(tracker.appendGapLineIfPending(""), true);
    assert.equal(tracker.appendGapLineIfPending("   "), true);

    // Non-blank lines fall through (so the caller can classify them).
    assert.equal(tracker.appendGapLineIfPending("function foo() {}"), false);
    assert.equal(tracker.appendGapLineIfPending("// comment"), false);
});

void test("PendingDocBlockTracker.consume returns the buffered doc lines and resets state", () => {
    const tracker = new PendingDocBlockTracker();
    const output: Array<string> = [];

    tracker.appendDocLine("/// summary", output);
    tracker.appendDocLine("/// @param a", output);
    assert.equal(tracker.appendGapLineIfPending(""), true);

    const consumed = tracker.consume();

    assert.deepEqual([...consumed.docLines], ["/// summary", "/// @param a"]);
    assert.deepEqual([...consumed.gapLines], [""]);
    assert.equal(tracker.hasPendingDocBlock(), false);

    // A subsequent consume on an empty tracker yields an empty snapshot.
    const emptyConsumed = tracker.consume();
    assert.deepEqual([...emptyConsumed.docLines], []);
    assert.deepEqual([...emptyConsumed.gapLines], []);
});

void test("PendingDocBlockTracker.flush emits a detached block and resets state", () => {
    const tracker = new PendingDocBlockTracker();
    const output: Array<string> = [];

    tracker.appendDocLine("/// summary", output);
    tracker.appendDocLine("/// @param a", output);

    tracker.flush(output, false);

    assert.equal(output.length > 0, true);
    assert.equal(tracker.hasPendingDocBlock(), false);

    // A second flush is a no-op.
    const outputLengthBefore = output.length;
    tracker.flush(output, false);
    assert.equal(output.length, outputLengthBefore);
});

void test("PendingDocBlockTracker.flush on an empty tracker is a no-op", () => {
    const tracker = new PendingDocBlockTracker();
    const output: Array<string> = [];

    tracker.flush(output, false);

    assert.deepEqual(output, []);
    assert.equal(tracker.hasPendingDocBlock(), false);
});
