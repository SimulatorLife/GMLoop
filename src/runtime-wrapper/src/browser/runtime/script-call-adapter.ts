import type { RegistryReader, RuntimeFunction } from "./types.js";

type RuntimeCallScript = (id: string, self: unknown, other: unknown, args: Array<unknown>) => unknown;

interface HotRuntimeScope {
    wrapper?: RegistryReader;
    getScript?: (id: string) => RuntimeFunction | undefined;
    callScript?: RuntimeCallScript;
}

interface HotRuntimeGlobals {
    __call_script?: RuntimeCallScript;
    __hot_call_script_original?: RuntimeCallScript;
    __hot?: HotRuntimeScope;
}

const SCRIPT_NOT_FOUND = (id: string) => `[hot-reload] script not found: ${id}`;

/**
 * Installs the hot-reload-aware `__call_script` dispatcher so that transpiled
 * script calls are routed through the runtime wrapper. The helper falls back to
 * any previously installed dispatcher if the targeted script has not yet been
 * patched.
 *
 * Only reads `getScript`, so it depends on {@link RegistryReader} rather than
 * the full `RuntimeWrapper` composite — keeping this adapter decoupled from
 * patch application, undo, history, mutation, metrics, diagnostics, and
 * error-analytics capabilities it never uses.
 */
export function installScriptCallAdapter(wrapper: RegistryReader): void {
    const globalScope = globalThis as HotRuntimeGlobals;
    const originalCallScript = globalScope.__hot_call_script_original ?? globalScope.__call_script;
    const fallbackCallScript = typeof originalCallScript === "function" ? originalCallScript : undefined;
    if (fallbackCallScript && !globalScope.__hot_call_script_original) {
        globalScope.__hot_call_script_original = fallbackCallScript;
    }

    const callScript: RuntimeCallScript = (id, self, other, args) => {
        const scriptFn = wrapper.getScript(id);
        if (typeof scriptFn === "function") {
            return scriptFn(self, other, args);
        }
        if (fallbackCallScript) {
            return fallbackCallScript(id, self, other, args);
        }
        throw new Error(SCRIPT_NOT_FOUND(id));
    };

    globalScope.__call_script = callScript;

    const hotScope = (globalScope.__hot ??= Object.create(null)) as HotRuntimeScope;
    hotScope.wrapper = wrapper;
    hotScope.getScript = (id) => wrapper.getScript(id);
    hotScope.callScript = callScript;
}
