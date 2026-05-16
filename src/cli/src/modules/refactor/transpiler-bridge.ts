import { Core } from "@gmloop/core";
import type * as Refactor from "@gmloop/refactor";
import { Transpiler } from "@gmloop/transpiler";

/**
 * Shape of the transpiler adapter used by GmlTranspilerBridge.
 * Keeping this narrow avoids coupling the bridge to the full Transpiler
 * workspace surface and lets callers inject test doubles with minimal
 * ceremony.
 */
export type GmlTranspilerAdapter = {
    transpileScript(request: { sourceText: string; symbolId: string }): unknown;
};

/**
 * Transpiler bridge that adapts @gmloop/transpiler to the refactor engine.
 */
export class GmlTranspilerBridge implements Refactor.TranspilerBridge {
    private readonly transpiler: GmlTranspilerAdapter;

    /**
     * @param adapter - Optional transpiler adapter.  When omitted the canonical
     *   `Transpiler.GmlTranspiler()` is used, keeping backward compatibility for
     *   callers that construct the bridge with no arguments.
     */
    constructor(adapter?: GmlTranspilerAdapter) {
        this.transpiler = adapter ?? new Transpiler.GmlTranspiler();
    }

    /**
     * Transpile a script into a hot-reload compatibility patch.
     * @param request Transpilation request details
     */
    transpileScript(request: { sourceText: string; symbolId: string }): Refactor.MaybePromise<Record<string, unknown>> {
        const { sourceText, symbolId } = request;

        try {
            const result = this.transpiler.transpileScript({ sourceText, symbolId });
            // Narrow `unknown` to a plain object so spreading is type-safe.
            // Bridges are internal adapters; we control the adapter contract.
            const safeResult = Core.isObjectLike(result) ? (result as Record<string, unknown>) : {};
            return { ...safeResult, success: true };
        } catch (error) {
            throw new Error(`Transpilation failed: ${Core.isErrorLike(error) ? error.message : String(error)}`);
        }
    }
}
