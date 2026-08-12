/**
 * Unit tests for the `tryResolveUndefinedCheckRewrite` helper extracted from
 * the `gml/prefer-is-undefined-check` rule.
 *
 * The helper is the shared policy layer that detects an `undefined`
 * comparison and resolves the `is_undefined(...)` rewrite. Three AST shapes
 * surface the same comparison: a direct `BinaryExpression`, a
 * `UnaryExpression(!)` wrapping one, and a `CallExpression` whose callee is
 * the `!` identifier wrapping one — the GML parser represents `!(...)` as
 * the latter (a call to `!`) rather than as a `UnaryExpression`, so that
 * shape is how the wrapper actually arrives from real source text. These
 * tests pin down the polarity and the AST-based (parent-link) wrapper
 * detection so the rewrite can be reasoned about independently from the
 * ESLint visitor machinery.
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

/**
 * Builds the `CallExpression` shape the GML parser actually produces for
 * `!(...)` — a call whose callee is the `!` identifier and whose sole
 * argument is the wrapped expression — and links `argument.parent` back to
 * it so the helper's parent-chain lookup can find it.
 */
function makeNotCallNode(argument: Record<string, unknown>, start: number, end: number) {
    const node = {
        type: "CallExpression",
        object: { type: "Identifier", name: "!" },
        arguments: [argument],
        start: { index: start },
        end: { index: end }
    };
    argument.parent = node;
    return node;
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

void test("tryResolveUndefinedCheckRewrite recognises the parser's CallExpression-shaped `!(...)` wrapper", () => {
    // Source: `!(score == undefined)` — the GML parser represents this as a
    // `CallExpression` whose callee is the `!` identifier (not a
    // `UnaryExpression`), because a `!` immediately followed by `(` parses
    // as a call. The helper must detect this shape structurally and widen
    // the range to cover the whole wrapper.
    // Positions:  ! (   s c o r e   = =   u n d e f i n e d )
    // Index:      0 1   2 3 4 5 6 7 8 9 ...
    //             score      → 2..6, undefined → 11..19, wrapper → 0..21
    const sourceText = "!(score == undefined)";
    const otherSide = makeIdentifier("score", 2, 6);
    const binary = makeBinaryNode("==", otherSide, makeIdentifier("undefined", 11, 19), 2, 19);
    const notCall = makeNotCallNode(binary, 0, 20);

    const rewrite = tryResolveUndefinedCheckRewrite(notCall, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 21],
        replacement: "!is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite recognises the CallExpression wrapper regardless of internal whitespace", () => {
    // Source: `! ( score == undefined )` — extra whitespace around the
    // parens defeats a source-text-adjacency check, but the AST shape (and
    // therefore the parent-linked detection) is identical to the
    // no-whitespace case, so the rewrite must still fire and still cover
    // the full wrapper range reported by the parser.
    const sourceText = "! ( score == undefined )";
    const otherSide = makeIdentifier("score", 4, 8);
    const binary = makeBinaryNode("==", otherSide, makeIdentifier("undefined", 13, 21), 4, 21);
    const notCall = makeNotCallNode(binary, 0, 23);

    const rewrite = tryResolveUndefinedCheckRewrite(notCall, sourceText);

    assert.deepStrictEqual(rewrite, {
        range: [0, 24],
        replacement: "!is_undefined(score)"
    });
});

void test("tryResolveUndefinedCheckRewrite defers a bare binary that is the direct operand of a negation wrapper", () => {
    // When the inner `BinaryExpression` is visited on its own (as ESLint's
    // traversal does after visiting the wrapping `CallExpression`), it must
    // not independently re-derive a wrapper from source text — the wrapper
    // node's own visit already reports the combined rewrite. Detecting the
    // relationship via `parent` (rather than text slicing) also means this
    // deferral is correct regardless of whitespace between `!` and `(`.
    const sourceText = "!(score == undefined)";
    const otherSide = makeIdentifier("score", 2, 6);
    const binary = makeBinaryNode("==", otherSide, makeIdentifier("undefined", 11, 19), 2, 19);
    makeNotCallNode(binary, 0, 20);

    assert.strictEqual(tryResolveUndefinedCheckRewrite(binary, sourceText), null);
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

void test("tryResolveUndefinedCheckRewrite cancels a CallExpression wrapper when the operator is `!=`", () => {
    // Source: `!(score != undefined)` — the `!=` flips to "is defined" and
    // the outer `!` flips it back, so the rewrite is the positive form.
    const sourceText = "!(score != undefined)";
    const otherSide = makeIdentifier("score", 2, 6);
    const binary = makeBinaryNode("!=", otherSide, makeIdentifier("undefined", 11, 19), 2, 19);
    const notCall = makeNotCallNode(binary, 0, 20);

    const rewrite = tryResolveUndefinedCheckRewrite(notCall, sourceText);

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
