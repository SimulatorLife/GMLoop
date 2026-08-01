import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeWrapper } from "../index.js";

void test("resource patches update a live background layer without evaluating code", () => {
    const globalScope = globalThis as Record<string, unknown>;
    const originalRunRoom = globalScope.g_RunRoom;
    const originalConvertColour = globalScope.ConvertGMColour;
    const background = { blend: 0, alpha: 1, visible: true, vtiled: false };
    const layer = { m_pName: "Background", m_hspeed: 0, m_elements: { pool: [{ m_pBackground: background }] } };

    try {
        globalScope.ConvertGMColour = (colour: number) => colour & 0x00_ff_ff_ff;
        globalScope.g_RunRoom = {
            m_Layers: {
                pool: [layer]
            }
        };

        const wrapper = RuntimeWrapper.createRuntimeWrapper();
        wrapper.applyPatch({
            kind: "resource",
            id: "resource/room/Room1",
            resourceType: "GMRoom",
            resourceName: "Room1",
            layerUpdates: [
                {
                    layerName: "Background",
                    layerType: "GMRBackgroundLayer",
                    properties: { colour: 0x80_ff_00_00, hspeed: 2, vtiled: true }
                }
            ]
        });

        assert.strictEqual(background.blend, 0x00_ff_00_00);
        assert.strictEqual(background.alpha, 128 / 255);
        assert.strictEqual(layer.m_hspeed, 2);
        assert.strictEqual(background.vtiled, true);
        assert.ok(wrapper.state.registry.resources?.["resource/room/Room1"]);
    } finally {
        if (originalRunRoom === undefined) {
            delete globalScope.g_RunRoom;
        } else {
            globalScope.g_RunRoom = originalRunRoom;
        }
        if (originalConvertColour === undefined) {
            delete globalScope.ConvertGMColour;
        } else {
            globalScope.ConvertGMColour = originalConvertColour;
        }
    }
});
