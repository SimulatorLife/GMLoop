import type { ReactiveController, ReactiveControllerHost } from "lit";

import type { GraphVisualizationUiModel } from "../contracts.js";
import { DEFAULT_PLAYGROUND_GML_SOURCE, resolveInitialPlaygroundGmlSource } from "../playground-default-gml.js";
import type { GraphVisualizationUiState } from "../state/types.js";

const DEFAULT_DEBOUNCE_MS = 300;
const PLAYGROUND_INPUT_STORAGE_KEY = "gmloop-playground-input";

interface PlaygroundSessionControllerCallbacks {
    /**
     * Invoked once per accepted input update (and once after the debounce
     * window expires when {@link PlaygroundSessionController.setInput}
     * debounces the call). The host should kick off the playground
     * processing pipeline.
     */
    onProcessInput: () => Promise<void> | void;
    /**
     * Invoked synchronously whenever the controller mutates its internal
     * input value (localStorage hydration, debounce flush, or explicit
     * setter). The host should call `requestUpdate` to keep its rendered
     * output in sync.
     */
    onInputChanged: () => void;
    /**
     * Invoked whenever the host's model reference changes. The host should
     * sync any model-derived internal state here.
     */
    onModelChanged: () => void;
}

interface PlaygroundSessionControllerOptions {
    callbacks: PlaygroundSessionControllerCallbacks;
    /**
     * Returns the host's current model. Read lazily on every host update so
     * the controller does not need to be wired into the property setter.
     */
    getModel: () => GraphVisualizationUiModel | null;
    /**
     * Returns the host's current UI state. Read lazily on every host update.
     */
    getState: () => GraphVisualizationUiState | null;
    debounceMs?: number;
    storageKey?: string;
}

/**
 * Reactive controller that owns the playground's editable GML source, its
 * persistence to browser storage, the debounce timer that throttles
 * downstream processing, and the model/state-change detection that used to
 * live in the host's `willUpdate`/`updated` overrides.
 *
 * Composing this controller lets the host panel delegate what used to be a
 * tangle of lifecycle overrides into a single injected collaborator. The host
 * keeps the public `render()` override but no longer has to manage timer
 * handles, localStorage reads, model-change detection, or page-activation
 * bookkeeping.
 */
export class PlaygroundSessionController implements ReactiveController {
    #callbacks: PlaygroundSessionControllerCallbacks;
    #getModel: () => GraphVisualizationUiModel | null;
    #getState: () => GraphVisualizationUiState | null;
    #debounceMs: number;
    #storageKey: string;
    #input: string = DEFAULT_PLAYGROUND_GML_SOURCE;
    #debounceTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    #lastModel: GraphVisualizationUiModel | null = null;
    #lastStateActive = false;
    #initialActivationProcessed = false;

    public constructor(host: ReactiveControllerHost, options: PlaygroundSessionControllerOptions) {
        this.#callbacks = options.callbacks;
        this.#getModel = options.getModel;
        this.#getState = options.getState;
        this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
        this.#storageKey = options.storageKey ?? PLAYGROUND_INPUT_STORAGE_KEY;
        host.addController(this);
    }

    public get input(): string {
        return this.#input;
    }

    public hostConnected(): void {
        const savedInput = this.#readPersistedInput();
        const nextInput = resolveInitialPlaygroundGmlSource(savedInput);
        if (savedInput !== nextInput) {
            this.#writePersistedInput(nextInput);
        }
        if (nextInput !== this.#input) {
            this.#input = nextInput;
            this.#callbacks.onInputChanged();
        }
    }

    public hostDisconnected(): void {
        this.#clearDebounceTimer();
    }

    public hostUpdate(): void {
        const model = this.#getModel();
        if (model !== this.#lastModel) {
            this.#lastModel = model;
            this.#callbacks.onModelChanged();
        }
    }

    public hostUpdated(): void {
        const state = this.#getState();
        const isActive = state?.activePage === "playground";
        const wasActive = this.#lastStateActive;
        this.#lastStateActive = isActive;

        if (!isActive) {
            return;
        }

        if (!this.#initialActivationProcessed) {
            this.#initialActivationProcessed = true;
            void this.#callbacks.onProcessInput();
            return;
        }

        if (!wasActive) {
            void this.#callbacks.onProcessInput();
        }
    }

    /**
     * Replace the playground input, persisting to localStorage and queuing a
     * debounced processing invocation. Safe to call from any input handler.
     */
    public setInput(value: string): void {
        this.#input = value;
        this.#writePersistedInput(value);
        this.#callbacks.onInputChanged();
        this.#clearDebounceTimer();
        this.#debounceTimer = globalThis.setTimeout(() => {
            this.#debounceTimer = null;
            void this.#callbacks.onProcessInput();
        }, this.#debounceMs);
    }

    /**
     * Force an immediate processing run, flushing any pending debounce. Useful
     * when the host needs deterministic processing (e.g. page activation).
     */
    public flushProcessing(): void {
        this.#clearDebounceTimer();
        void this.#callbacks.onProcessInput();
    }

    #readPersistedInput(): string | null {
        try {
            return globalThis.localStorage?.getItem(this.#storageKey) ?? null;
        } catch {
            return null;
        }
    }

    #writePersistedInput(value: string): void {
        try {
            globalThis.localStorage?.setItem(this.#storageKey, value);
        } catch {
            // Storage may be unavailable (private mode, quota); persistence is
            // best-effort and the in-memory input value is still authoritative.
        }
    }

    #clearDebounceTimer(): void {
        if (this.#debounceTimer !== null) {
            globalThis.clearTimeout(this.#debounceTimer);
            this.#debounceTimer = null;
        }
    }
}
