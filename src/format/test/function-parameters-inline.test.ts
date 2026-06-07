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
