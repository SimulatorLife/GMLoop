import assert from "node:assert/strict";
import test from "node:test";

import { parseHTML } from "linkedom";

import { bootstrapGraphVisualizationApp, renderGraphVisualizationHtml } from "../src/graph/index.js";

type GlobalSnapshot = Readonly<{
    addEventListener: typeof globalThis.addEventListener;
    clearInterval: typeof globalThis.clearInterval;
    clearTimeout: typeof globalThis.clearTimeout;
    customEvent: typeof globalThis.CustomEvent;
    document: typeof globalThis.document;
    element: typeof globalThis.Element;
    event: typeof globalThis.Event;
    fetch: typeof globalThis.fetch;
    htmlButtonElement: typeof globalThis.HTMLButtonElement;
    htmlElement: typeof globalThis.HTMLElement;
    htmlInputElement: typeof globalThis.HTMLInputElement;
    innerHeight: number;
    innerWidth: number;
    localStorage: typeof globalThis.localStorage;
    location: typeof globalThis.location;
    mouseEvent: typeof globalThis.MouseEvent;
    navigator: typeof globalThis.navigator;
    node: typeof globalThis.Node;
    removeEventListener: typeof globalThis.removeEventListener;
    setInterval: typeof globalThis.setInterval;
    setTimeout: typeof globalThis.setTimeout;
    svgElement: typeof globalThis.SVGElement;
    window: typeof globalThis.window;
}>;

type DeferredValue<TValue> = Readonly<{
    promise: Promise<TValue>;
    reject: (error: unknown) => void;
    resolve: (value: TValue) => void;
}>;

function createDeferredValue<TValue>(): DeferredValue<TValue> {
    let resolvePromise!: (value: TValue) => void;
    let rejectPromise!: (error: unknown) => void;
    const promise = new Promise<TValue>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
    });

    return Object.freeze({
        promise,
        reject: rejectPromise,
        resolve: resolvePromise
    });
}

function createGraphVisualizationFixtureHtml(): string {
    return renderGraphVisualizationHtml(
        {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        {
            isServerMode: true,
            loadedTarget: {
                activePath: "/tmp/project",
                projectRoot: "/tmp/project",
                selectedPaths: ["/tmp/project"],
                source: "working-directory"
            },
            title: "/tmp/project"
        }
    );
}

function createMemoryStorage(): Storage {
    const values = new Map<string, string>();

    return {
        clear(): void {
            values.clear();
        },
        getItem(key: string): string | null {
            return values.get(key) ?? null;
        },
        key(index: number): string | null {
            return Array.from(values.keys())[index] ?? null;
        },
        get length(): number {
            return values.size;
        },
        removeItem(key: string): void {
            values.delete(key);
        },
        setItem(key: string, value: string): void {
            values.set(key, value);
        }
    };
}

function captureGlobalSnapshot(): GlobalSnapshot {
    return Object.freeze({
        addEventListener: globalThis.addEventListener,
        clearInterval: globalThis.clearInterval,
        clearTimeout: globalThis.clearTimeout,
        customEvent: globalThis.CustomEvent,
        document: globalThis.document,
        element: globalThis.Element,
        event: globalThis.Event,
        fetch: globalThis.fetch,
        htmlButtonElement: globalThis.HTMLButtonElement,
        htmlElement: globalThis.HTMLElement,
        htmlInputElement: globalThis.HTMLInputElement,
        innerHeight: globalThis.innerHeight,
        innerWidth: globalThis.innerWidth,
        localStorage: globalThis.localStorage,
        location: globalThis.location,
        mouseEvent: globalThis.MouseEvent,
        navigator: globalThis.navigator,
        node: globalThis.Node,
        removeEventListener: globalThis.removeEventListener,
        setInterval: globalThis.setInterval,
        setTimeout: globalThis.setTimeout,
        svgElement: globalThis.SVGElement,
        window: globalThis.window
    });
}

function restoreGlobalSnapshot(snapshot: GlobalSnapshot): void {
    globalThis.clearInterval = snapshot.clearInterval;
    globalThis.clearTimeout = snapshot.clearTimeout;
    globalThis.CustomEvent = snapshot.customEvent;
    globalThis.document = snapshot.document;
    globalThis.Element = snapshot.element;
    globalThis.Event = snapshot.event;
    globalThis.fetch = snapshot.fetch;
    globalThis.HTMLButtonElement = snapshot.htmlButtonElement;
    globalThis.HTMLElement = snapshot.htmlElement;
    globalThis.HTMLInputElement = snapshot.htmlInputElement;
    globalThis.innerHeight = snapshot.innerHeight;
    globalThis.innerWidth = snapshot.innerWidth;
    globalThis.localStorage = snapshot.localStorage;
    globalThis.location = snapshot.location;
    globalThis.MouseEvent = snapshot.mouseEvent;
    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: snapshot.navigator
    });
    globalThis.Node = snapshot.node;
    globalThis.addEventListener = snapshot.addEventListener;
    globalThis.removeEventListener = snapshot.removeEventListener;
    globalThis.setInterval = snapshot.setInterval;
    globalThis.setTimeout = snapshot.setTimeout;
    globalThis.SVGElement = snapshot.svgElement;
    globalThis.window = snapshot.window;
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });
}

