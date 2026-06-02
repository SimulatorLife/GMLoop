import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeReadiness } from "../browser/websocket/runtime-readiness.js";

type JsonGameSnapshot = {
    ScriptNames?: Array<string>;
    Scripts?: Array<unknown>;
};

type RuntimeGlobals = {
    g_pBuiltIn?: Record<string, unknown>;
    JSON_game?: JsonGameSnapshot;
    _a1?: {
        _98?: Array<string>;
        _a8?: Array<unknown>;
    };
    _c3?: {
        _ba?: Array<string>;
        _ca?: Array<unknown>;
    };
    _g8?: Record<string, unknown>;
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

void test("resolveRuntimeReadiness returns false when runtime script tables are missing", () => {
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
        globals.JSON_game = null;
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

void test("resolveRuntimeReadiness returns true for known minified GameMaker script tables", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;
    const savedMinifiedBuiltins = globals._g8;
    const savedMinifiedGameData = globals._a1;

    try {
        delete globals.g_pBuiltIn;
        delete globals.JSON_game;
        globals._g8 = {};
        globals._a1 = {
            _98: ["gml_Script_placeholder"],
            _a8: [() => undefined]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
        globals._g8 = savedMinifiedBuiltins;
        globals._a1 = savedMinifiedGameData;
    }
});

void test("resolveRuntimeReadiness returns true for shape-discovered minified GameMaker script tables", () => {
    const globals = globalThis as unknown as RuntimeGlobals;
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;
    const savedMinifiedBuiltins = globals._g8;
    const savedKnownMinifiedGameData = globals._a1;
    const savedDiscoveredMinifiedGameData = globals._c3;

    try {
        delete globals.g_pBuiltIn;
        delete globals.JSON_game;
        delete globals._g8;
        delete globals._a1;
        globals._c3 = {
            _ba: ["gml_Script_placeholder"],
            _ca: [() => undefined]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
        globals._g8 = savedMinifiedBuiltins;
        globals._a1 = savedKnownMinifiedGameData;
        globals._c3 = savedDiscoveredMinifiedGameData;
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

void test("resolveRuntimeReadiness returns true when script tables are ready and g_pBuiltIn is primitive", () => {
    const globals = globalThis as unknown as RuntimeGlobals & { g_pBuiltIn?: unknown };
    const savedBuiltins = globals.g_pBuiltIn;
    const savedJsonGame = globals.JSON_game;

    try {
        (globals as Record<string, unknown>).g_pBuiltIn = 42;
        globals.JSON_game = {
            ScriptNames: [],
            Scripts: [() => {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    } finally {
        globals.g_pBuiltIn = savedBuiltins;
        globals.JSON_game = savedJsonGame;
    }
});
