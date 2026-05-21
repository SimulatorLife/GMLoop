import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { forEachNodeChild } from "../src/ast/node-helpers/index.js";

void describe("forEachNodeChild", () => {
    void it("iterates own object-like children while skipping traversal links", () => {
        const visitedKeys: string[] = [];

        forEachNodeChild(
            {
                type: "Root",
                parent: { type: "IgnoredParent" },
                enclosingNode: { type: "IgnoredEnclosing" },
                child: { type: "Child" },
                nestedArray: [{ type: "ArrayChild" }],
                literal: 42
            },
            (_child, key) => {
                visitedKeys.push(key);
            }
        );

        assert.deepEqual(visitedKeys, ["child", "nestedArray"]);
    });

    void it("does not visit inherited enumerable properties", () => {
        const inherited = { inheritedChild: { type: "Inherited" } };
        const node = Object.assign(Object.create(inherited), {
            type: "Root",
            ownChild: { type: "Own" }
        });

        const visitedKeys: string[] = [];
        forEachNodeChild(node, (_, key) => visitedKeys.push(key));

        assert.deepEqual(visitedKeys, ["ownChild"]);
    });

    void it("returns without invoking callback for non-object inputs", () => {
        let callbackCalls = 0;
        const callback = () => {
            callbackCalls++;
        };

        forEachNodeChild(null, callback);
        forEachNodeChild(undefined, callback);
        forEachNodeChild(12, callback);
        forEachNodeChild("text", callback);

        assert.equal(callbackCalls, 0);
    });
});