function readFetchRequestUrl(input: RequestInfo | URL): string {
    if (typeof input === "string") {
        return input;
    }

    if (input instanceof URL) {
        return input.href;
    }

    return input.url;
}

void test("graph visualization start live reload button shows spinner and surfaces backend errors", async () => {
    const globalSnapshot = captureGlobalSnapshot();
    const liveReloadResponse = createDeferredValue<{
        json: () => Promise<Readonly<{ error: string }>>;
        ok: boolean;
        status: number;
    }>();

    try {
        const { window } = parseHTML(createGraphVisualizationFixtureHtml());

        globalThis.window = window;
        globalThis.document = window.document;
        globalThis.Element = window.Element;
        globalThis.Node = window.Node;
        globalThis.HTMLElement = window.HTMLElement;
        globalThis.HTMLButtonElement = window.HTMLButtonElement;
        globalThis.HTMLInputElement = window.HTMLInputElement;
        globalThis.SVGElement = window.SVGElement;
        globalThis.Event = window.Event;
        globalThis.CustomEvent = window.CustomEvent;
        globalThis.MouseEvent = window.MouseEvent;
        globalThis.location = window.location;
        Object.defineProperty(globalThis, "navigator", {
            configurable: true,
            value: window.navigator
        });
        globalThis.addEventListener = window.addEventListener.bind(window);
        globalThis.removeEventListener = window.removeEventListener.bind(window);
        globalThis.innerWidth = 1280;
        globalThis.innerHeight = 720;
        globalThis.localStorage = createMemoryStorage();
        globalThis.setInterval = (() => 1) as unknown as typeof globalThis.setInterval;
        globalThis.clearInterval = (() => {}) as typeof globalThis.clearInterval;
        globalThis.fetch = (async (input: RequestInfo | URL) => {
            const requestUrl = readFetchRequestUrl(input);
            if (requestUrl === "/api/live-reload/start") {
                return await liveReloadResponse.promise;
            }

            throw new Error(`Unexpected fetch request: ${requestUrl}`);
        }) as typeof globalThis.fetch;

        bootstrapGraphVisualizationApp({
            data: {
                edges: [],
                generatedAt: "2026-01-01T00:00:00.000Z",
                graphs: [],
                nodes: [],
                projectRoot: "/tmp/project"
            },
            directoryOpen: async () => [],
            documentationCatalogs: null,
            fileOpen: async () =>
                Object.freeze({
                    name: "unused.gml",
                    text: async () => ""
                }),
            isServerMode: true,
            liveReload: null,
            loadedTarget: {
                activePath: "/tmp/project",
                projectRoot: "/tmp/project",
                selectedPaths: ["/tmp/project"],
                source: "working-directory"
            },
            projectConfigurationCatalog: null
        });

        const startButton = document.getElementById("start-live-reload");
        assert.ok(startButton instanceof HTMLButtonElement);
        assert.equal(startButton.disabled, false);

        startButton.dispatchEvent(new window.Event("click", { bubbles: true }));
        await flushMicrotasks();

        assert.match(startButton.innerHTML, /button-spinner/u);
        assert.match(startButton.innerHTML, /Building/u);
        assert.equal(startButton.ariaBusy, "true");
        assert.equal(startButton.disabled, true);

        liveReloadResponse.resolve({
            json: async () =>
                Object.freeze({
                    error: "GameMaker HTML5 temporary output root '/private/tmp/GameMakerStudio2/GMS2TEMP' was not found."
                }),
            ok: false,
            status: 500
        });

        await flushMicrotasks();

        const liveReloadContent = document.getElementById("live-reload-content");
        assert.ok(liveReloadContent instanceof HTMLElement);
        assert.match(liveReloadContent.innerHTML, /GameMaker HTML5 temporary output root/u);
        assert.doesNotMatch(startButton.innerHTML, /button-spinner/u);
        assert.equal(startButton.ariaBusy, "false");
        assert.equal(startButton.disabled, false);
    } finally {
        restoreGlobalSnapshot(globalSnapshot);
    }
});
