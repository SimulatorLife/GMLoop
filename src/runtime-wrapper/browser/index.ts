import { type LiveReloadBootstrapConfig, liveReloadBootstrapConfig } from "./config.js";
import { createRuntimeWrapper, installScriptCallAdapter } from "./runtime/index.js";
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

function writeBootstrapLog(logLevel: LiveReloadBootstrapConfig["logLevel"], message: string, error?: unknown): void {
    if (logLevel === "quiet") {
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

    const readyState = Reflect.get(browserDocument, "readyState");
    if (readyState === "complete") {
        ensureLiveReloadInitialized();
        return;
    }

    const addEventListener = Reflect.get(browserWindow, "addEventListener");
    if (typeof addEventListener === "function") {
        Reflect.apply(addEventListener, browserWindow, ["load", ensureLiveReloadInitialized, { once: true }]);
    }
}

installLiveReloadBootstrap();
