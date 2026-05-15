import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createResourceCommand } from "../src/commands/resource.js";

void describe("Resource command", () => {
    void it("keeps only graph-backed inspection leaves and drops bespoke mutation leaves", () => {
        const command = createResourceCommand();

        assert.equal(command.name(), "resource");
        assert.deepEqual(command.commands.map((entry) => entry.name()).sort(), [
            "audit",
            "dependents",
            "deps",
            "find",
            "inspect",
            "list"
        ]);
    });

    void it("documents gm-cli resourcetool as the mutation backend", () => {
        const command = createResourceCommand();
        const helpText = command.description();

        assert.match(helpText, /gmloop gm-cli resourcetool/u);
        assert.doesNotMatch(helpText, /resource add/u);
        assert.doesNotMatch(helpText, /resource remove/u);
    });
});
