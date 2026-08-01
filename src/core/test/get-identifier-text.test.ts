import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getIdentifierText } from "../src/ast/node-helpers/index.js";

void describe("getIdentifierText", () => {
    void it("returns string arguments unchanged", () => {
        assert.equal(getIdentifierText("example"), "example");
    });

    void it("reads the name property from plain objects", () => {
        assert.equal(getIdentifierText({ name: "identifier" }), "identifier");
    });
});
