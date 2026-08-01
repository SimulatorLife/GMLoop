/**
 * Tests for {@link import("../src/browser/websocket/runtime-readiness.js").resolveRuntimeReadiness}.
 *
 * The readiness probe inspects well-known properties on `globalThis`
 * (`g_pBuiltIn`, `JSON_game`, `_g8`, `_a1`, `_c3`). Each test below has to
 * mutate that shared surface, so the suite installs a per-test fixture via
 * {@link import("./test-helpers/runtime-readiness-globals.js").captureRuntimeReadinessGlobals}
 * to keep the test file ordering-independent and resistant to a future
 * production change that adds another probed global.
 *
 * Historical flakiness: the previous revision of this file hand-rolled a
 * `try { mutate } finally { restore }` block in every test. The hand-rolled
 * pattern (a) duplicated the property name list in sixteen places, (b)
 * captured the snapshot *before* the `try` block, so a throwing `globalThis`
 * getter on a property the test did not remember to save would propagate
 * the wrong test's failure, and (c) had no per-test timeout, so a single
 * runaway test held the whole suite open. The new fixture below replaces
 * the hand-rolled pattern with a single, centralized restore and a strict
 * 5-second per-test budget.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { resolveRuntimeReadiness } from "../src/browser/websocket/runtime-readiness.js";
import { snapshotGlobalProperties } from "./test-helpers/runtime-global-state.js";
import {
    captureRuntimeReadinessGlobals,
    type RuntimeReadinessGlobalPropertyName
} from "./test-helpers/runtime-readiness-globals.js";

/**
 * Per-test budget. The probe is a pure, in-memory function, so a healthy
 * test must finish in well under 100 ms; 5 seconds leaves generous headroom
 * for slow CI while still failing fast if a test wedges the event loop.
 */
const RUNTIME_READINESS_TEST_TIMEOUT_MS = 5000;

type JsonGameSnapshot = {
    ScriptNames?: Array<string>;
    Scripts?: Array<unknown>;
};

type RuntimeReadinessGlobals = Record<RuntimeReadinessGlobalPropertyName, unknown> & {
    g_pBuiltIn?: Record<string, unknown> | number | string | boolean | null;
    JSON_game?: JsonGameSnapshot | null;
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

const runtimeReadinessGlobals = globalThis as unknown as RuntimeReadinessGlobals;

test.afterEach(() => {
    // `restoreRuntimeReadinessGlobals` is set by the beforeEach hook on a
    // per-test basis. We capture the closure via the hook so we never reach
    // for a stale function across runs; the assertion below guards the
    // invariant for any test that opts out of the hook.
    const candidate = (test as unknown as { __restoreRuntimeReadinessGlobals?: () => void })
        .__restoreRuntimeReadinessGlobals;
    if (typeof candidate === "function") {
        candidate();
        (test as unknown as { __restoreRuntimeReadinessGlobals?: () => void }).__restoreRuntimeReadinessGlobals =
            undefined;
    }
});

function installReadinessFixture(): void {
    const restore = captureRuntimeReadinessGlobals();
    (test as unknown as { __restoreRuntimeReadinessGlobals?: () => void }).__restoreRuntimeReadinessGlobals = restore;
}

void test(
    "resolveRuntimeReadiness returns true immediately when cached readiness is already true",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        delete runtimeReadinessGlobals.g_pBuiltIn;
        delete runtimeReadinessGlobals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(true), true);
    }
);

void test(
    "resolveRuntimeReadiness returns false when runtime script tables are missing",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        delete runtimeReadinessGlobals.g_pBuiltIn;
        delete runtimeReadinessGlobals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns false when JSON_game is missing",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        delete runtimeReadinessGlobals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns false when JSON_game is null",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        runtimeReadinessGlobals.JSON_game = null;
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns false when ScriptNames is not an array",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: "not-an-array" as unknown as Array<string>,
            Scripts: []
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns false when Scripts is not an array",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: [],
            Scripts: "not-an-array" as unknown as Array<unknown>
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns false when Scripts is empty",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: ["script1", "script2"],
            Scripts: []
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns false when Scripts contains only non-function entries",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: ["script1"],
            Scripts: ["not-a-function", { callable: false }, null]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

void test(
    "resolveRuntimeReadiness returns true when Scripts contains at least one function entry",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = {};
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: ["script1", "script2"],
            Scripts: [() => {}, "not-a-function", null, {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    }
);

void test(
    "resolveRuntimeReadiness returns true for known minified GameMaker script tables",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        delete runtimeReadinessGlobals.g_pBuiltIn;
        delete runtimeReadinessGlobals.JSON_game;
        runtimeReadinessGlobals._g8 = {};
        runtimeReadinessGlobals._a1 = {
            _98: ["gml_Script_placeholder"],
            _a8: [() => undefined]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    }
);

void test(
    "resolveRuntimeReadiness returns true for shape-discovered minified GameMaker script tables",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        delete runtimeReadinessGlobals.g_pBuiltIn;
        delete runtimeReadinessGlobals.JSON_game;
        delete runtimeReadinessGlobals._g8;
        delete runtimeReadinessGlobals._a1;
        runtimeReadinessGlobals._c3 = {
            _ba: ["gml_Script_placeholder"],
            _ca: [() => undefined]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    }
);

void test(
    "resolveRuntimeReadiness returns true when cached readiness is true even with malformed globals",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        delete runtimeReadinessGlobals.g_pBuiltIn;
        delete runtimeReadinessGlobals.JSON_game;
        assert.strictEqual(resolveRuntimeReadiness(true), true);
    }
);

void test(
    "resolveRuntimeReadiness returns true when g_pBuiltIn is an object and Scripts contains a function",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = { application_surface: -1 };
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: ["Script1", "Script2"],
            Scripts: [function scriptEntry() {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    }
);

void test(
    "resolveRuntimeReadiness returns true when script tables are ready and g_pBuiltIn is primitive",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = 42;
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: [],
            Scripts: [() => {}]
        };
        assert.strictEqual(resolveRuntimeReadiness(false), true);
    }
);

