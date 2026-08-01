import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createIdentifierNode } from "../src/ast/node-helpers/index.js";

void describe("createIdentifierNode", () => {
    void it("returns an identifier with cloned location metadata", () => {
        const template = {
            start: { index: 12 },
            end: { index: 16 }
        };

        const identifier = createIdentifierNode("value", template);

        assert.ok(identifier);
        assert.equal(identifier.type, "Identifier");
        assert.equal(identifier.name, "value");
        assert.deepEqual(identifier.start, template.start);
        assert.deepEqual(identifier.end, template.end);

        // Mutate the template to confirm the identifier holds cloned metadata.
        template.start.index = 100;
        template.end.index = 200;

        assert.equal(identifier.start.index, 12);
        assert.equal(identifier.end.index, 16);
    });

    void it("returns null for non-string or empty names", () => {
        const template = { start: { index: 0 }, end: { index: 1 } };

        assert.equal(createIdentifierNode("", template), null);
        assert.equal(createIdentifierNode(null, template), null);
        assert.equal(createIdentifierNode(undefined, template), null);
        assert.equal(createIdentifierNode(42, template), null);
    });
});
