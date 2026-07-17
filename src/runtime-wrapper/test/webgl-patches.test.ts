import assert from "node:assert/strict";
import test from "node:test";

import { applyWebGLSafetyPatches } from "../src/browser/webgl.js";

void test("WebGL safety patches hook getContext and shaderSource", () => {
    // 1. Mocking HTMLCanvasElement prototype
    const mockCanvasProto = {
        getContext(_contextId: string, _options?: any) {
            return mockGlContext;
        }
    };

    let getExtensionCalledWith: string | null = null;
    const mockGlContext = {
        getExtension: (name: string) => {
            getExtensionCalledWith = name;
            return {};
        }
    };

    // 2. Mocking WebGLRenderingContext prototype
    let shaderSourceCalledWith: [any, string] | null = null;
    const mockGlProto = {
        shaderSource(shader: any, source: string) {
            shaderSourceCalledWith = [shader, source];
        }
    };

    // 3. Mocking WebGL2RenderingContext prototype
    let shaderSource2CalledWith: [any, string] | null = null;
    const mockGl2Proto = {
        shaderSource(shader: any, source: string) {
            shaderSource2CalledWith = [shader, source];
        }
    };

    const mockGlobal = {
        HTMLCanvasElement() {},
        WebGLRenderingContext() {},
        WebGL2RenderingContext() {}
    } as any;

    mockGlobal.HTMLCanvasElement.prototype = mockCanvasProto;
    mockGlobal.WebGLRenderingContext.prototype = mockGlProto;
    mockGlobal.WebGL2RenderingContext.prototype = mockGl2Proto;

    // Apply the safety patches
    applyWebGLSafetyPatches(mockGlobal);

    // Verify HTMLCanvasElement.prototype.getContext hooking
    const canvasInstance = Object.create(mockCanvasProto);
    const gl = canvasInstance.getContext("webgl");
    assert.strictEqual(gl, mockGlContext);
    assert.strictEqual(getExtensionCalledWith, "WEBGL_draw_buffers");

    // Verify shaderSource on WebGLRenderingContext
    const shader = {};
    const glInstance = Object.create(mockGlProto);

    // Scenario 1: Shader using gl_FragData without extension
    glInstance.shaderSource(shader, "void main() { gl_FragData[0] = vec4(1.0); }");
    assert.ok(shaderSourceCalledWith);
    assert.strictEqual(shaderSourceCalledWith[0], shader);
    assert.ok(shaderSourceCalledWith[1].startsWith("#extension GL_EXT_draw_buffers : enable"));

    // Scenario 2: Shader using gl_FragData that already has extension
    glInstance.shaderSource(
        shader,
        "#extension GL_EXT_draw_buffers : enable\nvoid main() { gl_FragData[0] = vec4(1.0); }"
    );
    assert.ok(shaderSourceCalledWith);
    assert.strictEqual(
        shaderSourceCalledWith[1],
        "#extension GL_EXT_draw_buffers : enable\nvoid main() { gl_FragData[0] = vec4(1.0); }"
    );

    // Scenario 3: Shader not using gl_FragData
    glInstance.shaderSource(shader, "void main() { gl_FragColor = vec4(1.0); }");
    assert.ok(shaderSourceCalledWith);
    assert.strictEqual(shaderSourceCalledWith[1], "void main() { gl_FragColor = vec4(1.0); }");

    // Verify shaderSource on WebGL2RenderingContext
    const gl2Instance = Object.create(mockGl2Proto);
    gl2Instance.shaderSource(shader, "void main() { gl_FragData[0] = vec4(1.0); }");
    assert.ok(shaderSource2CalledWith);
    assert.ok(shaderSource2CalledWith[1].startsWith("#extension GL_EXT_draw_buffers : enable"));
});
