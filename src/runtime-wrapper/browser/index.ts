import { createRuntimeWrapper, installScriptCallAdapter } from "../src/runtime/index.js";
import { createWebSocketClient } from "../src/websocket/index.js";
import { type LiveReloadBootstrapConfig, liveReloadBootstrapConfig } from "./config.js";

type BrowserGlobalScope = Record<string, unknown>;

function resolveBrowserGlobalScope(): BrowserGlobalScope | null {
    if (typeof globalThis === "object" && globalThis !== null) {
        return globalThis as BrowserGlobalScope;
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
