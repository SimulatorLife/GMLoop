import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeReadiness } from "../src/websocket/runtime-readiness.js";

type JsonGameSnapshot = {
    ScriptNames?: Array<string>;
    Scripts?: Array<unknown>;
};

type RuntimeGlobals = {
    g_pBuiltIn?: Record<string, unknown>;
    JSON_game?: JsonGameSnapshot;
};

void test("resolveRuntimeReadiness returns true immediately when cached readiness is already true", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        delete globals.g_pBuiltIn;
        delete globals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(true), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when g_pBuiltIn is missing", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        delete globals.g_pBuiltIn;
        delete globals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when JSON_game is missing", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        delete globals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when JSON_game is null", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        globals.JSON_game = null as unknown as JsonGameSnapshot;
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when ScriptNames is not an array", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        globals.JSON_game = {
            ScriptNames: "not-an-array" as unknown as Array<string>,
            Scripts: []
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when Scripts is not an array", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        globals.JSON_game = {
            ScriptNames: [],
            Scripts: "not-an-array" as unknown as Array<unknown>
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when Scripts is empty", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        globals.JSON_game = {
            ScriptNames: ["script1", "script2"],
            Scripts: []
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when Scripts contains only non-function entries", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        globals.JSON_game = {
            ScriptNames: ["script1"],
            Scripts: ["not-a-function", { callable: false }, null]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns true when Scripts contains at least one function entry", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = {};
        globals.JSON_game = {
            ScriptNames: ["script1", "script2"],
            Scripts: [() => {}, "not-a-function", null, {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns true when cached readiness is true even with malformed globals", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        delete globals.g_pBuiltIn;
        delete globals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(true), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns true when g_pBuiltIn is an object and Scripts contains a function", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        globals.g_pBuiltIn = { application_surface: -1 };
        globals.JSON_game = {
            ScriptNames: ["Script1", "Script2"],
            Scripts: [function scriptEntry() {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});

void test("resolveRuntimeReadiness returns false when g_pBuiltIn is a primitive (not an object)", () => {
    const globals = globalThis as unknown as RuntimeGlobals & { g_pBuiltIn?: unknown };
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        (globals as Record<string, unknown>).g_pBuiltIn = 42 as unknown as Record<string, unknown>;
        globals.JSON_game = {
            ScriptNames: [],
            Scripts: [() => {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});
