import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPatchLike, validatePatch } from "../browser/runtime/patch-utils.js";
import type { Patch, ScriptPatch } from "../browser/runtime/types.js";

void describe("isPatchLike", () => {
    void it("accepts a structurally valid script patch", () => {
        const candidate: ScriptPatch = {
            kind: "script",
            id: "gml/script/scr_move",
            js_body: "x += 1;"
        };

        assert.strictEqual(isPatchLike(candidate), true);
    });

    void it("accepts plain objects that mimic the contract", () => {
        // Cross-realm / structural copies: no prototype shared with `Patch`.
        const structural = Object.create(null) as unknown as Patch;
        (structural as { kind?: unknown }).kind = "event";
        (structural as { id?: unknown }).id = "gml/event/obj_player/step";

        assert.strictEqual(isPatchLike(structural), true);
    });

    void it("rejects unsupported patch kinds", () => {
        const candidate = { kind: "macro", id: "gml/macro/foo" };
        assert.strictEqual(isPatchLike(candidate), false);
    });

    void it("rejects non-string ids", () => {
        const candidate = { kind: "script", id: 42 };
        assert.strictEqual(isPatchLike(candidate), false);
    });

    void it("rejects empty-string ids", () => {
        const candidate = { kind: "script", id: "" };
        assert.strictEqual(isPatchLike(candidate), false);
    });

    void it("rejects null, undefined, and primitives", () => {
        assert.strictEqual(isPatchLike(null), false);
        assert.strictEqual(isPatchLike(undefined), false);
        assert.strictEqual(isPatchLike("script"), false);
        assert.strictEqual(isPatchLike(42), false);
        assert.strictEqual(isPatchLike(true), false);
    });

    void it("rejects objects missing the kind field", () => {
        assert.strictEqual(isPatchLike({ id: "gml/script/scr_move" }), false);
    });

    void it("rejects objects missing the id field", () => {
        assert.strictEqual(isPatchLike({ kind: "script" }), false);
    });

    void it("stays non-throwing for non-object inputs", () => {
        // The probe must never raise; consumers rely on a boolean outcome to
        // branch on shape without try/catch scaffolding.
        assert.doesNotThrow(() => isPatchLike(null));
        assert.doesNotThrow(() => isPatchLike(undefined));
        assert.doesNotThrow(() => isPatchLike(Symbol.for("patch")));
    });
});

void describe("validatePatch", () => {
    void it("does not throw for objects that satisfy PatchLike", () => {
        const candidate: ScriptPatch = {
            kind: "script",
            id: "gml/script/scr_move",
            js_body: "x += 1;"
        };

        assert.doesNotThrow(() => validatePatch(candidate));
    });

    void it("throws TypeError for non-patch-like inputs", () => {
        assert.throws(() => validatePatch(null), TypeError);
        assert.throws(() => validatePatch({ kind: "script" }), TypeError);
        assert.throws(() => validatePatch({ id: "gml/script/scr_move" }), TypeError);
        assert.throws(() => validatePatch({ kind: "macro", id: "gml/macro/foo" }), TypeError);
    });
});
