import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cloneIdentifier } from "../src/ast/node-helpers/index.js";

void describe("cloneIdentifier", () => {
    void it("returns null for non-identifiers", () => {
        assert.equal(cloneIdentifier(), null);
        assert.equal(cloneIdentifier({ type: "Literal", value: 1 }), null);
    });

    void it("produces a cloned identifier with copied locations", () => {
        const identifier = {
            type: "Identifier",
            name: "value",
            start: { index: 5 },
            end: { index: 10 }
        };

        const cloned = cloneIdentifier(identifier);

        assert.ok(cloned);
        assert.equal(cloned.name, identifier.name);
        assert.deepEqual(cloned.start, identifier.start);
        assert.deepEqual(cloned.end, identifier.end);

        identifier.start.index = 42;
        identifier.end.index = 84;

        assert.equal(cloned.start.index, 5);
        assert.equal(cloned.end.index, 10);
    });
});
