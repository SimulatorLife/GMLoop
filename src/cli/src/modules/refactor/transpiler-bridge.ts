import { Core } from "@gmloop/core";
import type * as Refactor from "@gmloop/refactor";
import { Transpiler } from "@gmloop/transpiler";

/**
 * Transpiler bridge that adapts @gmloop/transpiler to the refactor engine.
 */
export class GmlTranspilerBridge implements Refactor.TranspilerBridge {
    /**
     * Transpile a script into a hot-reload compatibility patch.
     * @param request Transpilation request details
     */
    transpileScript(request: { sourceText: string; symbolId: string }): Refactor.MaybePromise<Record<string, unknown>> {
        const { sourceText, symbolId } = request;

        // Note: For full semantic-aware transpilation, we would need a semantic oracle.
        // For rename validation purposes, a basic transpiler usually suffices.
        const transpiler = new Transpiler.GmlTranspiler();

        try {
            const result = transpiler.transpileScript({
                sourceText,
                symbolId
            });
            return {
                ...result,
                success: true
            };
        } catch (error) {
            // Use a capability probe rather than `instanceof Error` so that
            // cross-realm errors (e.g. from sandboxed transpiler instances) are handled.
            throw new Error(`Transpilation failed: ${Core.isErrorLike(error) ? error.message : String(error)}`);
        }
    }
}
