import assert from "node:assert/strict";
import test from "node:test";

import type { ReactiveController, ReactiveControllerHost } from "lit";

import { PlaygroundSessionController } from "../src/app/components/playground-session-controller.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { DEFAULT_PLAYGROUND_GML_SOURCE } from "../src/app/playground-default-gml.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";

class MockReactiveHost implements ReactiveControllerHost {
    #controllers: ReactiveController[] = [];
    public requestUpdateCallCount = 0;
    public readonly updateComplete = Promise.resolve(true);

    public addController(controller: ReactiveController): void {
        this.#controllers.push(controller);
    }

    public removeController(controller: ReactiveController): void {
        this.#controllers = this.#controllers.filter((candidate) => candidate !== controller);
    }

    public requestUpdate(): void {
        this.requestUpdateCallCount += 1;
    }

    public connect(): void {
        for (const controller of this.#controllers) {
            controller.hostConnected?.();
        }
    }

    public disconnect(): void {
        for (const controller of this.#controllers) {
            controller.hostDisconnected?.();
        }
    }

    public update(): void {
        for (const controller of this.#controllers) {
            controller.hostUpdate?.();
        }
    }

    public updated(): void {
        for (const controller of this.#controllers) {
            controller.hostUpdated?.();
        }
    }
}

interface SessionSpyCallbacks {
    onInputChangedCalls: number;
    onModelChangedCalls: number;
    onProcessInputCalls: number;
}

function createSessionController(
    host: MockReactiveHost,
    options: {
        debounceMs?: number;
        storageKey?: string;
        getModel: () => GraphVisualizationUiModel | null;
        getState: () => GraphVisualizationUiState | null;
        callbacks?: Partial<SessionSpyCallbacks>;
    }
): { controller: PlaygroundSessionController; spy: SessionSpyCallbacks } {
    const spy: SessionSpyCallbacks = {
        onInputChangedCalls: 0,
        onModelChangedCalls: 0,
        onProcessInputCalls: 0
    };
    const callbacks = {
        onInputChanged: () => {
            spy.onInputChangedCalls += 1;
        },
        onModelChanged: () => {
            spy.onModelChangedCalls += 1;
        },
        onProcessInput: () => {
            spy.onProcessInputCalls += 1;
        }
    };
    const controller = new PlaygroundSessionController(host, {
        callbacks: { ...callbacks, ...options.callbacks },
        debounceMs: options.debounceMs,
        getModel: options.getModel,
        getState: options.getState,
        storageKey: options.storageKey
    });
    return { controller, spy };
}

function withStorage<T>(values: Record<string, string>, run: () => T): T {
    const original = globalThis.localStorage;
    const store = new Map<string, string>(Object.entries(values));
    const storage = {
        getItem(key: string): string | null {
            return store.has(key) ? (store.get(key) ?? null) : null;
        },
        setItem(key: string, value: string): void {
            store.set(key, value);
        },
        removeItem(key: string): void {
            store.delete(key);
        },
        clear(): void {
            store.clear();
        },
        get length(): number {
            return store.size;
        },
        key(index: number): string | null {
            return [...store.keys()][index] ?? null;
        }
    } satisfies Storage;
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
    try {
        return run();
    } finally {
        Object.defineProperty(globalThis, "localStorage", { configurable: true, value: original });
    }
}

void test("PlaygroundSessionController seeds the default sample on connect when storage is empty", () => {
    withStorage({}, () => {
        const host = new MockReactiveHost();
        const { controller, spy } = createSessionController(host, {
            getModel: () => null,
            getState: () => null
        });
        host.connect();

        assert.equal(controller.input, DEFAULT_PLAYGROUND_GML_SOURCE);
        // The seeded default matches the controller's initial value, so the
        // host is not woken for a synthetic change.
        assert.equal(spy.onInputChangedCalls, 0);
    });
});

void test("PlaygroundSessionController restores the persisted source on connect", () => {
    withStorage({ "gmloop-playground-input": "var x = 1;" }, () => {
        const host = new MockReactiveHost();
        const { controller, spy } = createSessionController(host, {
            getModel: () => null,
            getState: () => null
        });
        host.connect();

        assert.equal(controller.input, "var x = 1;");
        // Hydration swaps the default for the persisted value, so the host
        // is notified once to re-render with the restored source.
        assert.equal(spy.onInputChangedCalls, 1);
    });
});

