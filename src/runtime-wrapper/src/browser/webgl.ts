type BrowserGlobalScope = Record<string, unknown>;

/**
 * Apply safety patches to the WebGL context creation and shader compilation logic.
 *
 * This enables Multiple Render Targets (MRT) by automatically requesting the
 * WEBGL_draw_buffers extension when creating WebGL 1.0 contexts. It also patches
 * WebGLRenderingContext and WebGL2RenderingContext's shaderSource method to
 * prepends the `#extension GL_EXT_draw_buffers : enable` directive if the shader
 * contains references to `gl_FragData`.
 */
export function applyWebGLSafetyPatches(globalScope: BrowserGlobalScope): void {
    const canvasProto = (globalScope.HTMLCanvasElement as any)?.prototype;
    if (canvasProto && typeof canvasProto.getContext === "function") {
        const originalGetContext = canvasProto.getContext;
        canvasProto.getContext = function (this: any, contextId: string, options?: any) {
            const gl = originalGetContext.call(this, contextId, options);
            if (gl && (contextId === "webgl" || contextId === "experimental-webgl") && // Request WEBGL_draw_buffers extension to enable it on the WebGL context
                typeof gl.getExtension === "function") {
                    gl.getExtension("WEBGL_draw_buffers");
                }
            return gl;
        };
    }

    const glProto = (globalScope.WebGLRenderingContext as any)?.prototype;
    if (glProto && typeof glProto.shaderSource === "function") {
        const originalShaderSource = glProto.shaderSource;
        glProto.shaderSource = function (this: any, shader: any, source: string) {
            let modifiedSource = source;
            if (
                typeof source === "string" &&
                source.includes("gl_FragData") &&
                !source.includes("GL_EXT_draw_buffers")
            ) {
                // Inject the extension line at the top of the shader source
                modifiedSource = `#extension GL_EXT_draw_buffers : enable\n${  source}`;
            }
            originalShaderSource.call(this, shader, modifiedSource);
        };
    }

    const gl2Proto = (globalScope.WebGL2RenderingContext as any)?.prototype;
    if (gl2Proto && typeof gl2Proto.shaderSource === "function") {
        const originalShaderSource = gl2Proto.shaderSource;
        gl2Proto.shaderSource = function (this: any, shader: any, source: string) {
            let modifiedSource = source;
            if (
                typeof source === "string" &&
                source.includes("gl_FragData") &&
                !source.includes("GL_EXT_draw_buffers")
            ) {
                modifiedSource = `#extension GL_EXT_draw_buffers : enable\n${  source}`;
            }
            originalShaderSource.call(this, shader, modifiedSource);
        };
    }
}
