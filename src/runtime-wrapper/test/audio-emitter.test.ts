import assert from "node:assert/strict";
import test from "node:test";

import { applyHtml5AudioEmitterSafetyPatch } from "../src/browser/runtime/audio-emitter.js";

function createRuntimeScope(audioInitialized: boolean): Record<string, unknown> {
    const scope: Record<string, unknown> = {};
    class AudioContext {}
    class AudioFallback {}
    const emitters: Array<{ _dR4?: boolean }> = [];
    scope._a65 = audioInitialized ? new AudioContext() : null;
    scope._765 = AudioContext;
    scope._665 = AudioFallback;
    scope._K45 = emitters;
    scope._d65 = function _d65(): boolean {
        const _765 = AudioContext;
        const _665 = AudioFallback;
        return scope._a65 instanceof _765 || scope._a65 instanceof _665;
    };
    scope._Wo3 = function _Wo3(): number {
        const _K45 = emitters;
        const _P85 = _K45.findIndex((entry) => entry._dR4 === false);
        if (_P85 !== -1) {
            return _P85;
        }
        const _985 = class {};
        const emitter = new _985();
        _K45.push(emitter);
        return _K45.length - 1;
    };
    return scope;
}

void test("applyHtml5AudioEmitterSafetyPatch defers creation until audio is initialized", () => {
    const scope = createRuntimeScope(false);
    const createFunctionName = "_Wo3";

    assert.equal(applyHtml5AudioEmitterSafetyPatch(scope), true);
    assert.equal((scope[createFunctionName] as () => unknown)(), undefined);
    assert.equal((scope._K45 as Array<unknown>).length, 0);
});

void test("applyHtml5AudioEmitterSafetyPatch preserves initialized creation", () => {
    const scope = createRuntimeScope(true);

    assert.equal(applyHtml5AudioEmitterSafetyPatch(scope), true);
    assert.equal((scope._Wo3 as () => unknown)(), 0);
    assert.equal((scope._K45 as Array<unknown>).length, 1);
});

void test("applyHtml5AudioEmitterSafetyPatch is idempotent", () => {
    const scope = createRuntimeScope(false);

    assert.equal(applyHtml5AudioEmitterSafetyPatch(scope), true);
    assert.equal(applyHtml5AudioEmitterSafetyPatch(scope), false);
});
