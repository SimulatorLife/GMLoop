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
    _xw?: Record<string, string>;
    _w4?: () => number;
    _x4?: () => number;
    _F4?: () => number;
    _S8?: { _AM1?: Array<Record<string, unknown>> };
    _Yw?: { _Zw?: Array<Record<string, unknown>> };
    _W2?: (...args: Array<unknown>) => unknown;
    _X1?: { _S2?: Array<Record<string, unknown>> };
    _A8?: { _9X2?: Record<string, Record<string, unknown>> };
};

const runtimeBindingPropertyNames = [
    "JSON_game",
    "EVENT_STEP_NORMAL",
    "_a1",
    "_c3",
    "_C3",
    "_eb",
    "gml_Object_oSpider_Step_0",
    "_cx",
    "_xw",
    "_w4",
    "_x4",
    "_F4",
    "_S8",
    "_Yw",
    "_W2",
    "_X1",
    "_A8"
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

void test("event patches prefer GameMaker instance context over object arguments", () => {
    const wrapper = RuntimeWrapper.createRuntimeWrapper();
    wrapper.applyPatch({
        kind: "event",
        id: "gml/event/oSpider/Step_0",
        runtimeId: "gml_Object_oSpider_Step_0",
        js_body: "self.x = mouse_x; self.spiderColour = c_green;"
    });

    const fn = wrapper.getEvent("gml/event/oSpider/Step_0");
    assert.ok(fn);

    const snapshot = snapshotGlobalProperties(["mouse_x", "c_green"] as const);
    try {
        const globals = globalThis as { mouse_x?: number; c_green?: number };
        globals.mouse_x = 384;
        globals.c_green = 32_768;

        const instanceEntry: Record<string, unknown> = {
            x: 0,
            spiderColour: 255
        };
        const otherEntry: Record<string, unknown> = {
            x: 12,
            spiderColour: 64
        };

        fn.call(instanceEntry, otherEntry);

        assert.equal(instanceEntry.x, 384, "Patched Step event should update the live GameMaker instance");
        assert.equal(instanceEntry.spiderColour, 32_768, "Patched Step event should update instance fields");
        assert.equal(otherEntry.x, 12, "Auxiliary object arguments should not become self");
        assert.equal(otherEntry.spiderColour, 64, "Auxiliary object arguments should not receive instance writes");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("event patches resolve minified GameMaker runtime value getters", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        const globals = globalThis as RuntimeBindingGlobals;
        globals._xw = {
            mouse_x: "_HV",
            get_mouse_x: "_w4",
            mouse_y: "_LV",
            get_mouse_y: "_x4",
            current_time: "_zy2",
            get_current_time: "_F4",
            variable_instance_get: "_Al3"
        };
        globals._w4 = () => 640;
        globals._x4 = () => 420;
        globals._F4 = () => 123_456;

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "self.x = mouse_x; self.y = mouse_y; self.sampleTime = current_time;"
        });

        const fn = wrapper.getEvent("gml/event/oSpider/Step_0");
        assert.ok(fn);
        const instanceEntry: Record<string, unknown> = {};

        fn.call(instanceEntry);

        assert.equal(instanceEntry.x, 640, "mouse_x should resolve through the minified getter");
        assert.equal(instanceEntry.y, 420, "mouse_y should resolve through the minified getter");
        assert.equal(instanceEntry.sampleTime, 123_456, "current_time should resolve through the minified getter");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("object event patches refresh active instances through Create after handler replacement", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function gml_Object_oSpider_Create_0(this: Record<string, unknown>) {
            this.spiderColour = 255;
        }

        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const objectEntry = {
            Event: [] as Array<boolean>,
            pName: "oSpider",
            CreateEvent: gml_Object_oSpider_Create_0,
            StepNormalEvent: gml_Object_oSpider_Step_0
        };
        const instanceEntry: Record<string, unknown> = {
            Event: [],
            _kx: objectEntry,
            spiderColour: 32_768
        };
        const globals = globalThis as RuntimeBindingGlobals;
        globals.JSON_game = {
            GMObjects: [objectEntry],
            ScriptNames: [],
            Scripts: []
        };
        globals.gml_Object_oSpider_Step_0 = gml_Object_oSpider_Step_0;
        globals._cx = {
            _dx: {
                "100000": instanceEntry
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Create_0",
            runtimeId: "gml_Object_oSpider_Create_0",
            js_body: "self.spiderColour = 255;"
        });

        assert.equal(instanceEntry.spiderColour, 255, "Active instances should be refreshed from Create state");
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("object event patches refresh shape-discovered active instance pools", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function gml_Object_oSpider_Create_0(this: Record<string, unknown>) {
            this.spiderColour = 255;
        }

        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const objectEntry = {
            pName: "oSpider",
            CreateEvent: gml_Object_oSpider_Create_0,
            StepNormalEvent: gml_Object_oSpider_Step_0,
            _Hd2: {
                _Gn: [
                    {
                        id: 100_000,
                        spiderColour: 32_768
                    }
                ]
            }
        };
        const instanceEntry: Record<string, unknown> = {
            _jw: "oSpider",
            x: 384,
            y: 256,
            spiderColour: 32_768,
            StepNormalEvent: gml_Object_oSpider_Step_0,
            _Le2: {
                _Ko: [
                    {
                        id: 100_000,
                        spiderColour: 32_768
                    }
                ]
            }
        };
        const globals = globalThis as RuntimeBindingGlobals;
        globals.JSON_game = {
            GMObjects: [objectEntry],
            ScriptNames: [],
            Scripts: []
        };
        globals.gml_Object_oSpider_Step_0 = gml_Object_oSpider_Step_0;
        globals._S8 = {
            _AM1: [instanceEntry]
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Create_0",
            runtimeId: "gml_Object_oSpider_Create_0",
            js_body: "self.spiderColour = 255;"
        });

        assert.equal(instanceEntry.spiderColour, 255, "Shape-discovered active instances should refresh Create state");
        assert.equal(
            (objectEntry._Hd2 as { _Gn: Array<Record<string, unknown>> })._Gn[0].spiderColour,
            255,
            "Object-owned variable records should refresh Create state"
        );
        assert.equal(
            (instanceEntry._Le2 as { _Ko: Array<Record<string, unknown>> })._Ko[0].spiderColour,
            255,
            "Nested variable records owned by active instances should refresh Create state"
        );
        assert.equal(objectEntry.CreateEvent, wrapper.getEvent("gml/event/oSpider/Create_0"));
    } finally {
        restoreGlobalProperties(snapshot);
    }
});

void test("object event patches refresh shape-discovered variable instance pools", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function gml_Object_oSpider_Create_0(this: Record<string, unknown>) {
            this.spiderColour = 255;
        }

        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const objectEntry = {
            pName: "oSpider",
            CreateEvent: gml_Object_oSpider_Create_0,
            StepNormalEvent: gml_Object_oSpider_Step_0
        };
        const variableInstanceEntry: Record<string, unknown> = {
            id: 100_000,
            _kx: objectEntry,
            x: 384,
            y: 256,
            spiderColour: 32_768
        };
        const globals = globalThis as RuntimeBindingGlobals;
        globals.JSON_game = {
            GMObjects: [objectEntry],
            ScriptNames: [],
            Scripts: []
        };
        globals.gml_Object_oSpider_Step_0 = gml_Object_oSpider_Step_0;
        globals._Yw = {
            _Zw: [variableInstanceEntry]
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Create_0",
            runtimeId: "gml_Object_oSpider_Create_0",
            js_body: "self.spiderColour = 255;"
        });

        assert.equal(
            variableInstanceEntry.spiderColour,
            255,
            "Shape-discovered variable instances should refresh Create state"
        );
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

void test("event patches replace global aliases for current HTML5 minified object handlers", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function originalCreateEvent(this: Record<string, unknown>) {
            this.spiderColour = 255;
        }

        function originalStepEvent(this: Record<string, unknown>) {
            this.spiderColour = 32_768;
        }

        function originalDrawEvent() {
            return "draw";
        }

        const objectEntry: Record<string, unknown> = {
            _32: "oSpider",
            spriteIndex: 2,
            visible: true,
            parent: -100,
            _T2: originalCreateEvent,
            _V2: originalStepEvent,
            _X2: originalDrawEvent
        };
        const mappedObjectEntry: Record<string, unknown> = {
            _32: "oSpider",
            _T2: originalCreateEvent,
            _V2: originalStepEvent,
            _X2: originalDrawEvent,
            _Ic2: {
                _Hm: [
                    {
                        id: 100_000,
                        spiderColour: 32_768
                    }
                ]
            }
        };
        const globals = globalThis as RuntimeBindingGlobals;
        delete globals.JSON_game;
        delete globals._a1;
        delete globals._c3;
        delete globals._C3;
        delete globals._eb;
        globals._W2 = originalStepEvent;
        globals._X1 = {
            _S2: [objectEntry]
        };
        globals._A8 = {
            _9X2: {
                oSpider: mappedObjectEntry
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "self.x = mouse_x;"
        });

        assert.equal(globals._W2, wrapper.getEvent("gml/event/oSpider/Step_0"));
        assert.equal(objectEntry._V2, globals._W2);
        assert.equal(mappedObjectEntry._V2, globals._W2);
        assert.equal(
            (mappedObjectEntry._Ic2 as { _Hm: Array<Record<string, unknown>> })._Hm[0].spiderColour,
            32_768,
            "Object-owned runtime variable records should not refresh after replacing a non-Create global minified alias"
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

void test("non-Create event patches do not reset instance variables through Create event re-run", () => {
    const snapshot = snapshotGlobalProperties(runtimeBindingPropertyNames);

    try {
        function gml_Object_oSpider_Create_0(this: Record<string, unknown>) {
            this.spiderColour = 255;
            this.armPos = [1, 2, 3];
        }

        function gml_Object_oSpider_Step_0() {
            return "original";
        }

        const objectEntry = {
            Event: [] as Array<boolean>,
            pName: "oSpider",
            CreateEvent: gml_Object_oSpider_Create_0,
            StepNormalEvent: gml_Object_oSpider_Step_0
        };
        const instanceEntry: Record<string, unknown> = {
            Event: [],
            _kx: objectEntry,
            spiderColour: 32_768,
            armPos: [4, 5, 6]
        };
        const globals = globalThis as RuntimeBindingGlobals;
        globals.JSON_game = {
            GMObjects: [objectEntry],
            ScriptNames: [],
            Scripts: []
        };
        globals.gml_Object_oSpider_Step_0 = gml_Object_oSpider_Step_0;
        globals._cx = {
            _dx: {
                "100000": instanceEntry
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();

        // Patching Step_0 should NOT reset spiderColour or armPos
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Step_0",
            runtimeId: "gml_Object_oSpider_Step_0",
            js_body: "self.x = mouse_x;"
        });

        assert.equal(instanceEntry.spiderColour, 32_768, "spiderColour should remain untouched when Step_0 is patched");
        assert.deepEqual(instanceEntry.armPos, [4, 5, 6], "armPos should remain untouched when Step_0 is patched");

        // Patching Create_0 SHOULD reset spiderColour and armPos
        wrapper.applyPatch({
            kind: "event",
            id: "gml/event/oSpider/Create_0",
            runtimeId: "gml_Object_oSpider_Create_0",
            js_body: "self.spiderColour = 255; self.armPos = [1, 2, 3];"
        });

        assert.equal(
            instanceEntry.spiderColour,
            255,
            "spiderColour should be reset by Create handler when Create event is patched"
        );
        assert.deepEqual(
            instanceEntry.armPos,
            [1, 2, 3],
            "armPos should be reset by Create handler when Create event is patched"
        );
    } finally {
        restoreGlobalProperties(snapshot);
    }
});
