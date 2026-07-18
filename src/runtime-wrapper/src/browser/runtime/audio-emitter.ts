type BrowserGlobalScope = Record<string, unknown>;

type RuntimeFunction = (...args: Array<unknown>) => unknown;

const AUDIO_EMITTER_PATCH_MARKER = "__gmloopAudioEmitterSafetyPatched";

type ResolvedRuntimeFunction = Readonly<{
    name: string;
    function: RuntimeFunction;
}>;

function resolveRuntimeFunction(
    globalScope: BrowserGlobalScope,
    predicate: (source: string) => boolean
): ResolvedRuntimeFunction | null {
    for (const name of Object.getOwnPropertyNames(globalScope)) {
        let candidate: unknown;
        try {
            candidate = globalScope[name];
        } catch {
            continue;
        }

        if (typeof candidate !== "function") {
            continue;
        }

        let source: string;
        try {
            source = Function.prototype.toString.call(candidate);
        } catch {
            continue;
        }

        if (predicate(source)) {
            return Object.freeze({ name, function: candidate as RuntimeFunction });
        }
    }

    return null;
}

function resolveAudioSystemInitializedFunction(globalScope: BrowserGlobalScope): ResolvedRuntimeFunction | null {
    return resolveRuntimeFunction(
        globalScope,
        (source) =>
            source.includes("_a65") &&
            source.includes("instanceof") &&
            source.includes("_765") &&
            source.includes("_665")
    );
}

function resolveAudioEmitterCreateFunction(globalScope: BrowserGlobalScope): ResolvedRuntimeFunction | null {
    return resolveRuntimeFunction(
        globalScope,
        (source) =>
            source.includes("_K45.findIndex") &&
            source.includes("new _") &&
            source.includes("_K45.push") &&
            source.includes("emitter")
    );
}

/**
 * Prevent the HTML5 runtime from storing a partially constructed audio
 * emitter when the audio engine is not initialized yet.
 *
 * Some GameMaker HTML5 runtimes expose the minified audio functions globally
 * but let `audio_emitter_create` construct an incomplete emitter before the
 * Web Audio context exists. The later audio update loop then dereferences the
 * incomplete object and ends the game. The wrapper defers that creation by
 * returning the same undefined sentinel the native function uses for failed
 * creation; once the engine is ready, calls pass through unchanged.
 *
 * @param globalScope - Browser global object containing the minified runtime.
 * @returns True when the audio-emitter creation function was patched.
 */
export function applyHtml5AudioEmitterSafetyPatch(globalScope: BrowserGlobalScope): boolean {
    const createFunction = resolveAudioEmitterCreateFunction(globalScope);
    if (createFunction === null) {
        return false;
    }

    if (Reflect.get(createFunction.function, AUDIO_EMITTER_PATCH_MARKER) === true) {
        return false;
    }

    const initializedFunction = resolveAudioSystemInitializedFunction(globalScope);
    const nativeCreateFunction = createFunction.function;
    const patchedCreateFunction = function (this: unknown, ...args: Array<unknown>): unknown {
        if (initializedFunction !== null) {
            try {
                if (Reflect.apply(initializedFunction.function, globalScope, []) !== true) {
                    return undefined;
                }
            } catch {
                return undefined;
            }
        }

        try {
            return Reflect.apply(nativeCreateFunction, this, args);
        } catch {
            return undefined;
        }
    };

    Reflect.set(patchedCreateFunction, AUDIO_EMITTER_PATCH_MARKER, true);
    globalScope[createFunction.name] = patchedCreateFunction;
    return true;
}
