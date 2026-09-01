import { Core } from "@gmloop/core";
import type * as Refactor from "@gmloop/refactor";

import type { GmlTranspilerAdapter } from "./bridge-types.js";

/**
 * Transpiler bridge that adapts a GML transpiler to the refactor engine's transpiler contract.
 *
 * The transpiler adapter is injected through the constructor so callers can supply
 * a stub for testing. The default adapter is assembled by `bridge-factory.ts`,
 * which is the only module in this cluster that imports the concrete
 * transpiler workspace.
 */
export class GmlTranspilerBridge implements Refactor.TranspilerBridge {
    private readonly transpiler: GmlTranspilerAdapter;

    /**
     * @param transpilerAdapter - Optional transpiler adapter. When omitted, the
     *   bridge falls back to a no-op adapter so the engine can still be
     *   constructed in test environments that do not need a working transpiler.
     */
    constructor(transpilerAdapter?: GmlTranspilerAdapter) {
        this.transpiler = transpilerAdapter ?? { transpileScript: () => ({}) };
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
            // Use a capability probe rather than `instanceof Error` so that
            // cross-realm errors (e.g. from sandboxed transpiler instances) are handled.
            throw Core.toContextualError("Transpilation failed", error);
        }
    }
}
