import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visitChildNodes } from "../src/ast/node-helpers/index.js";

interface Named {
    name: string;
}

void describe("visitChildNodes", () => {
    void it("invokes the callback for every array entry", () => {
        const calls: unknown[][] = [];

        visitChildNodes([1, { nested: true }], (...args) => {
            calls.push(args);
        });

        assert.equal(calls.length, 2);
        assert.deepEqual(calls[0], [1]);
        assert.deepEqual(calls[1], [{ nested: true }]);
    });

    void it("only forwards object values from plain objects", () => {
        const child = { nested: true };
        const calls: unknown[][] = [];

        visitChildNodes({ child, count: 1, empty: null }, (...args) => {
            calls.push(args);
        });

        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], [child]);
    });

    void it("continues iterating when the backing array mutates", () => {
        const nodes = [{ name: "alpha" }, { name: "beta" }, { name: "gamma" }];
        const seen: string[] = [];

        visitChildNodes(nodes, (child) => {
            const namedChild = child as Named;
            seen.push(namedChild?.name ?? "");

            if (namedChild?.name === "alpha") {
                nodes.splice(0, 1);
            }
        });

        assert.deepEqual(seen, ["alpha", "beta", "gamma"]);
    });

    void it("bails early for nullish parents", () => {
        const calls: unknown[][] = [];

        visitChildNodes(null, (...args) => {
            calls.push(args);
        });
        visitChildNodes(undefined, (...args) => {
            calls.push(args);
        });

        assert.equal(calls.length, 0);
    });
});
