import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeWrapper } from "../index.js";
import { restoreGlobalProperties, snapshotGlobalProperties } from "./test-helpers/runtime-global-state.js";

type JsonGameSnapshot = {
    ScriptNames: Array<string>;
    Scripts: Array<(...args: Array<unknown>) => unknown>;
    GMObjects: Array<Record<string, unknown>>;
};

const runtimeIntegrationPropertyNames = [
    "JSON_game",
    "gml_Script_test",
    "gml_Object_oSpider_Step_0",
    "g_pBuiltIn",
    "make_colour_rgb",
    "vk_anykey",
    "_uB2",
    "EVENT_STEP_NORMAL",
    "_cx"
] as const;

type GlobalSnapshot = {
    JSON_game?: JsonGameSnapshot;
    gml_Script_test?: (...args: Array<unknown>) => unknown;
    gml_Object_oSpider_Step_0?: (...args: Array<unknown>) => unknown;
    g_pBuiltIn?: Record<string, unknown>;
    make_colour_rgb?: (red: number, green: number, blue: number) => number;
    vk_anykey?: number;
    _uB2?: number;
    EVENT_STEP_NORMAL?: number;
    _cx?: { _dx?: Record<string, unknown> };
};

type ObjectPatchFixture = {
    globals: GlobalSnapshot;
    instanceEntry: Record<string, unknown>;
    objectEntry: { pName: string; StepNormalEvent: (...args: Array<unknown>) => unknown };
};

function setupNamedObjectPatchFixture(
    globals: GlobalSnapshot,
    runtimeId: "gml_Object_oSpider_Step_0",
    eventIndexPropertyName: "_uB2" | "EVENT_STEP_NORMAL",
    eventIndex: number,
    objectEventFn: (...args: Array<unknown>) => unknown
): ObjectPatchFixture {
    const objectEntry = {
        pName: "oSpider",
        StepNormalEvent: objectEventFn
    };
    const instanceEntry: Record<string, unknown> = {
        _kx: { pName: "oSpider" },
        Event: []
    };

    const jsonGame: JsonGameSnapshot = {
        ScriptNames: [],
        Scripts: [],
        GMObjects: [objectEntry]
    };

    globals.JSON_game = jsonGame;
    globals._cx = {
        _dx: {
            "100000": instanceEntry
        }
    };
    globals[eventIndexPropertyName] = eventIndex;
    globals[runtimeId] = objectEventFn;

    return {
        globals,
        instanceEntry,
        objectEntry
    };
}

