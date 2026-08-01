import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldSkipTraversal } from "../src/ast/node-helpers/index.js";

void describe("shouldSkipTraversal", () => {
    void it("returns true for null", () => {
        const result = shouldSkipTraversal(null);
        assert.equal(result, true);
    });

    void it("returns true for undefined", () => {
        const result = shouldSkipTraversal(undefined);
        assert.equal(result, true);
    });

    void it("returns true for primitive string values", () => {
        const result = shouldSkipTraversal("text");
        assert.equal(result, true);
    });

    void it("returns true for primitive number values", () => {
        const result = shouldSkipTraversal(42);
        assert.equal(result, true);
    });

    void it("returns true for primitive boolean values", () => {
        const result = shouldSkipTraversal(true);
        assert.equal(result, true);
    });

    void it("returns false for plain objects", () => {
        const result = shouldSkipTraversal({ type: "Identifier" });
        assert.equal(result, false);
    });

    void it("returns false for arrays", () => {
        const result = shouldSkipTraversal([1, 2, 3]);
        assert.equal(result, false);
    });

    void it("returns true when node is in the visited set", () => {
        const visited = new WeakSet();
        const node = { type: "Identifier" };
        visited.add(node);

        const result = shouldSkipTraversal(node, visited);
        assert.equal(result, true);
    });

    void it("returns false when node is an object not in the visited set", () => {
        const visited = new WeakSet();
        const node = { type: "Identifier" };

        const result = shouldSkipTraversal(node, visited);
        assert.equal(result, false);
    });

    void it("returns false for objects when visited set is not provided", () => {
        const node = { type: "Identifier" };

        const result = shouldSkipTraversal(node);
        assert.equal(result, false);
    });

    void it("handles empty objects correctly", () => {
        const result = shouldSkipTraversal({});
        assert.equal(result, false);
    });

    void it("returns true for null even with visited set", () => {
        const visited = new WeakSet();
        const result = shouldSkipTraversal(null, visited);
        assert.equal(result, true);
    });

    void it("prevents revisiting nodes in traversal loops", () => {
        const visited = new WeakSet();
        const nodeA = { type: "A" };
        const nodeB = { type: "B" };
        const nodeC = { type: "C" };

        assert.equal(shouldSkipTraversal(nodeA, visited), false);
        visited.add(nodeA);

        assert.equal(shouldSkipTraversal(nodeB, visited), false);
        visited.add(nodeB);

        assert.equal(shouldSkipTraversal(nodeC, visited), false);
        visited.add(nodeC);

        assert.equal(shouldSkipTraversal(nodeA, visited), true);
        assert.equal(shouldSkipTraversal(nodeB, visited), true);
        assert.equal(shouldSkipTraversal(nodeC, visited), true);
    });

    void it("works correctly with arrays and visited tracking", () => {
        const visited = new WeakSet();
        const arr = [1, 2, 3];

        assert.equal(shouldSkipTraversal(arr, visited), false);
        visited.add(arr);
        assert.equal(shouldSkipTraversal(arr, visited), true);
    });
});
