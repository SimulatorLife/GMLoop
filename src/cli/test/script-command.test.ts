import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createScriptCommand } from "../src/commands/script.js";

void describe("Script command", () => {
    void it("exposes the expected subcommand leaves", () => {
        const command = createScriptCommand();

        assert.equal(command.name(), "script");
        assert.deepEqual(command.commands.map((entry) => entry.name()).sort(), [
            "add",
            "duplicate",
            "inspect",
            "list",
            "remove",
            "rename",
            "update"
        ]);
    });

    void it("marks the 'add' subcommand as the write-capable leaf", () => {
        const command = createScriptCommand();
        const addCommand = command.commands.find((entry) => entry.name() === "add");
        assert.ok(addCommand, "Expected 'add' subcommand to exist");

        const options = addCommand?.options ?? [];
        assert.ok(
            options.some((entry) => entry.attributeName() === "write"),
            "Expected 'add' to have a --write option"
        );
    });

    void it("describes the command as covering script inspection and mutation", () => {
        const command = createScriptCommand();
        const helpText = command.description();

        assert.match(helpText, /script/iu);
        assert.match(helpText, /Inspect|mutate/iu);
    });
});