await test("applies script patches to GameMaker script registry", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        function gml_Script_test() {
            return "original";
        }

        const jsonGame: JsonGameSnapshot = {
            ScriptNames: ["gml_Script_test"],
            Scripts: [gml_Script_test],
            GMObjects: []
        };

        const globals = globalThis as GlobalSnapshot;
        globals.JSON_game = jsonGame;
        globals.gml_Script_test = gml_Script_test;

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/test",
            runtimeId: "gml_Script_test",
            js_body: "return 42;"
        });

        const updatedFn = globals.gml_Script_test;
        assert.notEqual(updatedFn, gml_Script_test, "Global script reference should be replaced");
        assert.equal(jsonGame.Scripts[0], updatedFn, "JSON_game script table should be updated");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("applies object event patches to GameMaker object tables", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const objectEntry = {
            pName: "oSpider",
            StepNormalEvent: gml_Object_oSpider_Step_0
        };
        const instanceEntry: Record<string, unknown> = {
            _kx: { pName: "oSpider" },
            Event: []
        };

        const jsonGame: JsonGameSnapshot = {
            ScriptNames: [],
            Scripts: [],
            GMObjects: [objectEntry]
        };

        const globals = globalThis as GlobalSnapshot;
        globals.JSON_game = jsonGame;
        globals.gml_Object_oSpider_Step_0 = gml_Object_oSpider_Step_0;
        globals._cx = {
            _dx: {
                "100000": instanceEntry
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "return 99;"
        });

        const updatedFn = globals.gml_Object_oSpider_Step_0;
        assert.notEqual(updatedFn, gml_Object_oSpider_Step_0, "Global event reference should be replaced");
        assert.equal(objectEntry.StepNormalEvent, updatedFn, "GMObjects entry should be updated");
        assert.ok("StepNormalEvent" in instanceEntry, "Instance event handler should be assigned");
        assert.equal(instanceEntry.StepNormalEvent, updatedFn, "Instance event handler should be updated");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("object patches update entries when previous handler is anonymous", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        const objectEntry = {
            pName: "oSpider",
            StepNormalEvent() {
                return "old";
            }
        };
        const instanceEntry: Record<string, unknown> = {
            _kx: { pName: "oSpider" },
            Event: []
        };

        const jsonGame: JsonGameSnapshot = {
            ScriptNames: [],
            Scripts: [],
            GMObjects: [objectEntry]
        };

        const globals = globalThis as GlobalSnapshot;
        globals.JSON_game = jsonGame;
        globals._uB2 = 12;
        globals._cx = {
            _dx: {
                "100000": instanceEntry
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "return 123;"
        });

        const updatedFn = objectEntry.StepNormalEvent;
        assert.equal(typeof updatedFn, "function", "GMObjects entry should be updated");
        assert.equal(instanceEntry.StepNormalEvent, updatedFn, "Instance event handler should be updated");
        const eventArray = instanceEntry.Event as Array<boolean> | undefined;
        assert.ok(Array.isArray(eventArray), "Instance event array should exist");
        assert.equal(eventArray?.[globals._uB2 ?? -1], true, "Instance event flag should be enabled");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("object patches enable instance event flags with standard event indices", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const globals = globalThis as GlobalSnapshot;
        const { instanceEntry, objectEntry } = setupNamedObjectPatchFixture(
            globals,
            "gml_Object_oSpider_Step_0",
            "EVENT_STEP_NORMAL",
            4,
            gml_Object_oSpider_Step_0
        );

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "return 77;"
        });

        const updatedFn = objectEntry.StepNormalEvent;
        assert.equal(instanceEntry.StepNormalEvent, updatedFn, "Instance event handler should be updated");
        const eventArray = instanceEntry.Event as Array<boolean> | undefined;
        assert.ok(Array.isArray(eventArray), "Instance event array should exist");
        assert.equal(eventArray?.[globals.EVENT_STEP_NORMAL ?? -1], true, "Instance event flag should be enabled");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("script patches resolve builtin constants and getters", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        const globals = globalThis as GlobalSnapshot;
        globals.make_colour_rgb = (red, green, blue) => (red & 0xff) | ((green & 0xff) << 8) | ((blue & 0xff) << 16);
        globals.g_pBuiltIn = {
            get_mouse_x: () => 10,
            get_current_time: () => 20
        };
        globals.vk_anykey = 42;

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/constants",
            js_body: "return vk_anykey + mouse_x + current_time + c_blue + pi;"
        });

        const fn = wrapper.getScript("gml/script/constants");
        assert.ok(fn);
        const result = fn(null, null, []) as number;
        const expected = 42 + 10 + 20 + 16_711_680 + Math.PI;
        assert.ok(Math.abs(result - expected) < 1e-9);
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("script patches map GML variables to instance storage", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        const globals = globalThis as GlobalSnapshot;
        globals.g_pBuiltIn = {};

        const instance = { gmlarmNum: 5 };
        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/vars",
            js_body: "armNum = armNum + 1; return armNum;"
        });

        const fn = wrapper.getScript("gml/script/vars");
        assert.ok(fn);
        const result = fn(instance, null, []) as number;

        assert.equal(result, 6);
        assert.equal(instance.gmlarmNum, 6);
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("updates pObject definition on active instances", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        const globals = globalThis as GlobalSnapshot;
        // Function name MUST match for the patcher to find it in GMObjects
        const originalFn = function gml_Object_oSpider_Step_0(..._args: Array<unknown>) {
            void _args;
            return "original";
        };
        globals.gml_Object_oSpider_Step_0 = originalFn;
        globals._uB2 = 5; // Minified index for StepNormalEvent

        // Mock GMObjects so the patcher knows which keys to update
        globals.JSON_game = {
            ScriptNames: [],
            Scripts: [],
            GMObjects: [
                {
                    pName: "oSpider",
                    StepNormalEvent: originalFn
                }
            ]
        };

        const pObject = {
            StepNormalEvent: originalFn,
            Event: [] as Array<boolean>
        };
        const instance = {
            pObject,
            StepNormalEvent: originalFn,
            Event: [] as Array<boolean>
        };

        globals._cx = {
            _dx: {
                "100001": instance
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/object/oSpider/Step_0",
            js_body: "return 'patched';"
        });

        // Verify instance method was updated
        const updatedInstanceFn = instance.StepNormalEvent;
        assert.notEqual(updatedInstanceFn, originalFn);
        assert.equal(updatedInstanceFn(instance, null, []), "patched");

        // Verify pObject method was updated (Critical for event loop)
        const updatedPObjectFn = pObject.StepNormalEvent;
        assert.notEqual(updatedPObjectFn, originalFn);
        assert.equal(updatedPObjectFn(instance, null, []), "patched");

        // Verify event flags were set on both instance and pObject definitions
        assert.equal(instance.Event[5], true);
        assert.equal(pObject.Event[5], true);
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

// Helper used by the event-key mapping tests below. Sets up a minimal
// GMObjects + instance store, applies a patch with the given runtimeId, and
// returns the updated objectEntry and instanceEntry so callers can assert on
// the correct property names.
type EventKeyFixture = {
    objectEntry: Record<string, unknown>;
    instanceEntry: Record<string, unknown>;
};

function applyEventPatchAndGetEntries(
    runtimeId: string,
    eventKey: string,
    originalFn: (...args: Array<unknown>) => unknown
): EventKeyFixture {
    const objectEntry: Record<string, unknown> = {
        pName: "oEnemy",
        [eventKey]: originalFn
    };
    const instanceEntry: Record<string, unknown> = {
        _kx: { pName: "oEnemy" },
        [eventKey]: originalFn,
        Event: []
    };

    const globals = globalThis as Record<string, unknown>;
    globals.JSON_game = {
        ScriptNames: [],
        Scripts: [],
        GMObjects: [objectEntry]
    };
    globals._cx = { _dx: { "200001": instanceEntry } };

    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    wrapper.applyPatch({
        kind: "script",
        id: "gml/script/some_event",
        runtimeId,
        js_body: "return 'updated';"
    });

    return { objectEntry, instanceEntry };
}

await test("object event patches correctly resolve PreCreateEvent key", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_PreCreate_0;

    try {
        function gml_Object_oEnemy_PreCreate_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_PreCreate_0 = gml_Object_oEnemy_PreCreate_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_PreCreate_0",
            "PreCreateEvent",
            gml_Object_oEnemy_PreCreate_0
        );

        const updated = objectEntry.PreCreateEvent;
        assert.equal(typeof updated, "function", "GMObjects PreCreateEvent should be updated");
        assert.equal(updated, instanceEntry.PreCreateEvent, "Instance PreCreateEvent should match GMObjects");
        // Verify the wrong key was NOT touched
        assert.equal(objectEntry.CreateEvent, undefined, "CreateEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_PreCreate_0;
        } else {
            globals.gml_Object_oEnemy_PreCreate_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve CleanUpEvent key", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_CleanUp_0;

    try {
        function gml_Object_oEnemy_CleanUp_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_CleanUp_0 = gml_Object_oEnemy_CleanUp_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_CleanUp_0",
            "CleanUpEvent",
            gml_Object_oEnemy_CleanUp_0
        );

        const updated = objectEntry.CleanUpEvent;
        assert.equal(typeof updated, "function", "GMObjects CleanUpEvent should be updated");
        assert.equal(updated, instanceEntry.CleanUpEvent, "Instance CleanUpEvent should match GMObjects");
        assert.equal(objectEntry.DestroyEvent, undefined, "DestroyEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_CleanUp_0;
        } else {
            globals.gml_Object_oEnemy_CleanUp_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve StepBeginEvent key (not StepNormalEvent)", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_StepBegin_0;

    try {
        function gml_Object_oEnemy_StepBegin_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_StepBegin_0 = gml_Object_oEnemy_StepBegin_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_StepBegin_0",
            "StepBeginEvent",
            gml_Object_oEnemy_StepBegin_0
        );

        const updated = objectEntry.StepBeginEvent;
        assert.equal(typeof updated, "function", "GMObjects StepBeginEvent should be updated");
        assert.equal(updated, instanceEntry.StepBeginEvent, "Instance StepBeginEvent should match GMObjects");
        // Before the fix, "StepBegin_0" was incorrectly routed to "StepNormalEvent"
        assert.equal(objectEntry.StepNormalEvent, undefined, "StepNormalEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_StepBegin_0;
        } else {
            globals.gml_Object_oEnemy_StepBegin_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve StepEndEvent key (not StepNormalEvent)", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_StepEnd_0;

    try {
        function gml_Object_oEnemy_StepEnd_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_StepEnd_0 = gml_Object_oEnemy_StepEnd_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_StepEnd_0",
            "StepEndEvent",
            gml_Object_oEnemy_StepEnd_0
        );

        const updated = objectEntry.StepEndEvent;
        assert.equal(typeof updated, "function", "GMObjects StepEndEvent should be updated");
        assert.equal(updated, instanceEntry.StepEndEvent, "Instance StepEndEvent should match GMObjects");
        assert.equal(objectEntry.StepNormalEvent, undefined, "StepNormalEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_StepEnd_0;
        } else {
            globals.gml_Object_oEnemy_StepEnd_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve DrawGUI key (not DrawEvent)", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_DrawGUI_0;

    try {
        function gml_Object_oEnemy_DrawGUI_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_DrawGUI_0 = gml_Object_oEnemy_DrawGUI_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_DrawGUI_0",
            "DrawGUI",
            gml_Object_oEnemy_DrawGUI_0
        );

        const updated = objectEntry.DrawGUI;
        assert.equal(typeof updated, "function", "GMObjects DrawGUI should be updated");
        assert.equal(updated, instanceEntry.DrawGUI, "Instance DrawGUI should match GMObjects");
        // Before the fix, "DrawGUI_0" was incorrectly routed to "DrawEvent"
        assert.equal(objectEntry.DrawEvent, undefined, "DrawEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_DrawGUI_0;
        } else {
            globals.gml_Object_oEnemy_DrawGUI_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve DrawEventBegin aliases before DrawEvent", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_DrawEventBegin_0;

    try {
        function gml_Object_oEnemy_DrawEventBegin_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_DrawEventBegin_0 = gml_Object_oEnemy_DrawEventBegin_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_DrawEventBegin_0",
            "DrawEventBegin",
            gml_Object_oEnemy_DrawEventBegin_0
        );

        const updated = objectEntry.DrawEventBegin;
        assert.equal(typeof updated, "function", "GMObjects DrawEventBegin should be updated");
        assert.equal(updated, instanceEntry.DrawEventBegin, "Instance DrawEventBegin should match GMObjects");
        assert.equal(objectEntry.DrawEvent, undefined, "DrawEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_DrawEventBegin_0;
        } else {
            globals.gml_Object_oEnemy_DrawEventBegin_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve DrawEventBegin key", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_DrawBegin_0;

    try {
        function gml_Object_oEnemy_DrawBegin_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_DrawBegin_0 = gml_Object_oEnemy_DrawBegin_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_DrawBegin_0",
            "DrawEventBegin",
            gml_Object_oEnemy_DrawBegin_0
        );

        const updated = objectEntry.DrawEventBegin;
        assert.equal(typeof updated, "function", "GMObjects DrawEventBegin should be updated");
        assert.equal(updated, instanceEntry.DrawEventBegin, "Instance DrawEventBegin should match GMObjects");
        assert.equal(objectEntry.DrawEvent, undefined, "DrawEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_DrawBegin_0;
        } else {
            globals.gml_Object_oEnemy_DrawBegin_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve DrawEventEnd key", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_DrawEnd_0;

    try {
        function gml_Object_oEnemy_DrawEnd_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_DrawEnd_0 = gml_Object_oEnemy_DrawEnd_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_DrawEnd_0",
            "DrawEventEnd",
            gml_Object_oEnemy_DrawEnd_0
        );

        const updated = objectEntry.DrawEventEnd;
        assert.equal(typeof updated, "function", "GMObjects DrawEventEnd should be updated");
        assert.equal(updated, instanceEntry.DrawEventEnd, "Instance DrawEventEnd should match GMObjects");
        assert.equal(objectEntry.DrawEvent, undefined, "DrawEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_DrawEnd_0;
        } else {
            globals.gml_Object_oEnemy_DrawEnd_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve DrawGUIBegin key", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_DrawGUIBegin_0;

    try {
        function gml_Object_oEnemy_DrawGUIBegin_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_DrawGUIBegin_0 = gml_Object_oEnemy_DrawGUIBegin_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_DrawGUIBegin_0",
            "DrawGUIBegin",
            gml_Object_oEnemy_DrawGUIBegin_0
        );

        const updated = objectEntry.DrawGUIBegin;
        assert.equal(typeof updated, "function", "GMObjects DrawGUIBegin should be updated");
        assert.equal(updated, instanceEntry.DrawGUIBegin, "Instance DrawGUIBegin should match GMObjects");
        assert.equal(objectEntry.DrawGUI, undefined, "DrawGUI key must not be set");
        assert.equal(objectEntry.DrawEvent, undefined, "DrawEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_DrawGUIBegin_0;
        } else {
            globals.gml_Object_oEnemy_DrawGUIBegin_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("object event patches correctly resolve DrawGUIEnd key", () => {
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);
    const globals = globalThis as Record<string, unknown>;
    const savedGlobal = globals.gml_Object_oEnemy_DrawGUIEnd_0;

    try {
        function gml_Object_oEnemy_DrawGUIEnd_0() {
            return "original";
        }

        globals.gml_Object_oEnemy_DrawGUIEnd_0 = gml_Object_oEnemy_DrawGUIEnd_0;

        const { objectEntry, instanceEntry } = applyEventPatchAndGetEntries(
            "gml_Object_oEnemy_DrawGUIEnd_0",
            "DrawGUIEnd",
            gml_Object_oEnemy_DrawGUIEnd_0
        );

        const updated = objectEntry.DrawGUIEnd;
        assert.equal(typeof updated, "function", "GMObjects DrawGUIEnd should be updated");
        assert.equal(updated, instanceEntry.DrawGUIEnd, "Instance DrawGUIEnd should match GMObjects");
        assert.equal(objectEntry.DrawGUI, undefined, "DrawGUI key must not be set");
        assert.equal(objectEntry.DrawEvent, undefined, "DrawEvent key must not be set");
    } finally {
        if (savedGlobal === undefined) {
            delete globals.gml_Object_oEnemy_DrawGUIEnd_0;
        } else {
            globals.gml_Object_oEnemy_DrawGUIEnd_0 = savedGlobal;
        }
        restoreGlobalProperties(snapshot);
    }
});

await test("script patch updates the correct index in a large script table", () => {
    // Exercises the scriptName→index cache path with a realistically-sized
    // ScriptNames array so that any regression (e.g., off-by-one, stale cache)
    // would be caught by an incorrect index being updated.
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        const TARGET_INDEX = 150;
        const TABLE_SIZE = 300;

        // Build a large ScriptNames/Scripts table
        const scriptNames = Array.from({ length: TABLE_SIZE }, (_, i) => `gml_Script_script_${i}`);
        const scripts = Array.from({ length: TABLE_SIZE }, (_, i) => () => `original_${i}`);

        // Place the patched script at a specific non-trivial index
        scriptNames[TARGET_INDEX] = "gml_Script_test";
        const originalTargetFn = () => "target-original";
        scripts[TARGET_INDEX] = originalTargetFn;

        const jsonGame: JsonGameSnapshot = {
            ScriptNames: scriptNames,
            Scripts: scripts,
            GMObjects: []
        };

        const globals = globalThis as GlobalSnapshot;
        globals.JSON_game = jsonGame;
        globals.gml_Script_test = originalTargetFn;

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/test",
            runtimeId: "gml_Script_test",
            js_body: "return 42;"
        });

        // Only the target index should be updated
        assert.notEqual(jsonGame.Scripts[TARGET_INDEX], originalTargetFn, "Target script should be replaced");
        assert.equal(typeof jsonGame.Scripts[TARGET_INDEX], "function", "Replacement must be a function");
        assert.equal(
            jsonGame.Scripts[TARGET_INDEX],
            globals.gml_Script_test,
            "Global and Scripts table must be in sync"
        );

        // Neighbouring entries must be untouched
        assert.equal(jsonGame.Scripts[TARGET_INDEX - 1]?.(), "original_149", "Script before target must be unchanged");
        assert.equal(jsonGame.Scripts[TARGET_INDEX + 1]?.(), "original_151", "Script after target must be unchanged");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

await test("script patch binding reindexes when scriptNames array reference changes", () => {
    // Validates that the script-name index cache is correctly invalidated and
    // rebuilt when JSON_game.ScriptNames is replaced with a new array instance.
    // This simulates a full game reload scenario where the runtime reinitialises
    // its script table, and a hot-reload patch arrives shortly after.
    const snapshot = snapshotGlobalProperties(runtimeIntegrationPropertyNames);

    try {
        const globals = globalThis as GlobalSnapshot;
        const wrapper = RuntimeWrapper.createRuntimeWrapper();

        // ── Round 1: target at index 42 ──────────────────────────────────────
        const firstScriptNames = Array.from({ length: 100 }, (_, i) => `gml_Script_script_${i}`);
        const firstScripts = Array.from({ length: 100 }, (_, i) => () => `first_${i}`);
        firstScriptNames[42] = "gml_Script_test";
        const firstOriginalFn = () => "first-original";
        firstScripts[42] = firstOriginalFn;

        globals.JSON_game = { ScriptNames: firstScriptNames, Scripts: firstScripts, GMObjects: [] };
        globals.gml_Script_test = firstOriginalFn;

        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/test",
            runtimeId: "gml_Script_test",
            js_body: "return 1;"
        });

        const afterFirstPatch = globals.gml_Script_test;
        assert.notEqual(afterFirstPatch, firstOriginalFn, "Round 1: global should be updated");
        assert.equal(firstScripts[42], afterFirstPatch, "Round 1: Scripts[42] should be updated");

        // ── Round 2: NEW array reference, target at index 77 ─────────────────
        const secondScriptNames = Array.from({ length: 120 }, (_, i) => `gml_Script_script2_${i}`);
        const secondScripts = Array.from({ length: 120 }, (_, i) => () => `second_${i}`);
        secondScriptNames[77] = "gml_Script_test";
        const secondOriginalFn = () => "second-original";
        secondScripts[77] = secondOriginalFn;

        // Replace JSON_game entirely — this gives ScriptNames a new array reference
        globals.JSON_game = { ScriptNames: secondScriptNames, Scripts: secondScripts, GMObjects: [] };
        globals.gml_Script_test = secondOriginalFn;

        wrapper.applyPatch({
            kind: "script",
            id: "gml/script/test",
            runtimeId: "gml_Script_test",
            js_body: "return 2;"
        });

        const afterSecondPatch = globals.gml_Script_test;
        assert.notEqual(afterSecondPatch, secondOriginalFn, "Round 2: global should be updated");
        assert.equal(secondScripts[77], afterSecondPatch, "Round 2: Scripts[77] should be updated");

        // The first table must not have been modified in round 2
        assert.equal(firstScripts[42], afterFirstPatch, "Round 1 table must not be altered by round 2 patch");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});
