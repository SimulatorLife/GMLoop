import assert from "node:assert/strict";
import test from "node:test";

import { createGameMakerCliInvocationPlan } from "../src/modules/game-maker-cli/index.js";

void test("createGameMakerCliInvocationPlan falls back to npx latest when no explicit tool path is configured", () => {
    const plan = createGameMakerCliInvocationPlan(null, ["--help"]);

    assert.deepEqual(plan, [
        {
            args: ["--help"],
            command: "gm-cli",
            displayName: "gm-cli"
        },
        {
            args: ["--yes", "@gamemaker/gm-cli@latest", "--help"],
            command: "npx",
            displayName: "npx @gamemaker/gm-cli@latest"
        }
    ]);
});
