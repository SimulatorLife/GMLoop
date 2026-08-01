import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("skips inlining when params array is unexpectedly empty (defensive guard)", async () => {
    // Regression: shouldForceInlineFunctionParameters previously assumed params
    // contained at least one element after the isNonEmptyArray check. A malformed
    // node with an empty params array would throw TypeError when accessing
    // node.params[0] or node.params.at(-1). The defensive guard now returns false
    // instead of crashing.
    const source = ["function foo() : bar() constructor {", "    // body here", "}"].join("\n");

    // Should format without throwing TypeError
    const formatted = await Format.format(source, { printWidth: 80 });
    assert.ok(formatted.includes("function foo()"));
});

void test("inlines default parameter functions with single call bodies", async () => {
    const source = [
        "some(",
        "    thisArgumentIsQuiteLong,",
        "    function foo(cool, f = function () {",
        "        ez();",
        "    }) : bar() constructor {",
        "        return cool;",
        "    }",
        ");",
        ""
    ].join("\n");

    const formatted = await Format.format(source, {
        printWidth: 80
    });

    assert.strictEqual(
        formatted,
        [
            "some(",
            "    thisArgumentIsQuiteLong,",
            "    function foo(cool, f = function () { ez(); }) : bar() constructor {",
            "        return cool;",
            "    }",
            ");",
            ""
        ].join("\n")
    );
});

void test("wraps function parameters when they exceed the print width", async () => {
    const source = [
        "function determine_state(x, y, z, can_currently_attack = false, attack_range_max = 1, attack_range_min = attack_range_max - 1) {",
        "    return 1;",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source, {
        printWidth: 80
    });

    assert.strictEqual(
        formatted,
        [
            "function determine_state(",
            "    x,",
            "    y,",
            "    z,",
            "    can_currently_attack = false,",
            "    attack_range_max = 1,",
            "    attack_range_min = attack_range_max - 1",
            ") {",
            "    return 1;",
            "}",
            ""
        ].join("\n")
    );
});

void test("keeps short function parameters inline", async () => {
    const source = ["function foo(a, b, c) {", "    return a;", "}", ""].join("\n");

    const formatted = await Format.format(source, {
        printWidth: 80
    });

    assert.strictEqual(formatted, ["function foo(a, b, c) {", "    return a;", "}", ""].join("\n"));
});

void test("wraps static method definition parameters cleanly when they exceed print width", async () => {
    const source = [
        "static determine_state = function (x, y, z, can_currently_attack = false, attack_range_max = 1, attack_range_min = attack_range_max - 1) {",
        "    // body",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source, {
        printWidth: 80
    });

    assert.strictEqual(
        formatted,
        [
            "static determine_state = function (",
            "    x,",
            "    y,",
            "    z,",
            "    can_currently_attack = false,",
            "    attack_range_max = 1,",
            "    attack_range_min = attack_range_max - 1",
            ") {",
            "    // body",
            "};",
            ""
        ].join("\n")
    );
});
