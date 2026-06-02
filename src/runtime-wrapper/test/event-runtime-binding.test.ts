import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeWrapper } from "../index.js";
import { restoreGlobalProperties, snapshotGlobalProperties } from "./test-helpers/runtime-global-state.js";

type RuntimeBindingGlobals = {
    JSON_game?: {
        ScriptNames: Array<string>;
        Scripts: Array<(...args: Array<unknown>) => unknown>;
        GMObjects: Array<Record<string, unknown>>;
    };
    EVENT_STEP_NORMAL?: number;
    _a1?: {
        _52?: Array<Record<string, unknown>>;
        _98?: Array<string>;
        _a8?: Array<(...args: Array<unknown>) => unknown>;
    };
    _c3?: {
        _74?: Array<Record<string, unknown>>;
        _duplicateObjects?: Array<Record<string, unknown>>;
        _ba?: Array<string>;
        _ca?: Array<(...args: Array<unknown>) => unknown>;
    };
    _C3?: {
        _x4?: Array<Record<string, unknown>>;
    };
    _eb?: {
        _XO1?: Array<Record<string, unknown>>;
    };
    gml_Object_oSpider_Step_0?: (...args: Array<unknown>) => unknown;
    _cx?: { _dx?: Record<string, unknown> };
};

const runtimeBindingPropertyNames = [
    "JSON_game",
    "EVENT_STEP_NORMAL",
    "_a1",
    "_c3",
    "_C3",
    "_eb",
    "gml_Object_oSpider_Step_0",
    "_cx"
] as const;

