import { type LiveReloadBootstrapConfig, liveReloadBootstrapConfig } from "./config.js";
import { LIVE_RELOAD_LOG_LEVELS, type LiveReloadLogLevel } from "./log-levels.js";
import {
    applyHtml5AudioEmitterSafetyPatch,
    applyHtml5FilenameChangeExtSafetyPatch,
    applyHtml5TexturePointerSafetyPatch,
    createRuntimeWrapper,
    installScriptCallAdapter
} from "./runtime/index.js";
import { applyWebGLSafetyPatches } from "./webgl.js";
import { createWebSocketClient } from "./websocket/index.js";

type BrowserGlobalScope = Record<string, unknown>;

function resolveBrowserGlobalScope(): BrowserGlobalScope | null {
    if (typeof globalThis === "object" && globalThis !== null) {
        return globalThis;
    }

    return null;
}

function applyYyGetRealSafetyPatch(globalScope: BrowserGlobalScope): void {
    const originalGetReal = globalScope.yyGetReal;
    if (typeof originalGetReal !== "function") {
        return;
    }

    const maybeHotReloadSafe = Reflect.get(originalGetReal, "__hotReloadSafe");
    if (maybeHotReloadSafe === true) {
        return;
    }

    const safeGetReal = function yyGetRealSafe(value: unknown): unknown {
        if (value === undefined) {
            return 0;
        }

        return Reflect.apply(originalGetReal, globalScope, [value]);
    };

    Reflect.set(safeGetReal, "__hotReloadSafe", true);
    globalScope.yyGetReal = safeGetReal;
}

function createSafeMathFunction(
    originalFn: (...args: Array<unknown>) => unknown,
    globalScope: BrowserGlobalScope
): (value: unknown) => unknown {
    return function safeFn(value: unknown): unknown {
        const yyGetReal = globalScope.yyGetReal;
        const realValue: number =
            typeof yyGetReal === "function" ? (yyGetReal as (v: unknown) => number)(value) : Number(value);

        if (Number.isNaN(realValue)) {
            return Number.NaN;
        }

        return Reflect.apply(originalFn, globalScope, [value]);
    };
}

export function applyMathSafetyPatches(globalScope: BrowserGlobalScope): void {
    const mathFunctions = ["sqrt", "arcsin", "arccos", "ln", "log2", "log10"];

    for (const fnName of mathFunctions) {
        const originalFn = globalScope[fnName];
        if (typeof originalFn !== "function") {
            continue;
        }

        const maybeHotReloadSafe = Reflect.get(originalFn, "__hotReloadSafe");
        if (maybeHotReloadSafe === true) {
            continue;
        }

        const safeFn = createSafeMathFunction(originalFn as (...args: Array<unknown>) => unknown, globalScope);

        Reflect.set(safeFn, "__hotReloadSafe", true);
        globalScope[fnName] = safeFn;
    }
}

/**
 * Validate that an untrusted {@link LiveReloadLogLevel} is one of the canonical
 * bootstrap level values.
 *
 * Throws a `RangeError` when the input is not one of the canonical levels so
 * typos and accidental string drift surface immediately rather than silently
 * defaulting to the documented `"normal"` behaviour. The exhaustive `switch`
 * keeps the runtime check in sync with the compile-time union: adding a new
 * entry to {@link LIVE_RELOAD_LOG_LEVELS} will flag the missing case here at
 * build time.
 */
export function assertLiveReloadLogLevel(logLevel: LiveReloadLogLevel): void {
    switch (logLevel) {
        case LIVE_RELOAD_LOG_LEVELS.QUIET:
        case LIVE_RELOAD_LOG_LEVELS.NORMAL:
        case LIVE_RELOAD_LOG_LEVELS.DEBUG: {
            return;
        }
        default: {
            throw new RangeError(
                `Unsupported live-reload bootstrap log level: ${JSON.stringify(logLevel)}. ` +
                    `Expected one of: ${Object.values(LIVE_RELOAD_LOG_LEVELS).join(", ")}.`
            );
        }
    }
}

function writeBootstrapLog(logLevel: LiveReloadBootstrapConfig["logLevel"], message: string, error?: unknown): void {
    if (logLevel === undefined) {
        return;
    }

    assertLiveReloadLogLevel(logLevel);

    if (logLevel === LIVE_RELOAD_LOG_LEVELS.QUIET) {
        return;
    }

    if (error === undefined) {
        console.log(message);
        return;
    }

    console.error(message, error);
}

export function initializeLiveReload(
    config: LiveReloadBootstrapConfig = liveReloadBootstrapConfig
): ReturnType<typeof createRuntimeWrapper> {
    const wrapper = createRuntimeWrapper({
        onPatchApplied: (patch, version) => {
            writeBootstrapLog(config.logLevel, `[hot-reload] applied ${patch.id} @${String(version)}`);
        }
    });

    installScriptCallAdapter(wrapper);
    createWebSocketClient({
        url: config.websocketUrl,
        wrapper,
        onConnect: () => writeBootstrapLog(config.logLevel, "[hot-reload] connected"),
        onDisconnect: () => writeBootstrapLog(config.logLevel, "[hot-reload] disconnected"),
        onError: (error, context) => {
            writeBootstrapLog(config.logLevel, `[hot-reload] ${context}`, error);
        }
    });

    const globalScope = resolveBrowserGlobalScope();
    if (globalScope) {
        applyYyGetRealSafetyPatch(globalScope);
        applyMathSafetyPatches(globalScope);
        applyWebGLSafetyPatches(globalScope);
        applyHtml5AudioEmitterSafetyPatch(globalScope);
        applyHtml5FilenameChangeExtSafetyPatch(globalScope);
        applyHtml5TexturePointerSafetyPatch(globalScope);
    }

    return wrapper;
}

let liveReloadInitialized = false;

function ensureLiveReloadInitialized(): void {
    if (liveReloadInitialized) {
        return;
    }

    liveReloadInitialized = true;
    initializeLiveReload();
}

function installLiveReloadBootstrap(): void {
    const globalScope = resolveBrowserGlobalScope();
    if (!globalScope) {
        return;
    }

    const browserWindow = Reflect.get(globalScope, "window");
    const browserDocument = Reflect.get(globalScope, "document");
    if (typeof browserWindow !== "object" || browserWindow === null) {
        return;
    }

    if (typeof browserDocument !== "object" || browserDocument === null) {
        return;
    }

    ensureLiveReloadInitialized();
}

installLiveReloadBootstrap();
