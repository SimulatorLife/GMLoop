import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("prints statements and element lists for GML programs", async () => {
    const source = [
        "var counter = 1 + value;",
        "function demo() {",
        "    var total = add(counter, 2, 3);",
        "    return total;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        [
            "var counter = 1 + value;",
            "",
            "function demo() {",
            "    var total = add(counter, 2, 3);",
            "    return total;",
            "}",
            ""
        ].join("\n")
    );
});

void test("prints all call arguments in order", async () => {
    const source = ["function demo() {", '    return calculate("alpha", 2, true, other());', "}", ""].join("\n");

    const formatted = await Format.format(source);

    assert.strictEqual(
        formatted,
        ["function demo() {", '    return calculate("alpha", 2, true, other());', "}", ""].join("\n")
    );
});

void test("preserves unary plus before identifiers (semantic rewrite belongs in lint)", async () => {
    // Removing `+x` silently changes program semantics when `x` is not numeric
    // (e.g. string coercion via `+` differs from the raw identifier access).
    // This is an explicit content rewrite that belongs in the lint workspace
    // as `gml/no-unary-plus-on-identifier`. (target-state.md §2.1, §3.2)
    const formatted = await Format.format("var value = +count;\n");

    assert.strictEqual(formatted, "var value = +count;\n");
});

void test("retains plus-plus before identifiers", async () => {
    const formatted = await Format.format("var value = ++count;\n");

    assert.strictEqual(formatted, "var value = ++count;\n");
});

void test("preserves unary plus conversions", async () => {
    const formatted = await Format.format('var value = +"5";\n');

    assert.strictEqual(formatted, 'var value = +"5";\n');
});

void test("does not throw TypeError when CallExpression node has undefined arguments", async () => {
    // A CallExpression node with `arguments` set to undefined (malformed or
    // synthetic input) must not produce a TypeError when accessing arguments[0]
    // inside buildCallArgumentsDocs. Previously the direct index access would
    // throw "TypeError: Cannot read properties of undefined (reading 'type')"
    // when simplePrefixLength === 1 and hasTrailingArguments is true.
    const source = 'function demo() { return my_func("hello"); }\n';

    const formatted = await Format.format(source);

    assert.strictEqual(formatted, ["function demo() {", '    return my_func("hello");', "}", ""].join("\n"));
});

void test("preserves every for-clause slot when init/test/update are missing", async () => {
    // Regression test: ForStatement nodes with optional `init`, `test`, and
    // `update` clauses were previously emitted as `print(key)` calls
    // unconditionally inside a `concat` array. When the parser left any of
    // those slots as `undefined` (e.g. `for (;;)` is the canonical infinite
    // loop in GML), `path.call(print, key)` returned `undefined` and Prettier 3
    // silently dropped those falsy entries during doc traversal
    // (`if (!r) continue`). The result was a corrupted header: `for (;;)`
    // formatted as `for (; ; )`, `for (var i = 0;; i++)` formatted as
    // `for (var i = 0; ; i++)`, and every other permutation with a missing
    // slot lost both the empty slot and the surrounding glue the `line`
    // doc builder was supposed to provide. The fix builds the header doc
    // conditionally so each present clause contributes its `;` separator and
    // each missing slot still preserves the structural punctuation needed to
    // keep the parent `group` breakable across long bodies.
    const cases: ReadonlyArray<{ readonly name: string; readonly source: string; readonly expected: string }> = [
        {
            name: "all three clauses omitted (canonical infinite loop)",
            source: "for (;;) { foo(); }\n",
            expected: ["for (;;) {", "    foo();", "}", ""].join("\n")
        },
        {
            name: "only test clause is present",
            source: "for (; cond;) { foo(); }\n",
            expected: ["for (; cond;) {", "    foo();", "}", ""].join("\n")
        },
        {
            name: "test clause is missing",
            source: "for (var i = 0;; i++) { foo(); }\n",
            expected: ["for (var i = 0;; i++) {", "    foo();", "}", ""].join("\n")
        },
        {
            name: "only init clause is present",
            source: "for (var i = 0;;) { foo(); }\n",
            expected: ["for (var i = 0;;) {", "    foo();", "}", ""].join("\n")
        },
        {
            name: "only update clause is present",
            source: "for (;; i++) { foo(); }\n",
            expected: ["for (;; i++) {", "    foo();", "}", ""].join("\n")
        }
    ];

    await cases.reduce(async (previous, testCase) => {
        await previous;
        const formatted = await Format.format(testCase.source);
        assert.strictEqual(
            formatted,
            testCase.expected,
            `Expected for-loop (${testCase.name}) to keep every clause slot intact.`
        );
    }, Promise.resolve());
});
