import assert from "node:assert/strict";
import { test } from "node:test";

import { createGameMakerCliInvocationPlan } from "../../../src/modules/game-maker-cli/index.js";

void test("createGameMakerCliInvocationPlan prefers an explicit tool path when configured", () => {
    const plan = createGameMakerCliInvocationPlan("/custom/gm-cli", ["manual", "read", "sprites"]);

    assert.deepEqual(plan, [
        {
            args: ["manual", "read", "sprites"],
            command: "/custom/gm-cli"
        }
    ]);
});

void test("createGameMakerCliInvocationPlan falls back to npx when no explicit tool path is configured", () => {
    const plan = createGameMakerCliInvocationPlan(null, ["resourcetool", "eval", "resource list"]);

    assert.deepEqual(plan, [
        {
            args: ["resourcetool", "eval", "resource list"],
            command: "gm-cli"
        },
        {
            args: ["--yes", "@gamemaker/gm-cli@latest", "resourcetool", "eval", "resource list"],
            command: "npx"
        }
    ]);
});