void test("PlaygroundSessionController overwrites empty persisted values with the default sample", () => {
    withStorage({ "gmloop-playground-input": "   " }, () => {
        const host = new MockReactiveHost();
        const { controller } = createSessionController(host, {
            getModel: () => null,
            getState: () => null
        });
        host.connect();

        assert.equal(controller.input, DEFAULT_PLAYGROUND_GML_SOURCE);
    });
});

void test("PlaygroundSessionController.setInput persists and schedules a debounced process", async () => {
    await withStorage({}, async () => {
        const host = new MockReactiveHost();
        const { controller, spy } = createSessionController(host, {
            debounceMs: 20,
            getModel: () => null,
            getState: () => null
        });
        host.connect();

        controller.setInput("show_debug_message('hi')");
        assert.equal(controller.input, "show_debug_message('hi')");
        assert.equal(globalThis.localStorage.getItem("gmloop-playground-input"), "show_debug_message('hi')");
        // Hydration of an empty storage leaves the default in place, so the
        // only onInputChanged invocation is from the setter.
        assert.equal(spy.onInputChangedCalls, 1);
        assert.equal(spy.onProcessInputCalls, 0);

        await new Promise((resolve) => {
            globalThis.setTimeout(resolve, 40);
        });
        assert.equal(spy.onProcessInputCalls, 1);
    });
});

void test("PlaygroundSessionController clears the debounce timer on disconnect", async () => {
    await withStorage({}, async () => {
        const host = new MockReactiveHost();
        const { controller, spy } = createSessionController(host, {
            debounceMs: 40,
            getModel: () => null,
            getState: () => null
        });
        host.connect();

        controller.setInput("var pending = true;");
        assert.equal(spy.onProcessInputCalls, 0);

        host.disconnect();

        await new Promise((resolve) => {
            globalThis.setTimeout(resolve, 80);
        });
        assert.equal(spy.onProcessInputCalls, 0, "disconnect should cancel the pending debounce");
    });
});

void test("PlaygroundSessionController flushProcessing runs the process callback immediately", () => {
    withStorage({}, () => {
        const host = new MockReactiveHost();
        const { controller, spy } = createSessionController(host, {
            debounceMs: 1000,
            getModel: () => null,
            getState: () => null
        });
        host.connect();

        controller.setInput("var a = 1;");
        controller.flushProcessing();

        assert.equal(spy.onProcessInputCalls, 1);
    });
});

void test("PlaygroundSessionController notifies on model change exactly once per reference", () => {
    const host = new MockReactiveHost();
    const model: GraphVisualizationUiModel = { id: "model-1" } as unknown as GraphVisualizationUiModel;
    const { spy } = createSessionController(host, {
        getModel: () => model,
        getState: () => null
    });
    host.connect();

    host.update();
    host.update();

    assert.equal(spy.onModelChangedCalls, 1);
});

void test("PlaygroundSessionController processes the input on the first activation", () => {
    const host = new MockReactiveHost();
    const state: GraphVisualizationUiState = {
        activePage: "playground",
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        labelMode: "auto"
    } as unknown as GraphVisualizationUiState;
    const { spy } = createSessionController(host, {
        getModel: () => null,
        getState: () => state
    });
    host.connect();

    host.updated();
    host.updated();

    assert.equal(spy.onProcessInputCalls, 1);
});

void test("PlaygroundSessionController processes again when the page becomes active after being inactive", () => {
    const host = new MockReactiveHost();
    let state: GraphVisualizationUiState = {
        activePage: "config",
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        labelMode: "auto"
    } as unknown as GraphVisualizationUiState;
    const { spy } = createSessionController(host, {
        getModel: () => null,
        getState: () => state
    });
    host.connect();

    host.updated();
    assert.equal(spy.onProcessInputCalls, 0);

    state = { ...state, activePage: "playground" };
    host.updated();
    assert.equal(spy.onProcessInputCalls, 1);

    // Subsequent updates while still active do not re-trigger.
    host.updated();
    assert.equal(spy.onProcessInputCalls, 1);
});
