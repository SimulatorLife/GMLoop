/**
 * Unit tests for the `tryResolveUndefinedCheckRewrite` helper extracted from
 * the `gml/prefer-is-undefined-check` rule.
 *
 * The helper is the shared policy layer that detects an `undefined`
 * comparison (in either AST shape: a direct `BinaryExpression` or a
 * `UnaryExpression(!)` wrapping one) and resolves the `is_undefined(...)`
 * rewrite. These tests pin down the polarity and the source-text
 * `!(...)` wrapper detection so the rewrite can be reasoned about
 * independently from the ESLint visitor machinery.
 *
 * Position convention: the AST nodes' `start.index` is the position of the
 * first character; `end.index` is the position of the **last** character
 * (inclusive). `Core.getNodeStartIndex` returns `start.index` as-is, and
 * `Core.getNodeEndIndex` returns `end.index + 1` (one past the end) so the
 * returned values are usable as `String.prototype.slice` bounds directly.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { tryResolveUndefinedCheckRewrite } from "../../src/rules/gml/rules/prefer-is-undefined-check-rule.js";

function makeBinaryNode(operator: "==" | "!=", left: unknown, right: unknown, start: number, end: number) {
    return { type: "BinaryExpression", operator, left, right, start: { index: start }, end: { index: end } };
}

function makeUnaryNode(operator: "!", argument: unknown, start: number, end: number) {
    return { type: "UnaryExpression", operator, argument, start: { index: start }, end: { index: end } };
}

function makeIdentifier(name: string, start: number, end: number) {
    return { type: "Identifier", name, start: { index: start }, end: { index: end } };
}

void test("tryResolveUndefinedCheckRewrite rewrites `x == undefined` to positive form", () => {
    // Positions:  s c o r e   = =   u n d e f i n e d
    // Index:      0 1 2 3 4 5 6 7 8 9 ...
    //             score  → 0..4, undefined → 9..17
    const sourceText = "score == undefined";
    const otherSide = makeIdentifier("score", 0, 4);
    const binary = makeBinaryNode("==", otherSide, makeIdentifier("undefined", 9, 17), 0, 17);

    const rewrite = tryResolveUndefinedCheckRewrite(binary, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 18],
        replacement: "is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite rewrites `x != undefined` to negated form", () => {
    const sourceText = "score != undefined";
    const otherSide = makeIdentifier("score", 0, 4);
    const binary = makeBinaryNode("!=", otherSide, makeIdentifier("undefined", 9, 17), 0, 17);

    const rewrite = tryResolveUndefinedCheckRewrite(binary, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 18],
        replacement: "!is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite swaps the operand on the other side", () => {
    // Source: `undefined == lives`  — `lives` is on the right.
    const sourceText = "undefined == lives";
    const otherSide = makeIdentifier("lives", 13, 17);
    const binary = makeBinaryNode("==", makeIdentifier("undefined", 0, 8), otherSide, 0, 17);

    const rewrite = tryResolveUndefinedCheckRewrite(binary, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 18],
        replacement: "is_undefined(lives)"
    });
});

void test("tryResolveUndefinedCheckRewrite detects a text-level `!(...)` wrapper around a bare binary", () => {
    // Source: `!(score == undefined)` — no AST UnaryExpression, just the
    // `!(` prefix and `)` suffix in the source text. The helper must treat
    // it as externally negated and widen the range to cover the wrapper.
    // Positions:  ! (   s c o r e   = =   u n d e f i n e d )
    // Index:      0 1   2 3 4 5 6 7 8 9 ...
    //             score      → 2..6, undefined → 11..19, wrapper → 0..21
    const sourceText = "!(score == undefined)";
    const otherSide = makeIdentifier("score", 2, 6);
    const binary = makeBinaryNode("==", otherSide, makeIdentifier("undefined", 11, 19), 2, 19);

    const rewrite = tryResolveUndefinedCheckRewrite(binary, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 21],
        replacement: "!is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite recognises an AST UnaryExpression wrapper and uses its range", () => {
    const sourceText = "!(score == undefined)";
    const otherSide = makeIdentifier("score", 2, 6);
    const binary = makeBinaryNode("==", otherSide, makeIdentifier("undefined", 11, 19), 2, 19);
    const unary = makeUnaryNode("!", binary, 0, 20);

    const rewrite = tryResolveUndefinedCheckRewrite(unary, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 21],
        replacement: "!is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite cancels a text wrapper when the operator is `!=`", () => {
    // Source: `!(score != undefined)` — the `!=` flips to "is defined" and
    // the outer `!` flips it back, so the rewrite is the positive form.
    const sourceText = "!(score != undefined)";
    const otherSide = makeIdentifier("score", 2, 6);
    const binary = makeBinaryNode("!=", otherSide, makeIdentifier("undefined", 11, 19), 2, 19);

    const rewrite = tryResolveUndefinedCheckRewrite(binary, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 21],
        replacement: "is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite returns null for non-comparison nodes", () => {
    const sourceText = "score + 1";
    const binary = {
        type: "BinaryExpression",
        operator: "+",
        left: makeIdentifier("score", 0, 4),
        right: { type: "Literal", value: "1", start: { index: 8 }, end: { index: 8 } },
        start: { index: 0 },
        end: { index: 8 }
    };

    assert.strictEqual(tryResolveUndefinedCheckRewrite(binary, sourceText), null);
});

void test("tryResolveUndefinedCheckRewrite returns null when neither side is `undefined`", () => {
    const sourceText = "score == lives";
    const binary = makeBinaryNode("==", makeIdentifier("score", 0, 4), makeIdentifier("lives", 9, 13), 0, 13);

    assert.strictEqual(tryResolveUndefinedCheckRewrite(binary, sourceText), null);
});

void test("tryResolveUndefinedCheckRewrite returns null for a `!` whose argument is not a comparison", () => {
    const sourceText = "!score";
    const unary = makeUnaryNode("!", makeIdentifier("score", 1, 5), 0, 5);

    assert.strictEqual(tryResolveUndefinedCheckRewrite(unary, sourceText), null);
});