void test("event patches replace GameMaker object, instance, and pObject handlers", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const objectEntry = {
            Event: [] as Array<boolean>,
            pName: "oSpider",
            StepNormalEvent: gml_Object_oSpider_Step_0
        };
        const instanceEntry: Record<string, unknown> = {
            Event: [],
            _kx: { pName: "oSpider" },
            pObject: objectEntry
        };
        const globals = globalThis as RuntimeBindingGlobals;
        globals.JSON_game = {
            GMObjects: [objectEntry],
            ScriptNames: [],
            Scripts: []
        };
        globals.EVENT_STEP_NORMAL = 4;
        globals.gml_Object_oSpider_Step_0 = gml_Object_oSpider_Step_0;
        globals._cx = {
            _dx: {
                "100000": instanceEntry
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "self.hotReloadEventValue = 42;"
        });

        const updatedFn = globals.gml_Object_oSpider_Step_0;
        assert.notEqual(updatedFn, gml_Object_oSpider_Step_0, "Global event reference should be replaced");
        assert.equal(objectEntry.StepNormalEvent, updatedFn, "GMObjects entry should be updated");
        assert.equal(instanceEntry.StepNormalEvent, updatedFn, "Instance event handler should be updated");
        assert.equal(objectEntry.StepNormalEvent, updatedFn, "Instance pObject event handler should be updated");
        assert.equal((instanceEntry.Event as Array<boolean>)[4], true, "Instance event flag should be enabled");
        assert.equal(objectEntry.Event[4], true, "pObject event flag should be enabled");

        assert.equal(typeof updatedFn, "function", "Updated event handler should be callable");
        updatedFn(instanceEntry, instanceEntry);
        assert.equal(instanceEntry.hotReloadEventValue, 42, "Updated event handler should execute patched body");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("event patches replace minified GameMaker object handlers by generated field shape", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function originalCreateEvent() {
            return "create";
        }

        function originalStepEvent() {
            return "original";
        }

        function originalDrawEvent() {
            return "draw";
        }

        const objectEntry: {
            _j3: string;
            spriteIndex: number;
            visible: boolean;
            parent: number;
            _84: (...args: Array<unknown>) => unknown;
            _a4: (...args: Array<unknown>) => unknown;
            _c4: (...args: Array<unknown>) => unknown;
            _g4: Array<boolean>;
        } = {
            _j3: "oSpider",
            spriteIndex: 2,
            visible: true,
            parent: -100,
            _84: originalCreateEvent,
            _a4: originalStepEvent,
            _c4: originalDrawEvent,
            _g4: []
        };
        const duplicateObjectEntry = {
            _j3: "oSpider",
            _84: originalCreateEvent,
            _a4: originalStepEvent,
            _c4: originalDrawEvent
        };
        const globals = globalThis as RuntimeBindingGlobals;
        delete globals.JSON_game;
        delete globals._a1;
        globals._c3 = {
            _74: [objectEntry],
            _duplicateObjects: [duplicateObjectEntry],
            _ba: ["gml_Script_placeholder"],
            _ca: [() => undefined]
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "self.hotReloadEventValue = 84;"
        });

        const updatedFn = objectEntry._a4;
        assert.notEqual(updatedFn, originalStepEvent, "Minified Step handler should be replaced");
        assert.equal(duplicateObjectEntry._a4, updatedFn, "Duplicate minified Step handler should be replaced");
        assert.equal(objectEntry._84, originalCreateEvent, "Minified Create handler should not be replaced");
        assert.equal(objectEntry._c4, originalDrawEvent, "Minified Draw handler should not be replaced");
        assert.equal(typeof updatedFn, "function", "Updated minified Step handler should be callable");

        const instanceEntry: Record<string, unknown> = {};
        updatedFn(instanceEntry, instanceEntry);
        assert.equal(instanceEntry.hotReloadEventValue, 84, "Updated minified Step handler should run patched body");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("event patches replace current HTML5 minified object and active instance handlers", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function originalCreateEvent() {
            return "create";
        }

        function originalStepEvent() {
            return "original";
        }

        function originalDrawEvent() {
            return "draw";
        }

        const objectEntry: {
            _J3: string;
            spriteIndex: number;
            visible: boolean;
            parent: number;
            _y4: (...args: Array<unknown>) => unknown;
            _A4: (...args: Array<unknown>) => unknown;
            _C4: (...args: Array<unknown>) => unknown;
            _G4: Array<boolean>;
        } = {
            _J3: "oSpider",
            spriteIndex: 2,
            visible: true,
            parent: -100,
            _y4: originalCreateEvent,
            _A4: originalStepEvent,
            _C4: originalDrawEvent,
            _G4: []
        };
        const activeInstanceEntry: Record<string, unknown> = {
            _Gy: "oSpider",
            _9F: 2,
            _ZO1: -100,
            _y4: originalCreateEvent,
            _A4: originalStepEvent,
            _C4: originalDrawEvent
        };
        const globals = globalThis as RuntimeBindingGlobals;
        delete globals.JSON_game;
        delete globals._a1;
        delete globals._c3;
        globals._C3 = {
            _x4: [objectEntry]
        };
        globals._eb = {
            _XO1: [activeInstanceEntry]
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "self.hotReloadEventValue = 126;"
        });

        const updatedFn = objectEntry._A4;
        assert.notEqual(updatedFn, originalStepEvent, "Current minified Step handler should be replaced");
        assert.equal(activeInstanceEntry._A4, updatedFn, "Active minified instance Step handler should be replaced");
        assert.equal(objectEntry._y4, originalCreateEvent, "Current minified Create handler should not be replaced");
        assert.equal(objectEntry._C4, originalDrawEvent, "Current minified Draw handler should not be replaced");
        assert.equal(
            activeInstanceEntry._y4,
            originalCreateEvent,
            "Active instance Create handler should not be replaced"
        );
        assert.equal(activeInstanceEntry._C4, originalDrawEvent, "Active instance Draw handler should not be replaced");

        updatedFn(activeInstanceEntry, activeInstanceEntry);
        assert.equal(
            activeInstanceEntry.hotReloadEventValue,
            126,
            "Updated current minified Step handler should run patched body"
        );
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("event patches resolve wrapper-owned GameMaker builtins and constants", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    wrapper.applyPatch({
        kind: "event",
        id: "gml/event/oSpider/Step_0",
        runtimeId: "gml_Object_oSpider_Step_0",
        js_body: [
            "self.spiderColour = c_green;",
            "self.distance = point_distance(0, 0, 3, 4);",
            "self.midpoint = lerp(10, 20, 0.25);",
            "array_copy(self.destination, 1, self.source, 0, 2);"
        ].join("\n")
    });

    const fn = wrapper.getEvent("gml/event/oSpider/Step_0");
    assert.ok(fn);
    const instanceEntry: Record<string, unknown> = {
        destination: [0, 0, 0],
        source: [7, 8]
    };
    fn(instanceEntry, instanceEntry);

    assert.equal(instanceEntry.spiderColour, 32_768);
    assert.equal(instanceEntry.distance, 5);
    assert.equal(instanceEntry.midpoint, 12.5);
    assert.deepEqual(instanceEntry.destination, [0, 7, 8]);
});
