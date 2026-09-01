import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createLiveReloadCommand } from "../src/commands/live-reload.js";

void describe("live-reload session command", () => {
    void it("replaces the retired status, discover, and dev commands", () => {
        const command = createLiveReloadCommand();
        const session = command.commands.find((candidate) => candidate.name() === "session");

        assert.ok(session);
        assert.equal(
            command.commands.some((candidate) => candidate.name() === "status"),
            false
        );
        assert.equal(
            command.commands.some((candidate) => candidate.name() === "discover"),
            false
        );
        assert.equal(
            command.commands.some((candidate) => candidate.name() === "dev"),
            false
        );
    });

    void it("exposes explicit managed-session lifecycle options", () => {
        const command = createLiveReloadCommand();
        const session = command.commands.find((candidate) => candidate.name() === "session");
        assert.ok(session);

        const names = new Set(session.options.map((option) => option.attributeName()));
        assert.ok(names.has("path"));
        assert.ok(names.has("forceStart"));
        assert.ok(names.has("stop"));
        assert.ok(names.has("format"));
        assert.equal(names.has("forceNew"), false);
        assert.equal(names.has("reuseExisting"), false);
    });
});
