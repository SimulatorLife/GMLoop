/**
 * @gmloop/runtime-wrapper — Runtime Readiness Mechanism
 *
 * ## Separation of concerns
 *
 * The policy that decides whether a GameMaker runtime snapshot is ready
 * to accept websocket patches lives in
 * {@link ./runtime-readiness-policy.ts}. This module owns the
 * side effects the mechanism needs to drive that policy from the live
 * websocket client:
 *
 *   - reading the `globalThis` snapshot to feed the policy evaluator,
 *   - holding the cached readiness flag the caller already trusts, and
 *   - defining the `application_surface` accessor on the global so the
 *     runtime wrapper can read and write the builtin table without
 *     touching the minified global directly.
 *
 * Keeping the policy in its own module (see
 * `runtime-readiness-policy.ts`) lets the readiness contract be unit
 * tested in isolation, while the mechanism stays a thin wrapper that
 * composes the policy verdict with the surrounding client state.
 */

import { evaluateRuntimeReadiness } from "./runtime-readiness-policy.js";

/**
 * Determine whether the GameMaker runtime is ready to accept websocket
 * patches.
 *
 * The mechanism applies the cached readiness short-circuit before
 * asking the policy to probe the globals. When the cache says "ready"
 * we never re-scan the global surface, which both avoids redundant
 * work on the hot path and keeps the cached flag the single source of
 * truth once the runtime has signalled readiness.
 *
 * @param runtimeReady The previously cached readiness state.
 * @returns True when the runtime is already known to be ready or is now
 *          detected as ready by the policy.
 */
export function resolveRuntimeReadiness(runtimeReady: boolean): boolean {
    if (runtimeReady) {
        return true;
    }

    const decision = evaluateRuntimeReadiness({ globals: globalThis });
    return decision.state === "ready";
}

/**
 * Ensure the global `application_surface` property forwards to the
 * GameMaker builtin table.
 */
export function ensureApplicationSurfaceAccessor(): void {
    const globals = globalThis as Record<string, unknown>;
    const builtins = globals.g_pBuiltIn;
    if (builtins === null || typeof builtins !== "object") {
        return;
    }

    if (Object.hasOwn(globals, "application_surface")) {
        return;
    }

    Object.defineProperty(globals, "application_surface", {
        configurable: true,
        enumerable: true,
        get() {
            const runtimeGlobals = globalThis as Record<string, unknown>;
            const runtimeBuiltins = runtimeGlobals.g_pBuiltIn as Record<string, unknown> | undefined;
            return runtimeBuiltins?.application_surface;
        },
        set(value) {
            const runtimeGlobals = globalThis as Record<string, unknown>;
            const runtimeBuiltins = runtimeGlobals.g_pBuiltIn as Record<string, unknown> | undefined;
            if (runtimeBuiltins) {
                runtimeBuiltins.application_surface = value;
            }
        }
    });
}