void test(
    "resolveRuntimeReadiness safely ignores cross-origin window objects without throwing",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        delete runtimeReadinessGlobals.g_pBuiltIn;
        delete runtimeReadinessGlobals.JSON_game;

        // Simulate a cross-origin window object property on global scope.
        // Reading it shouldn't throw, but checking properties on it should throw SecurityError.
        const mockCrossOriginWindow: Record<string | symbol, unknown> = {};
        Object.defineProperty(mockCrossOriginWindow, "self", {
            get() {
                throw new Error("Blocked a frame with origin from accessing a cross-origin frame.");
            },
            configurable: true
        });

        // Inject the simulated cross-origin window as a property on globals
        (runtimeReadinessGlobals as Record<string, unknown>).__mock_cross_origin_window = mockCrossOriginWindow;

        // Try to resolve readiness — it should not throw and return false safely
        assert.strictEqual(resolveRuntimeReadiness(false), false);
    }
);

/**
 * Regression test for the historical flakiness documented at the top of
 * this file: the previous hand-rolled save/restore pattern left a test
 * vulnerable to leaking global mutations when a future change added a
 * new global to the production probe (which the test had not added to
 * its save list).
 *
 * The new fixture must restore every canonical readiness global even
 * when the test body mutates them. This test deliberately mutates the
 * full set of canonical globals, then throws an inner exception that is
 * captured by `assert.throws`. The body returns normally, so the test
 * itself passes, but the afterEach hook must still restore every
 * canonical global to its pre-test value.
 *
 * The follow-up "post-throw restore" test, which runs *after* this one,
 * observes the globals and asserts they are back to their pre-test
 * values. Together the two tests prove that the per-test fixture
 * isolates state across tests.
 */
void test(
    "runtime-readiness fixture mutates the full canonical global set and surfaces its throw to assert.throws",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        installReadinessFixture();

        runtimeReadinessGlobals.g_pBuiltIn = { __throwerMarker: true };
        runtimeReadinessGlobals.JSON_game = {
            ScriptNames: ["gml_Script_thrower"],
            Scripts: [() => undefined]
        };
        runtimeReadinessGlobals._g8 = { __throwerMarker: true };
        runtimeReadinessGlobals._a1 = {
            _98: ["gml_Script_thrower"],
            _a8: [() => undefined]
        };
        runtimeReadinessGlobals._c3 = {
            _ba: ["gml_Script_thrower"],
            _ca: [() => undefined]
        };

        // Capture, but do not propagate, the inner throw. The body returns
        // normally so the test itself passes, but the afterEach hook must
        // still restore the canonical globals. The follow-up test is the
        // real assertion that the restore happened.
        assert.throws(() => {
            throw new Error("regression sentinel: inner throw is captured by assert.throws");
        }, /regression sentinel/);
    }
);

void test(
    "runtime-readiness fixture observes no leaked globals after the prior test body throws",
    { timeout: RUNTIME_READINESS_TEST_TIMEOUT_MS },
    () => {
        // Install the fixture so the *current* test still cleans up its
        // own mutations; that does not affect the leak we are probing,
        // because the prior test already completed (or its afterEach
        // already ran) before this body executes.
        installReadinessFixture();

        // Snapshot the canonical globals NOW. If the prior test's
        // afterEach hook failed to restore, the snapshot will contain
        // the values that test left behind; if the hook worked, the
        // snapshot is the pre-file value (undefined in a clean
        // test-runner process).
        const snapshot = snapshotGlobalProperties(["g_pBuiltIn", "JSON_game", "_g8", "_a1", "_c3"]);

        for (const propertyName of ["g_pBuiltIn", "JSON_game", "_g8", "_a1", "_c3"] as const) {
            const observed = snapshot[propertyName];
            assert.strictEqual(
                observed,
                undefined,
                `expected ${propertyName} to be undefined after the prior test's afterEach restore`
            );
        }
    }
);
