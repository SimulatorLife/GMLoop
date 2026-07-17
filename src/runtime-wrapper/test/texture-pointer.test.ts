import assert from "node:assert/strict";
import test from "node:test";

import { applyHtml5TexturePointerSafetyPatch } from "../src/browser/runtime/texture-pointer.js";

function createHtml5TextureHandle(): Record<string, unknown> {
    return {
        WebGLTexture: {},
        TPE: {},
        toString(): string {
            return "Texture:test.png";
        }
    };
}

function createRuntimeScope(): Record<string, unknown> {
    const scope: Record<string, unknown> = {
        html5Names: {
            self: "runtime",
            is_ptr: "isPointer",
            is_real: "isReal",
            sprite_get_texture: "getTexture"
        },
        isPointer: (value: unknown): boolean => value instanceof ArrayBuffer,
        isReal: (value: unknown): boolean => typeof value === "number",
        getTexture: (): unknown => createHtml5TextureHandle()
    };
    return scope;
}

void test("applyHtml5TexturePointerSafetyPatch accepts HTML5 texture handles", () => {
    const scope = createRuntimeScope();
    const texture = (scope.getTexture as () => unknown)();
    const pointerFunctionName = (scope.html5Names as { is_ptr: string }).is_ptr;

    assert.equal(applyHtml5TexturePointerSafetyPatch(scope), true);
    assert.equal((scope[pointerFunctionName] as (value: unknown) => boolean)(texture), true);
    assert.equal((scope[pointerFunctionName] as (value: unknown) => boolean)(new ArrayBuffer(1)), true);
    assert.equal((scope[pointerFunctionName] as (value: unknown) => boolean)({}), false);
});

void test("applyHtml5TexturePointerSafetyPatch is idempotent", () => {
    const scope = createRuntimeScope();

    assert.equal(applyHtml5TexturePointerSafetyPatch(scope), true);
    assert.equal(applyHtml5TexturePointerSafetyPatch(scope), false);
});

void test("applyHtml5TexturePointerSafetyPatch ignores unrelated global objects", () => {
    const unrelatedObject: Record<string, unknown> = {
        is_ptr: "pointer",
        is_real: "real",
        sprite_get_texture: "texture"
    };
    unrelatedObject.self = unrelatedObject;
    const scope: Record<string, unknown> = { objectWithNames: unrelatedObject, pointer: () => false };

    assert.equal(applyHtml5TexturePointerSafetyPatch(scope), false);
});
