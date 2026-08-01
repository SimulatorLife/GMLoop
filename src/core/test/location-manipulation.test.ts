import assert from "node:assert/strict";
import { test } from "node:test";

import {
    remapLocationMetadata,
    removeLocationMetadata,
    simplifyLocationMetadata
} from "../src/ast/location-manipulation.js";

void test("location metadata helpers mutate nested structures", () => {
    const ast = {
        type: "Program",
        start: { index: 0 },
        end: { index: 4 },
        body: [
            {
                type: "Literal",
                start: 1,
                end: 3,
                extra: {
                    start: { index: 10 },
                    end: { index: 12 }
                }
            }
        ]
    };

    simplifyLocationMetadata(ast);
    assert.deepEqual(ast.start, 0);
    assert.deepEqual(ast.end, 4);
    assert.deepEqual(ast.body[0].extra.start, 10);

    remapLocationMetadata(ast, (index) => index + 2);
    assert.deepEqual(ast.body[0].start, 3);
    assert.deepEqual(ast.body[0].extra.end, 14);

    removeLocationMetadata(ast);
    assert.ok(!Object.hasOwn(ast, "start"));
    assert.ok(!Object.hasOwn(ast, "end"));
    assert.ok(!Object.hasOwn(ast.body[0], "start"));
    assert.ok(!Object.hasOwn(ast.body[0], "end"));
});
