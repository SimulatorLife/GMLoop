import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isHtml5BuiltinNameMap, resolveHtml5BuiltinNameMap } from "../src/browser/support/html5-builtin-discovery.js";

void describe("html5-builtin-discovery", () => {
    void describe("isHtml5BuiltinNameMap", () => {
        void it("rejects non-object values", () => {
            assert.equal(isHtml5BuiltinNameMap(null, { is_ptr: "is_ptr" }), false);
            assert.equal(isHtml5BuiltinNameMap(undefined, { is_ptr: "is_ptr" }), false);
            assert.equal(isHtml5BuiltinNameMap("string", { is_ptr: "is_ptr" }), false);
            assert.equal(isHtml5BuiltinNameMap(42, { is_ptr: "is_ptr" }), false);
            assert.equal(isHtml5BuiltinNameMap(true, { is_ptr: "is_ptr" }), false);
        });

        void it("rejects arrays even though they are object-shaped", () => {
            assert.equal(isHtml5BuiltinNameMap([], { is_ptr: "is_ptr" }), false);
            assert.equal(isHtml5BuiltinNameMap(["is_ptr"], { is_ptr: "is_ptr" }), false);
        });

        void it("rejects self-referencing values", () => {
            const selfReferencing: Record<string, unknown> = { is_ptr: "minified" };
            selfReferencing.self = selfReferencing;
            assert.equal(isHtml5BuiltinNameMap(selfReferencing, { is_ptr: "is_ptr" }), false);
        });

        void it("rejects maps missing any requested builtin", () => {
            const partialMap = { is_ptr: "minified" };
            assert.equal(isHtml5BuiltinNameMap(partialMap, { is_ptr: "is_ptr", is_real: "is_real" }), false);
        });

        void it("rejects maps whose builtin keys are not strings", () => {
            const nonStringMap = { is_ptr: 42, is_real: "minified" };
            assert.equal(isHtml5BuiltinNameMap(nonStringMap, { is_ptr: "is_ptr", is_real: "is_real" }), false);
        });

        void it("accepts maps with all requested builtin keys as strings", () => {
            const fullMap = {
                is_ptr: "minifiedIsPtr",
                is_real: "minifiedIsReal",
                sprite_get_texture: "minifiedGetTexture"
            };
            assert.equal(
                isHtml5BuiltinNameMap(fullMap, {
                    is_ptr: "is_ptr",
                    is_real: "is_real",
                    sprite_get_texture: "sprite_get_texture"
                }),
                true
            );
        });

        void it("tolerates extra keys on the candidate map", () => {
            const mapWithExtras = {
                is_ptr: "minifiedIsPtr",
                is_real: "minifiedIsReal",
                sprite_get_texture: "minifiedGetTexture",
                extra_helpful_field: "ignored"
            };
            assert.equal(
                isHtml5BuiltinNameMap(mapWithExtras, {
                    is_ptr: "is_ptr",
                    is_real: "is_real",
                    sprite_get_texture: "sprite_get_texture"
                }),
                true
            );
        });
    });

    void describe("resolveHtml5BuiltinNameMap", () => {
        void it("returns null when no property matches the requested shape", () => {
            const scope: Record<string, unknown> = {
                unrelated: { other: "value" },
                number: 42,
                string: "hello"
            };
            assert.equal(resolveHtml5BuiltinNameMap(scope, { is_ptr: "is_ptr", is_real: "is_real" }), null);
        });

        void it("returns the first matching name map from the global scope", () => {
            const matchingMap = {
                is_ptr: "minifiedIsPtr",
                is_real: "minifiedIsReal",
                sprite_get_texture: "minifiedGetTexture"
            };
            const scope: Record<string, unknown> = {
                unrelated: { other: "value" },
                html5Names: matchingMap
            };
            const resolved = resolveHtml5BuiltinNameMap(scope, {
                is_ptr: "is_ptr",
                is_real: "is_real",
                sprite_get_texture: "sprite_get_texture"
            });
            assert.equal(resolved, matchingMap);
        });

        void it("skips properties whose getter throws", () => {
            const throwingScope = new Proxy(
                { validMap: { filename_change_ext: "minifiedFilenameChangeExt" } },
                {
                    ownKeys() {
                        return ["validMap", "throwing"];
                    },
                    getOwnPropertyDescriptor() {
                        return { configurable: true, enumerable: true, value: undefined };
                    },
                    get(_target, property, _receiver) {
                        if (property === "throwing") {
                            throw new Error("cross-realm getter");
                        }
                        if (property === "validMap") {
                            return { filename_change_ext: "minifiedFilenameChangeExt" };
                        }
                        return undefined;
                    }
                }
            ) as unknown as Record<string, unknown>;

            const resolved = resolveHtml5BuiltinNameMap(throwingScope, {
                filename_change_ext: "filename_change_ext"
            });
            assert.notEqual(resolved, null);
            assert.equal(resolved?.filename_change_ext, "minifiedFilenameChangeExt");
        });

        void it("returns the first match when multiple properties match", () => {
            const firstMap = { is_ptr: "firstMinifiedPtr" };
            const secondMap = { is_ptr: "secondMinifiedPtr" };
            const scope: Record<string, unknown> = {
                first: firstMap,
                second: secondMap
            };
            const resolved = resolveHtml5BuiltinNameMap(scope, { is_ptr: "is_ptr" });
            assert.equal(resolved, firstMap);
        });

        void it("does not match a property whose own keys are missing the requested builtin", () => {
            const scope: Record<string, unknown> = {
                almost: { is_ptr: "minified" }
            };
            assert.equal(resolveHtml5BuiltinNameMap(scope, { is_ptr: "is_ptr", is_real: "is_real" }), null);
        });
    });
});
