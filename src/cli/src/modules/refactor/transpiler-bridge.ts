import { Core } from "@gmloop/core";
import type * as Refactor from "@gmloop/refactor";

import type { GmlTranspilerAdapter, TranspilerAdapterFactory } from "./bridge-types.js";

/**
 * Transpiler bridge that adapts a GML transpiler to the refactor engine's transpiler contract.
 *
 * The transpiler adapter is injected through the constructor so callers can supply
 * a mock or alternate adapter for testing.  The default adapter is provided by the
 * bridge-dependencies module and assembled by bridge-factory.ts, keeping concrete
 * workspace imports out of this adapter class.
 */
export class GmlTranspilerBridge implements Refactor.TranspilerBridge {
    private readonly transpiler: GmlTranspilerAdapter;

    /**
     * @param transpilerAdapterFactory - Optional factory that returns a transpiler adapter.
     *   When omitted, the caller (typically the bridge-factory) is responsible for
     *   providing the default adapter through the factory function.
     */
    constructor(transpilerAdapterFactory?: TranspilerAdapterFactory) {
        this.transpiler = transpilerAdapterFactory
            ? transpilerAdapterFactory()
            : {
                  transpileScript: () => ({})
              };
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
            throw new Error(`Transpilation failed: ${Core.isErrorLike(error) ? error.message : String(error)}`, {
                cause: error
            });
        }
    }
}
