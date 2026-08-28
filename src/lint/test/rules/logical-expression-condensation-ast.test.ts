/**
 * Unit tests for the AST emission helpers in `logical-expression-condensation-ast.ts`.
 *
 * The condensation pipeline used to inline the same five-field literal
 * `{ type: "UnaryExpression", operator: "!", prefix: true, argument, start, end }`
 * at six sites across the lint workspace. The shared `createNegationExpression`
 * helper now owns that shape, so the tests below pin its observable contract:
 *
 *   1. The literal shape (type, operator, prefix, argument) is always emitted.
 *   2. `start`/`end` are deep-cloned from the argument so downstream consumers
 *      cannot mutate the helper's cached locations.
 *   3. `wrapBinaryArguments` mirrors the long-standing `wrapUnaryArgument` rule
 *      the condensation pipeline relied on inline before the helper existed.
 *   4. The helper tolerates `undefined` / missing arguments and locations
 *      without throwing, matching the rest of the AST builders in the file.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createNegationExpression } from "../../src/rules/gml/transforms/logical-expression-condensation-ast.js";

type AnyRecord = Record<string, unknown>;

function makeIdentifier(name: string): AnyRecord {
    return { type: "Identifier", name };
}

function makeBinaryExpression(left: unknown, operator: string, right: unknown): AnyRecord {
    return { type: "BinaryExpression", operator, left, right, start: 10, end: 30 };
}

void test("createNegationExpression emits a `!` UnaryExpression with the argument's locations cloned", () => {
    const argument = {
        type: "Identifier",
        name: "ready",
        start: { line: 1, column: 4 },
        end: { line: 1, column: 9 }
    };

    const result = createNegationExpression(argument);

    assert.equal(result.type, "UnaryExpression", "negation should be a UnaryExpression");
    assert.equal(result.operator, "!", "negation operator should be `!`");
    assert.equal(result.prefix, true, "negation must keep `prefix: true` to stay a prefix operator");
    assert.strictEqual(result.argument, argument, "argument should be passed through untouched");

    // `start`/`end` must be deep-cloned so downstream consumers cannot mutate
    // the original argument's locations through the returned node.
    assert.deepEqual(result.start, argument.start, "negation start should mirror the argument");
    assert.deepEqual(result.end, argument.end, "negation end should mirror the argument");
    assert.notStrictEqual(result.start, argument.start, "negation start must be a fresh clone, not the same object");
    assert.notStrictEqual(result.end, argument.end, "negation end must be a fresh clone, not the same object");

    // Mutating the negation's locations must not leak back into the argument.
    (result.start as { column: number }).column = 999;
    assert.equal((argument.start as { column: number }).column, 4, "mutating the negation start must not leak back");
});

void test("createNegationExpression wraps BinaryExpression arguments when wrapBinaryArguments is true", () => {
    const argument = makeBinaryExpression(makeIdentifier("a"), "&&", makeIdentifier("b"));

    const result = createNegationExpression(argument, { wrapBinaryArguments: true });

    assert.equal(result.type, "UnaryExpression");
    assert.equal(result.operator, "!");

    const wrapped = result.argument as AnyRecord;
    assert.equal(wrapped.type, "ParenthesizedExpression", "BinaryExpression arguments must be parenthesised");
    assert.equal(wrapped.synthetic, true, "the wrapper should be marked synthetic so the printer can skip it");
    assert.strictEqual(wrapped.expression, argument, "the wrapper should preserve the original argument reference");
});

void test("createNegationExpression wraps LogicalExpression arguments when wrapBinaryArguments is true", () => {
    const argument = {
        type: "LogicalExpression",
        operator: "||",
        left: makeIdentifier("a"),
        right: makeIdentifier("b"),
        start: 5,
        end: 15
    };

    const result = createNegationExpression(argument, { wrapBinaryArguments: true });

    const wrapped = result.argument as AnyRecord;
    assert.equal(wrapped.type, "ParenthesizedExpression", "LogicalExpression arguments must be parenthesised");
    assert.equal(wrapped.synthetic, true);
    assert.strictEqual(wrapped.expression, argument);
});

void test("createNegationExpression leaves non-binary arguments bare when wrapBinaryArguments is true", () => {
    const argument = makeIdentifier("ready");

    const result = createNegationExpression(argument, { wrapBinaryArguments: true });

    assert.strictEqual(result.argument, argument, "identifier arguments should not be wrapped");
});

void test("createNegationExpression leaves arguments bare by default", () => {
    const argument = makeBinaryExpression(makeIdentifier("a"), "||", makeIdentifier("b"));

    const result = createNegationExpression(argument);

    assert.strictEqual(
        result.argument,
        argument,
        "BinaryExpression arguments must NOT be wrapped when wrapBinaryArguments is omitted"
    );
});

void test("createNegationExpression tolerates a missing argument and undefined locations", () => {
    const result = createNegationExpression(undefined);

    assert.equal(result.type, "UnaryExpression");
    assert.equal(result.operator, "!");
    assert.equal(result.prefix, true);
    assert.strictEqual(result.argument, undefined, "missing argument should be preserved");
    assert.strictEqual(result.start, undefined, "missing start should remain undefined");
    assert.strictEqual(result.end, undefined, "missing end should remain undefined");
});

void test("createNegationExpression tolerates an argument without source locations", () => {
    const argument = { type: "Identifier", name: "x" };

    const result = createNegationExpression(argument);

    assert.strictEqual(result.start, undefined);
    assert.strictEqual(result.end, undefined);
    assert.strictEqual(result.argument, argument);
});
