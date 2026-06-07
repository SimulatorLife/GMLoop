import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { visitNonTraversalChildValues } from "../src/ast/node-helpers/index.js";

void describe("visitNonTraversalChildValues", () => {
    void it("reports direct object children of the root and recurses into them", () => {
        const calls: unknown[] = [];
        const ast = {
            type: "Program",
            body: [
                {
                    type: "ExpressionStatement",
                    expression: {
                        type: "Identifier",
                        name: "value"
                    }
                }
            ]
        };

        visitNonTraversalChildValues(ast, (child) => {
            calls.push(child);
        });

        // Root (Program) is the traversal origin and is not reported as a child.
        // Direct object children of Program: body (array — passed to recurse, and
        // since the array branch recurses into elements rather than reporting the
        // array itself as a child value, no direct body callback fires here).
        // However, the array IS an object-like value reachable from Program, so
        // it IS reported as a callback.  Array elements are then recursed into,
        // yielding ExpressionStatement → Identifier.
        assert.equal(calls.length, 2);
        assert.ok(Array.isArray(calls[0]));
        assert.equal((calls[1] as { type: string }).type, "Identifier");
    });

    void it("skips parent / enclosingNode / precedingNode / followingNode traversal links", () => {
        const calls: string[] = [];
        const nodeA = { type: "A", name: "a" };
        const nodeB = { type: "B", name: "b", parent: nodeA, enclosingNode: nodeA };
        const nodeC = { type: "C", name: "c", precedingNode: nodeB, followingNode: nodeB };
        const nodeD = { type: "D", name: "d", child: nodeB, array: [nodeC] };

        visitNonTraversalChildValues(nodeD, (child) => {
            const record = child as { type?: string };
            if (record.type) {
                calls.push(record.type);
            }
        });

        // nodeD → child (B, reported), array ([C], recursed)
        // C is not reported as it has no non-ignored object children (only type/name/links)
        // B is not reported again as a descendant because it was already seen
        assert.deepEqual(calls, ["B"]);
    });

    void it("reports direct children of intermediate nodes during descent", () => {
        const calls: string[] = [];
        const deep = {
            type: "Deep",
            nested: {
                type: "Nested",
                deeper: {
                    type: "Deeper"
                }
            }
        };

        visitNonTraversalChildValues(deep, (child) => {
            const record = child as { type?: string };
            if (record.type) {
                calls.push(record.type);
            }
        });

        // Deep → direct child: nested (Nested)
        // Nested → direct child: deeper (Deeper)
        assert.deepEqual(calls, ["Nested", "Deeper"]);
    });

    void it("bails early for nullish roots", () => {
        const calls: unknown[] = [];
        visitNonTraversalChildValues(null, (child) => calls.push(child));
        visitNonTraversalChildValues(undefined, (child) => calls.push(child));
        assert.equal(calls.length, 0);
    });

    void it("ignores primitive property values", () => {
        const calls: unknown[] = [];
        visitNonTraversalChildValues({ type: "Node", name: "test", index: 42, active: true, optional: null }, (child) =>
            calls.push(child)
        );
        assert.equal(calls.length, 0);
    });

    void it("handles an array as the root", () => {
        const calls: string[] = [];
        const nodes = [{ type: "A", child: { type: "B" } }, { type: "C" }];

        visitNonTraversalChildValues(nodes, (child) => {
            const record = child as { type?: string };
            if (record.type) {
                calls.push(record.type);
            }
        });

        // Root array → elements: A (child B), C
        // Each element is recursed into.  A's child B is reported as a direct object
        // child of A.  C has no non-ignored object children.
        assert.deepEqual(calls, ["B"]);
    });

    void it("reports each object child each time it is encountered through a different path", () => {
        const sharedChild: Record<string, unknown> = { type: "Shared", name: "shared" };
        const ast = {
            type: "Root",
            first: sharedChild,
            second: sharedChild
        };

        const calls: string[] = [];
        visitNonTraversalChildValues(ast, (child) => {
            const record = child as { type?: string };
            if (record.type) {
                calls.push(record.type);
            }
        });

        // Root → first (Shared) → reported; second (Shared) → reported separately
        assert.deepEqual(calls, ["Shared", "Shared"]);
    });
});
